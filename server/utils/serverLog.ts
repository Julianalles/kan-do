import { getRequestURL } from 'h3'
import type { H3Event } from 'h3'

/**
 * The one way a server route logs a failure (#511). The public Worker persists everything written to the console
 * (Workers Logs), so a log line must never carry Notion content, an error object, a message, a body, a header or a
 * token. This writes a single string built from three allow-listed fields: HTTP status, a stable error code and the
 * route path (no query: it holds database and page ids).
 */

/** Notion's `error.code` enum (`object_not_found`, `rate_limited`, ...). */
const NOTION_CODE = /^[a-z_]{1,40}$/
/** The `data.error` code of an H3 error built by `apiError.ts` (`NOTION_API_ERROR`, `MISSING_PARAMETERS`, ...). */
const APP_CODE = /^[A-Z_]{1,40}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function statusOf(error: unknown): number {
  if (!isRecord(error)) return 500
  for (const candidate of [error.status, error.statusCode]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599) return candidate
  }
  return 500
}

function codeOf(error: unknown): string {
  if (!isRecord(error)) return 'UNKNOWN'
  if (typeof error.code === 'string' && NOTION_CODE.test(error.code)) return error.code
  const appCode = isRecord(error.data) ? error.data.error : undefined
  if (typeof appCode === 'string' && APP_CODE.test(appCode)) return appCode
  return 'UNKNOWN'
}

function routeOf(event: H3Event | undefined): string {
  if (!event) return 'unknown'
  try {
    return getRequestURL(event).pathname
  }
  catch {
    return 'unknown'
  }
}

/** Logs `[server-error] route=<path> status=<n> code=<c>` and nothing else about `error`. */
export function logServerError(error: unknown, event?: H3Event): void {
  console.error(`[server-error] route=${routeOf(event)} status=${statusOf(error)} code=${codeOf(error)}`)
}
