/**
 * @module lib/integrationHealth
 * @description Per-source integration health: defaults and the hydrate-time normaliser (#318).
 *
 * `integration-health-store` used to persist `{ notion, notionLastErrorReason }`. It now persists
 * `{ sources: Record<IntegrationSourceId, SourceHealth> }`. The normaliser is pure and idempotent and
 * returns its input untouched (same reference) when nothing needs to change, so hydration skips the
 * write-back (#273). Health is derived status, relearned by the next fetch, so there is no envelope
 * migration: an older build ignores the new key, a newer one converts the old keys here.
 */
import type { IntegrationHealth, SourceHealth, SourceHealthMap } from '~/types/integration'
import { INTEGRATION_SOURCE_IDS, type IntegrationSourceId } from '~/types/taskSource'
import { isNetworkError } from '~/lib/errorMessages'

const STATUSES: readonly IntegrationHealth[] = ['unconfigured', 'healthy', 'degraded', 'broken', 'offline']

/** Keys of the pre-#318 shape; the normaliser folds them into `sources.notion` and drops them. */
export const LEGACY_HEALTH_KEYS = ['notion', 'notionLastErrorReason'] as const

export function emptySourceHealth(): SourceHealth {
  return { status: 'unconfigured', lastError: null, lastSuccessfulSync: null }
}

export function emptySourceHealthMap(): SourceHealthMap {
  return { notion: emptySourceHealth(), todoist: emptySourceHealth(), reminders: emptySourceHealth() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameEntry(a: SourceHealth, b: SourceHealth): boolean {
  return a.status === b.status && a.lastError === b.lastError && a.lastSuccessfulSync === b.lastSuccessfulSync
}

/** A stored entry made valid; returns it itself when it already was. */
function normalizeEntry(raw: unknown): SourceHealth {
  if (!isRecord(raw)) return emptySourceHealth()
  const status = STATUSES.includes(raw.status as IntegrationHealth) ? (raw.status as IntegrationHealth) : 'unconfigured'
  const lastError = typeof raw.lastError === 'string' ? raw.lastError : null
  const lastSuccessfulSync = typeof raw.lastSuccessfulSync === 'number' && Number.isFinite(raw.lastSuccessfulSync)
    ? raw.lastSuccessfulSync
    : null
  const next: SourceHealth = { status, lastError, lastSuccessfulSync }
  return sameEntry(raw as unknown as SourceHealth, next) && Object.keys(raw).length === 3 ? (raw as unknown as SourceHealth) : next
}

/**
 * Normalises the persisted state of the health store: a state without `sources` takes the legacy
 * `notion` status and `notionLastErrorReason`, every integration gets a valid entry, and the legacy
 * keys go. Returns the input itself when it already is in the current shape. The legacy state had no
 * per-source sync time, only the board's `tasks-store.lastSyncTimestamp` (`legacyLastSync`, epoch ms): that
 * seeds `sources.notion.lastSuccessfulSync` once, so the first sync warning after the upgrade does not say "never".
 */
export function normalizeIntegrationHealthState<T>(raw: T, legacyLastSync: number | null = null): T {
  if (!isRecord(raw)) return { sources: emptySourceHealthMap() } as T
  const hasLegacy = LEGACY_HEALTH_KEYS.some((key) => key in raw)
  const stored = isRecord(raw.sources) ? raw.sources : null

  const sources = {} as SourceHealthMap
  let changed = hasLegacy || stored === null
  for (const id of INTEGRATION_SOURCE_IDS) {
    let entry = normalizeEntry(stored?.[id])
    if (stored === null && id === 'notion' && STATUSES.includes(raw.notion as IntegrationHealth)) {
      entry = {
        ...entry,
        status: raw.notion as IntegrationHealth,
        lastError: typeof raw.notionLastErrorReason === 'string' ? raw.notionLastErrorReason : null,
        lastSuccessfulSync: entry.lastSuccessfulSync ?? legacyLastSync,
      }
    }
    if (entry !== stored?.[id]) changed = true
    sources[id] = entry
  }
  if (stored !== null && Object.keys(stored).some((key) => !(INTEGRATION_SOURCE_IDS as readonly string[]).includes(key))) {
    changed = true
  }
  if (!changed) return raw
  const { notion: _status, notionLastErrorReason: _reason, ...rest } = raw
  return { ...rest, sources } as T
}

/**
 * Whether a state `normalizeIntegrationHealthState` changed must be written back (#273). A state that only lacks the entry
 * of an integration added since it was stored (Apple Reminders, #551) is complete in memory and needs no write: the entry
 * is persisted with the next mutation, and a launch that changed nothing never marks the desktop data as edited.
 */
export function healthNeedsWriteBack(raw: unknown, normalised: unknown): boolean {
  if (raw === normalised) return false
  if (!isRecord(raw) || !isRecord(raw.sources) || !isRecord(normalised) || !isRecord(normalised.sources)) return true
  if (LEGACY_HEALTH_KEYS.some((key) => key in raw)) return true
  if (Object.keys(raw.sources).some((key) => !(INTEGRATION_SOURCE_IDS as readonly string[]).includes(key))) return true
  const stored = raw.sources
  const next = normalised.sources as Record<string, unknown>
  return INTEGRATION_SOURCE_IDS.some((id) => id in stored && stored[id] !== next[id])
}

type ErrorFields = { name?: string; statusCode?: number; httpStatusCode?: number; code?: string; data?: { error?: string }; cause?: unknown }

/**
 * The error that says what went wrong: the first one in the `cause` chain that carries an HTTP status or a
 * code, else `error` itself. `NotionIntegration.verifyDatabaseAccess` wraps every failure in a plain
 * `Error('Cannot access Notion database: ...', { cause })`, which hides the 401 or 404 of the API behind it.
 */
function unwrapCause(error: unknown): unknown {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current)
    const { statusCode, httpStatusCode, code, data, cause } = current as ErrorFields
    if (statusCode !== undefined || httpStatusCode !== undefined || code !== undefined || data?.error !== undefined) return current
    current = cause
  }
  return error
}

/**
 * What a failed fetch says about a source's health (#318): no connection, credentials or access the source
 * rejects (or never had: 401, 403, a database that is gone: 404), or anything else. The offline test also
 * catches `statusCode: 0`, which `NotionClientAPI` gives a fetch failure or timeout. Looks through
 * `error.cause` for the status.
 */
export function classifySyncFailure(error: unknown): 'offline' | 'broken' | 'degraded' {
  const cause = unwrapCause(error)
  const status = cause as ErrorFields | null
  if (status?.name === 'SourceNotConfiguredError') return 'broken'
  // The native Reminders bridge (#551): no permission is the one failure that is the source's (macOS holds it)
  if (status?.name === 'RemindersError') return (status as { kind?: string }).kind === 'access-denied' ? 'broken' : 'degraded'
  const httpStatus = status?.statusCode ?? status?.httpStatusCode
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 404 || status?.code === 'UNAUTHORIZED' || status?.data?.error === 'UNAUTHORIZED') {
    return 'broken'
  }
  if (isNetworkError(cause) || httpStatus === 0) return 'offline'
  return 'degraded'
}

/**
 * Whether a failed write says something about the whole source or only about the task it carried (#319).
 * The source is at fault when it cannot be reached or does not accept us at all: no connection, a missing
 * setup, a rejected token (401). A page it refuses (400, 403, 404 for an archived or deleted page, a 5xx on
 * that request) is the task's problem: its marker records the reason and the source stays as it is.
 */
export function pushFailureScope(error: unknown): 'source' | 'task' {
  const failure = classifySyncFailure(error)
  if (failure === 'offline') return 'source'
  if (failure === 'degraded') return 'task'
  const cause = unwrapCause(error) as ErrorFields | null
  const httpStatus = cause?.statusCode ?? cause?.httpStatusCode
  return httpStatus === 403 || httpStatus === 404 ? 'task' : 'source'
}

/**
 * Whether a failed request was a 429 (#529): a limit on the whole source, not a fault of the task it carried. Looks
 * through `error.cause` like the other classifiers. `retryAfterMs` is what the response's `Retry-After` asked for
 * (`NotionAPIError.retryAfterMs`), null when it named no wait. Returns null for every other failure.
 */
export function rateLimitOf(error: unknown): { retryAfterMs: number | null } | null {
  const cause = unwrapCause(error) as (ErrorFields & { retryAfterMs?: unknown }) | null
  if ((cause?.statusCode ?? cause?.httpStatusCode) !== 429) return null
  const wait = cause?.retryAfterMs
  return { retryAfterMs: typeof wait === 'number' && Number.isFinite(wait) && wait > 0 ? wait : null }
}

/** A connected source that cannot sync right now, with what the user may need to know. */
export interface SourceProblem {
  source: IntegrationSourceId
  status: 'broken' | 'offline' | 'degraded'
  lastError: string | null
}

const PROBLEM_ORDER: readonly SourceProblem['status'][] = ['broken', 'offline', 'degraded']

/**
 * The connected sources that cannot sync, worst first (`broken` before `offline` before `degraded`; the
 * board order breaks ties). The sync button shows the first one's state and the popover lists all (#319).
 */
export function sourceProblems(sources: SourceHealthMap, connected: readonly IntegrationSourceId[]): SourceProblem[] {
  return connected
    .flatMap((source) => {
      const { status, lastError } = sources[source]
      return PROBLEM_ORDER.includes(status as SourceProblem['status']) ? [{ source, status: status as SourceProblem['status'], lastError }] : []
    })
    .sort((a, b) => PROBLEM_ORDER.indexOf(a.status) - PROBLEM_ORDER.indexOf(b.status))
}

/**
 * The lookup that runs before a create in doubt (#528), or the write that adopts the page it found, failed. No create
 * was sent, so the doubt stays as it was (`createOutcomeUnknown` is false); the `cause` keeps the status, so a failed
 * push is classified as before.
 */
export class CreateLookupError extends Error {
  readonly createNotSent = true
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause })
    this.name = 'CreateLookupError'
  }
}

/**
 * The lookup before a create in doubt found no page, but the doubtful create may still land (`createMayLandUntil`):
 * nothing is created yet and the task stays queued with its doubt. Not a failure: no marker is written, no toast shown;
 * the next push looks again (#528).
 */
export class CreateWaitingError extends Error {
  readonly createNotSent = true
  readonly createWaiting = true
  constructor() {
    super('A create with an unknown outcome may still land; waiting before the page is created')
    this.name = 'CreateWaitingError'
  }
}

/** Whether `error` is a `CreateWaitingError`: a quiet "not yet", never a failure to report. */
export const isCreateWaiting = (error: unknown): boolean => (error as { createWaiting?: unknown } | null)?.createWaiting === true

/**
 * Whether a failed create may still have made the page (#528): the request was sent and no answer says it was
 * refused, i.e. a timeout, an abort or a network error (status 0) or a 5xx. A 429 and every 4xx refused it before
 * a page was made. `NotionClientAPI` does not send such a create again by itself; the task carries
 * `pendingSync.createUncertain` and the next create looks the page up first.
 */
export function createOutcomeUnknown(error: unknown): boolean {
  // The lookup before a create failed: no create was sent, whatever status the lookup's request carried
  if ((error as { createNotSent?: unknown } | null)?.createNotSent === true) return false
  const cause = unwrapCause(error) as ErrorFields | null
  if (cause?.name === 'SourceNotConfiguredError') return false
  const httpStatus = cause?.statusCode ?? cause?.httpStatusCode
  return httpStatus === 0 || (httpStatus !== undefined && httpStatus >= 500) || (httpStatus === undefined && isNetworkError(cause))
}

/**
 * What a failed create says about the task (#321), by the same scope rule as a failed push
 * (`pushFailureScope`): `transient` when the source could not take it right now, so the task is kept locally
 * with its marker and created on the next push: no connection, a missing setup, a rejected token (401, the
 * source's fault) or a refusal of this page that may pass (403 while the integration is not yet shared with the
 * database, a 429 rate limit (#507), a 5xx; the task's fault, so the source's health stays as it is).
 * `rejected` when the source refuses this very task for good (an invalid property, 409, any other 4xx, a database that is gone: 404), which the
 * user must fix in the form.
 */
export function createFailureKind(error: unknown): 'transient' | 'rejected' {
  if (isCreateWaiting(error)) return 'transient'
  if (pushFailureScope(error) === 'source') return 'transient'
  const cause = unwrapCause(error) as ErrorFields | null
  const httpStatus = cause?.statusCode ?? cause?.httpStatusCode
  return httpStatus === 403 || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500) ? 'transient' : 'rejected'
}
