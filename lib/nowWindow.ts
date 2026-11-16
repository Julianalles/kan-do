/**
 * @module nowWindow
 * @description The pure half of the floating Now window (#383, ADR 020): the names it shares with
 * `src-tauri/src/overlay.rs` (`tests/config/overlay-contract.test.ts` keeps both in step), the snapshot the main
 * window publishes, and what the pill derives from it (remaining time, ring, warning). Plain TypeScript, no store.
 */

/** Label of the pill window (also the key of `capabilities/overlay.json`). */
export const OVERLAY_LABEL = 'overlay'
/** Rust to the pill: the snapshot or `null`. */
export const OVERLAY_STATE_EVENT = 'overlay://state'
/** Rust to the main window: an action the pill asked for. */
export const OVERLAY_ACTION_EVENT = 'overlay://action'
/** What the pill may ask for; `open` is handled in Rust, the rest travels to the main window. */
export const OVERLAY_ACTIONS = ['open', 'toggle-pause', 'done'] as const
export type OverlayAction = (typeof OVERLAY_ACTIONS)[number]

/** The Jetzt task as the pill shows it: `spentSeconds` was true at `at` (epoch ms); `running` is false while paused. */
export interface NowSnapshot {
  taskId: string
  title: string
  timeBoxSeconds: number | null
  spentSeconds: number
  at: number
  running: boolean
  locale: string
}

/** Payload of `ACTION_EVENT`. */
export interface OverlayActionPayload {
  kind: OverlayAction
  taskId: string
}

/** A snapshot arriving over the wire is data: anything that is not one reads as none (the pill hides). */
export function parseSnapshot(value: unknown): NowSnapshot | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const box = v.timeBoxSeconds
  if (typeof v.taskId !== 'string' || typeof v.title !== 'string' || typeof v.locale !== 'string') return null
  if (typeof v.spentSeconds !== 'number' || !Number.isFinite(v.spentSeconds) || typeof v.at !== 'number' || typeof v.running !== 'boolean') return null
  if (box !== null && (typeof box !== 'number' || !Number.isFinite(box) || box <= 0)) return null
  return {
    taskId: v.taskId,
    title: v.title,
    timeBoxSeconds: box as number | null,
    spentSeconds: Math.max(0, v.spentSeconds),
    at: v.at,
    running: v.running,
    locale: v.locale,
  }
}

/** Seconds the task has run at `now`: the snapshot's count plus the wall-clock time since it, while it runs. */
export function spentAt(snapshot: NowSnapshot, now: number): number {
  const extra = snapshot.running ? Math.max(0, Math.floor((now - snapshot.at) / 1000)) : 0
  return snapshot.spentSeconds + extra
}

export type NowTone = 'normal' | 'warning'

export interface NowView {
  /** `null` without a timebox: the pill then shows the title only */
  ring: number | null
  /** Time label, `null` without a timebox: `m:ss`, `h:mm:ss` from an hour, `+m:ss` for the overrun */
  label: string | null
  tone: NowTone
  over: boolean
  paused: boolean
}

/** The last minute turns the ring and time amber; over the timebox they stay amber (no sound, D8). */
export const WARNING_SECONDS = 60

function clock(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

export function nowView(snapshot: NowSnapshot, now: number): NowView {
  const spent = spentAt(snapshot, now)
  const box = snapshot.timeBoxSeconds
  const paused = !snapshot.running
  if (box === null) return { ring: null, label: null, tone: 'normal', over: false, paused }
  const left = box - spent
  const over = left < 0
  return {
    ring: Math.min(1, spent / box),
    label: over ? `+${clock(-left)}` : clock(left),
    tone: left <= WARNING_SECONDS ? 'warning' : 'normal',
    over,
    paused,
  }
}
