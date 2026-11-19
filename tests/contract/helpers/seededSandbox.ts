import type { Client } from '@notionhq/client'
import type { SandboxDatabase, SandboxStatusType } from '~/server/utils/notionSandbox'
import { createSandboxDatabase, seedSandbox, teardownSandbox } from '~/scripts/notion-sandbox.mts'

/**
 * Building a contract database (create it, seed its pages) is the one step of the contract test that is not an
 * assertion, so a transient Notion failure there (a 5xx, a timeout, a dropped connection) says nothing about the
 * routes under test. The Notion SDK retries only 429/529 for a POST, and `pages.create` must not be sent twice
 * after an unknown outcome (a duplicate page, #528): so a transient failure rebuilds the whole database from scratch.
 * Assertions are never retried, and any other failure (a 400 request shape, a 401, a 404) is thrown at once.
 */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504])
const TRANSIENT_CLIENT_CODES = new Set(['notionhq_client_request_timeout'])
const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])

type ErrorLike = { code?: unknown; status?: unknown; cause?: unknown; name?: unknown; message?: unknown }

/** True for a failure that says nothing about kan-do: Notion overloaded or unreachable, the request timed out. */
export const isTransientNotionError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  const { code, status, cause, name, message } = error as ErrorLike
  if (typeof status === 'number') return TRANSIENT_STATUSES.has(status)
  if (typeof code === 'string' && (TRANSIENT_CLIENT_CODES.has(code) || TRANSIENT_NETWORK_CODES.has(code))) return true
  // Node's fetch rejects with `TypeError: fetch failed` for any network-level failure, the socket error as its cause
  if (name === 'TypeError' && message === 'fetch failed') return true
  return isTransientNotionError(cause)
}

export interface RetryOptions {
  attempts?: number
  /** Runs between a failed attempt and the next one (trash what the failed attempt left behind). */
  cleanup?: () => Promise<void>
  warn?: (message: string) => void
}

/** Runs `step`, retrying only a transient failure. The last failure, and any permanent one, is rethrown unchanged. */
export async function withTransientRetry<T>(step: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, cleanup, warn = console.warn } = options
  for (let attempt = 1; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      if (attempt >= attempts || !isTransientNotionError(error)) throw error
      const detail = error instanceof Error ? error.message : String(error)
      warn(`[contract] transient Notion failure while building the sandbox database (attempt ${attempt}/${attempts}), rebuilding: ${detail}`)
      await cleanup?.()
    }
  }
}

/** Creates the sandbox database `label` and, with a scenario, seeds it; a transient failure rebuilds it from scratch. */
export const createSeededSandbox = (
  notion: Client,
  parentPageId: string,
  label: string,
  statusType: SandboxStatusType,
  scenario?: string,
): Promise<SandboxDatabase> =>
  withTransientRetry(
    async () => {
      const db = await createSandboxDatabase(notion, parentPageId, label, statusType)
      if (scenario) await seedSandbox(notion, db, scenario)
      return db
    },
    // Trashed by label: also covers a create whose outcome was unknown
    { cleanup: async () => { await teardownSandbox(notion, parentPageId, label) } },
  )
