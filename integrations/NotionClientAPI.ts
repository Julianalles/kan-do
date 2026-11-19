/**
 * NotionClientAPI - Direct client-side wrapper for Notion REST API
 * 
 * This module provides direct access to Notion's REST API. In Tauri builds,
 * it uses the Tauri HTTP plugin to bypass CORS. In browser builds, it falls
 * back to server-side proxy routes.
 * 
 * @see https://developers.notion.com/reference
 */

import type { NotionDatabaseSchema } from '~/types/notion';
import { isTauri } from '~/utils/isTauri';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const NOTION_VERSION_DATA_SOURCES = '2025-09-03'; // Required for data_sources endpoint
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RETRIES = 1;
const DEFAULT_BACKOFF_MS = 300;
/**
 * The longest `Retry-After` of a 429 the client sleeps before its retry (#507, equal to the per-request timeout).
 * A longer wait (the public instance's Worker answers 60 s) is not slept: the 429 is thrown at once, so the add
 * form never hangs on one request, and the caller keeps the task for the next push (`createFailureKind`).
 */
const MAX_RETRY_AFTER_MS = 10000;
/** Pagination ceiling for `queryDataSource` (100 pages of 100 rows); reaching it throws instead of truncating. */
const MAX_QUERY_PAGES = 100;

/**
 * Custom error class for Notion API errors
 */
export class NotionAPIError extends Error {
  public readonly statusCode: number;
  public readonly data: unknown;
  /** What a 429's `Retry-After` asked for, in ms (#529); null when the response named no wait or was not a 429. */
  public readonly retryAfterMs: number | null;

  constructor(statusCode: number, message: string, data?: unknown, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'NotionAPIError';
    this.statusCode = statusCode;
    this.data = data;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * The wait a response's `Retry-After` asks for, in ms: delta seconds or an HTTP date. `null` when the header is
 * missing, not parsable, zero or a date in the past (the caller then uses its own backoff).
 */
export function retryAfterMs(response: Pick<Response, 'headers'>, now: number = Date.now()): number | null {
  const raw = response.headers?.get?.('Retry-After')?.trim();
  if (!raw) return null;
  const ms = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - now;
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

/**
 * True for the request that creates a page. It is not idempotent and Notion has no idempotency key: after a timeout,
 * a network error or a 5xx the page may exist already, so this request is never sent again by the retry below (#528).
 * The caller keeps the task and looks the page up before it creates again (`NotionIntegration.findLandedPage`).
 * A 429 refused the request before a page was made, so it stays retryable.
 */
const isPageCreate = (method: HttpMethod, endpoint: string): boolean => method === 'POST' && endpoint === '/pages';

/** True for the archive request body (`{ archived: true }`), which has its own proxy route. */
const isArchiveBody = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as { archived?: unknown }).archived === true;

/** True for the un-archive request body (`{ archived: false }`), which has its own proxy route (#422). */
const isUnarchiveBody = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as { archived?: unknown }).archived === false;

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

/**
 * Low-level client for Notion REST API
 * 
 * Handles authentication, retries, and error mapping.
 * All methods return typed responses from Notion API.
 */
export class NotionClientAPI {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  /**
   * Make an authenticated request to Notion API
   */
  async request<T = unknown>(
    method: HttpMethod,
    endpoint: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    const {
      retries = DEFAULT_RETRIES,
      backoffMs = DEFAULT_BACKOFF_MS,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    } = options;

    return this.fetchWithRetry<T>(method, endpoint, body, retries, backoffMs, timeoutMs);
  }

  private async fetchWithRetry<T>(
    method: HttpMethod,
    endpoint: string,
    body: unknown | undefined,
    retriesLeft: number,
    backoffMs: number,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: Response;

      const useTauriMode = isTauri();
      
      // Use newer API version for data_sources endpoints and search with data_source filter
      const bodyStr = body ? JSON.stringify(body) : '';
      const needsDataSourceVersion = endpoint.includes('data_source') || 
        (endpoint === '/search' && bodyStr.includes('data_source'));
      const apiVersion = needsDataSourceVersion ? NOTION_VERSION_DATA_SOURCES : NOTION_VERSION;

      if (import.meta.dev && useTauriMode) {
        console.log(`[NotionClientAPI] ${method} ${endpoint} | apiVersion: ${apiVersion}`);
      }

      if (useTauriMode) {
        // Tauri: Use Tauri HTTP plugin to bypass CORS
        // Dynamically import the plugin to avoid build errors in non-Tauri environments
        let tauriFetch: typeof fetch;
        try {
          const module = await import('@tauri-apps/plugin-http');
          tauriFetch = module.fetch;
        } catch (e) {
          console.error('[NotionClientAPI] Failed to load Tauri HTTP plugin:', e);
          throw new Error('Tauri HTTP plugin not available', { cause: e });
        }

        const url = `${NOTION_API_BASE}${endpoint}`;
        response = await tauriFetch(url, {
          method,
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Notion-Version': apiVersion,
            'Content-Type': 'application/json',
          },
          body: body ? JSON.stringify(body) : undefined,
          // The timer below must cancel the request itself, or a stalled desktop request never ends (#527)
          signal: controller.signal,
        });
      } else {
        // Browser: Use server proxy to avoid CORS
        const proxyUrl = this.getProxyUrl(method, endpoint, body);
        const proxyOptions = this.getProxyOptions(method, endpoint, body, controller.signal);
        response = await fetch(proxyUrl, proxyOptions);
      }

      // The timer stays armed until the body is read: a stalled body ends the request as well (#527)
      if (response.ok) {
        const data = await response.json();
        clearTimeout(timeoutId);
        // Normalize server proxy responses that return arrays directly
        // to match Notion API format { results: [...] }
        if (!isTauri() && Array.isArray(data) && endpoint === '/search') {
          return { results: data } as T;
        }
        // Normalize server proxy response for page creation
        // Server returns { success, pageId, page } but client expects { id, object }
        if (!isTauri() && endpoint === '/pages' && method === 'POST' && data.pageId) {
          return { id: data.pageId, object: 'page', ...data.page } as T;
        }
        return data as T;
      }

      // Parse error response
      let errorData: unknown;
      try {
        errorData = await response.json();
      } catch {
        errorData = { message: response.statusText };
      }
      clearTimeout(timeoutId);

      // What a 429 asked for (#507); a thrown 429 carries it so the push loops can pause the source (#529)
      const asked = response.status === 429 ? retryAfterMs(response) : null;

      // Don't retry on 401 (auth error) or 4xx client errors (except 429)
      if (response.status === 401 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        throw new NotionAPIError(response.status, response.statusText, errorData);
      }

      // Retry on 429 (rate limit) or 5xx (server error); a 5xx of a create may have made the page (#528)
      if (retriesLeft > 0 && (response.status === 429 || (response.status >= 500 && !isPageCreate(method, endpoint)))) {
        // A 429 says when the limit lifts (#507): retrying earlier fails again and spends more quota. A wait over
        // the cap is not slept: throw the 429 so the caller can keep the work for later.
        if (asked !== null && asked > MAX_RETRY_AFTER_MS) {
          throw new NotionAPIError(response.status, response.statusText, errorData, asked);
        }
        await this.sleep(asked ?? backoffMs);
        return this.fetchWithRetry<T>(method, endpoint, body, retriesLeft - 1, backoffMs * 2, timeoutMs);
      }

      throw new NotionAPIError(response.status, response.statusText, errorData, asked);
    } catch (error) {
      clearTimeout(timeoutId);

      // If it's already a NotionAPIError, rethrow
      if (error instanceof NotionAPIError) {
        throw error;
      }

      // Network error or timeout - retry if possible, but never a create: the page may exist (#528)
      if (retriesLeft > 0 && !isPageCreate(method, endpoint)) {
        await this.sleep(backoffMs);
        return this.fetchWithRetry<T>(method, endpoint, body, retriesLeft - 1, backoffMs * 2, timeoutMs);
      }

      throw new NotionAPIError(0, (error as Error).message || 'Network error', { originalError: error });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the proxy URL for browser mode based on endpoint
   */
  private getProxyUrl(method: HttpMethod, endpoint: string, body: unknown): string {
    // Map Notion API endpoints to server proxy routes
    if (endpoint === '/search') {
      const filter = (body as { filter?: { value?: string } })?.filter;
      if (filter?.value === 'database') {
        return `/api/notion/databases`;
      }
      if (filter?.value === 'data_source') {
        return `/api/notion/data-sources`;
      }
      if (filter?.value === 'page') {
        return `/api/notion/pages`;
      }
    }
    if (endpoint.startsWith('/databases/')) {
      const dbId = endpoint.replace('/databases/', '');
      return `/api/notion/database?id=${dbId}`;
    }
    if (endpoint.startsWith('/data_sources/') && endpoint.endsWith('/query')) {
      return `/api/notion/query-data-source`;
    }
    if (endpoint.startsWith('/data_sources/')) {
      const dsId = endpoint.replace('/data_sources/', '');
      return `/api/notion/data-sources?id=${dsId}`;
    }
    if (endpoint.startsWith('/pages/') && method === 'GET') {
      const pageId = endpoint.replace('/pages/', '');
      return `/api/notion/pages?pageId=${pageId}`;
    }
    if (endpoint === '/pages' && method === 'POST') {
      return `/api/notion/create-task`;
    }
    if (endpoint.startsWith('/pages/') && method === 'PATCH' && isArchiveBody(body)) {
      return `/api/notion/archive-page`;
    }
    if (endpoint.startsWith('/pages/') && method === 'PATCH' && isUnarchiveBody(body)) {
      return `/api/notion/unarchive-page`;
    }
    if (endpoint.startsWith('/pages/') && method === 'PATCH') {
      return `/api/notion/update-task`;
    }
    // Fallback - shouldn't reach here
    return `/api/notion${endpoint}`;
  }

  /**
   * Get fetch options for browser proxy mode
   */
  private getProxyOptions(method: HttpMethod, endpoint: string, body: unknown, signal: AbortSignal): RequestInit {
    const authHeaders = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };

    // GET routes pass all params via query string (no body)
    if (method === 'GET' || endpoint === '/search') {
      return { method: 'GET', headers: authHeaders, signal };
    }

    // POST/PATCH routes send token via Authorization header, not in body
    if (endpoint.startsWith('/data_sources/') && endpoint.endsWith('/query')) {
      const dsId = endpoint.replace('/data_sources/', '').replace('/query', '');
      const queryBody = body as { filter?: unknown; sorts?: unknown; page_size?: number; start_cursor?: string };
      return {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          dataSourceId: dsId,
          filter: queryBody?.filter,
          sorts: queryBody?.sorts,
          page_size: queryBody?.page_size,
          start_cursor: queryBody?.start_cursor,
        }),
        signal,
      };
    }

    if (endpoint === '/pages' && method === 'POST') {
      const pageBody = body as { parent?: { database_id?: string }; properties?: unknown };
      return {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          databaseId: pageBody?.parent?.database_id,
          properties: pageBody?.properties,
        }),
        signal,
      };
    }

    if (endpoint.startsWith('/pages/') && method === 'PATCH' && (isArchiveBody(body) || isUnarchiveBody(body))) {
      const pageId = endpoint.replace('/pages/', '');
      return { method: 'POST', headers: authHeaders, body: JSON.stringify({ pageId }), signal };
    }

    if (endpoint.startsWith('/pages/') && method === 'PATCH') {
      const pageId = endpoint.replace('/pages/', '');
      const patchBody = body as { properties?: unknown };
      return {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          pageId,
          properties: patchBody?.properties,
        }),
        signal,
      };
    }

    return { method, headers: authHeaders, signal };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // High-level API methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Search for databases accessible to the integration
   */
  async searchDatabases(pageSize = 100): Promise<{ results: unknown[] }> {
    return this.request('POST', '/search', {
      filter: { property: 'object', value: 'database' },
      page_size: pageSize,
    });
  }

  /**
   * Search for data sources accessible to the integration
   */
  async searchDataSources(pageSize = 100): Promise<{ results: unknown[] }> {
    return this.request('POST', '/search', {
      filter: { property: 'object', value: 'data_source' },
      page_size: pageSize,
    });
  }

  /**
   * Retrieve a database by ID (includes schema/properties)
   */
  async getDatabase(databaseId: string): Promise<{ id: string; properties: Record<string, unknown>; title?: unknown[] }> {
    return this.request('GET', `/databases/${databaseId}`);
  }

  /**
   * Retrieve a data source by ID (includes its schema in `properties`)
   */
  async getDataSource(dataSourceId: string): Promise<{
    id: string;
    name?: string;
    title?: Array<{ plain_text?: string }>;
    location?: { database_id?: string };
    parent?: { database_id?: string };
    properties?: NotionDatabaseSchema;
  }> {
    return this.request('GET', `/data_sources/${dataSourceId}`);
  }

  /**
   * Query a data source (view) with optional filter and return ALL matching pages.
   *
   * Follows `has_more` / `next_cursor` page by page, so both transports (Tauri direct
   * call and browser proxy) see every match. A failure on any page rejects the whole
   * call: a truncated list would make `mergeTasks` delete tasks. The cursor is only
   * valid within one run; never keep it across syncs.
   *
   * `maxResults` (#357) is for a list that is allowed to be a part: reading stops once that many rows are in, and
   * `limited` says whether Notion has more. Pass `sorts` with it, so the part is a defined one. Never for a list
   * `mergeTasks` treats as complete: the caller hands the merge what the list is a part of
   * (`FetchedTasks.partialNotPlanned`).
   */
  async queryDataSource(
    dataSourceId: string,
    options: { filter?: unknown; sorts?: unknown; page_size?: number; maxResults?: number } = {}
  ): Promise<{ results: unknown[]; limited?: boolean }> {
    const pageSize = Math.min(options.page_size ?? 100, options.maxResults ?? Infinity);
    const results: unknown[] = [];
    let cursor: string | undefined;

    for (let page = 1; page <= MAX_QUERY_PAGES; page++) {
      const response = await this.queryDataSourcePage(dataSourceId, {
        filter: options.filter,
        ...(options.sorts ? { sorts: options.sorts } : {}),
        page_size: pageSize,
        start_cursor: cursor,
      });
      results.push(...response.results);

      if (options.maxResults !== undefined && results.length >= options.maxResults) {
        const limited = results.length > options.maxResults || response.has_more === true;
        return { results: results.slice(0, options.maxResults), limited };
      }
      if (!response.has_more) return { results, ...(options.maxResults !== undefined ? { limited: false } : {}) };

      const next = response.next_cursor;
      if (!next || next === cursor) {
        throw new NotionAPIError(502, 'Notion pagination did not advance (missing or repeated next_cursor)', {
          pagesFetched: page,
        });
      }
      cursor = next;
    }

    throw new NotionAPIError(
      502,
      `Notion query exceeded the ${MAX_QUERY_PAGES}-page limit (${results.length} rows loaded)`,
      { pagesFetched: MAX_QUERY_PAGES }
    );
  }

  /** One page of a data-source query. */
  private queryDataSourcePage(
    dataSourceId: string,
    body: { filter?: unknown; sorts?: unknown; page_size: number; start_cursor?: string }
  ): Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }> {
    return this.request('POST', `/data_sources/${dataSourceId}/query`, body);
  }

  /**
   * Retrieve a page by ID
   */
  async getPage(pageId: string): Promise<{ id: string; properties: Record<string, unknown> }> {
    return this.request('GET', `/pages/${pageId}`);
  }

  /**
   * Create a new page in a database
   */
  async createPage(
    databaseId: string,
    properties: Record<string, unknown>
  ): Promise<{ id: string; object: string }> {
    return this.request('POST', '/pages', {
      parent: { database_id: databaseId },
      properties,
    });
  }

  /**
   * Update a page's properties
   */
  async updatePage(
    pageId: string,
    properties: Record<string, unknown>
  ): Promise<{ id: string; object: string }> {
    return this.request('PATCH', `/pages/${pageId}`, { properties });
  }

  /**
   * Archives a page (moves it to Notion's trash, restorable there).
   */
  async archivePage(pageId: string): Promise<unknown> {
    return this.request('PATCH', `/pages/${pageId}`, { archived: true });
  }

  /**
   * Takes a page out of Notion's trash again (#422). Rejects with status 404 when Notion no longer has it.
   */
  async unarchivePage(pageId: string): Promise<unknown> {
    return this.request('PATCH', `/pages/${pageId}`, { archived: false });
  }

  /**
   * Search for pages (general search)
   */
  async searchPages(pageSize = 100): Promise<{ results: unknown[] }> {
    return this.request('POST', '/search', {
      filter: { property: 'object', value: 'page' },
      page_size: pageSize,
    });
  }
}
