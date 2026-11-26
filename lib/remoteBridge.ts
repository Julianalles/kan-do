/**
 * @module remoteBridge
 * @description Pure helpers of the MCP bridge (ADR 023): the ledger of command ids the app has applied, and the tolerant
 * reader of the Worker's command list. The transport is Rust (`bridge_request`), the driver `composables/useRemoteBridge.ts`.
 */
import type { RemoteCommand } from '~/lib/remoteCommands'

/** Applied ids older than this, or beyond the newest `LEDGER_MAX`, are forgotten: the Worker keeps a command pending far shorter than that matters. */
export const LEDGER_DAYS = 14
export const LEDGER_MAX = 200

const DAY_MS = 24 * 60 * 60 * 1000

/** What the ledger holds: `commandId -> epoch ms it was applied`. */
export type AppliedLedger = Record<string, number>

/** A stored ledger read tolerantly: anything that is not `{ id: finite number }` is dropped, a non-object reads as empty. */
export function sanitizeLedger(value: unknown): AppliedLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: AppliedLedger = {}
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === 'number' && Number.isFinite(at) && at > 0) out[id] = at
  }
  return out
}

/** The ledger without entries older than `LEDGER_DAYS`, and at most the newest `LEDGER_MAX`. */
export function pruneLedger(ledger: AppliedLedger, now: number): AppliedLedger {
  const fresh = Object.entries(ledger)
    .filter(([, at]) => now - at <= LEDGER_DAYS * DAY_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LEDGER_MAX)
  return Object.fromEntries(fresh)
}

const COMMAND_TYPES: ReadonlySet<string> = new Set(['start_work', 'log_time', 'add_task', 'set_status', 'set_timebox'])

/** The commands of a `GET /sync/commands` body, oldest first as sent; anything malformed is skipped, never thrown on. */
export function parseCommands(body: unknown): RemoteCommand[] {
  const list = (body as { commands?: unknown } | null)?.commands
  if (!Array.isArray(list)) return []
  const out: RemoteCommand[] = []
  for (const entry of list) {
    const { id, type, payload } = (entry ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) continue
    if (typeof type !== 'string' || !COMMAND_TYPES.has(type)) continue
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    out.push({ id, type: type as RemoteCommand['type'], payload: payload as Record<string, unknown> })
  }
  return out
}
