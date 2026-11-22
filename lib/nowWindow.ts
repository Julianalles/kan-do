import { getTimeboxRingColor, getTimerBarShare } from '~/utils/timeboxProgress'

/**
 * @module nowWindow
 * @description The pure half of the floating Now window (#383, ADR 020): the names it shares with
 * `src-tauri/src/overlay.rs` (`tests/config/overlay-contract.test.ts` keeps both in step), the snapshot the main
 * window publishes, and what the pill derives from it (remaining time, the light's share, warning). Plain TypeScript, no store.
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
  /** Share of the timebox that is left, 1 at the start, 0 at the timebox; over it the share is `1` again and `over` is set (the full light in warning: it has run out); `null` without a timebox (no light) */
  line: number | null
  /** What `label` says: the time left, the overrun, or (no timebox) the time passed */
  mode: 'left' | 'over' | 'elapsed'
  /** Time label: `m:ss`, `h:mm:ss` from an hour, `+m:ss` for the overrun; without a timebox the time passed, counting up */
  label: string
  tone: NowTone
  over: boolean
  paused: boolean
}

function clock(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * The pill's light (a line until #565, a tint until #703) is a countdown (#436): it starts full and shrinks with the remaining time, in the app's colours
 * (`getTimeboxRingColor`: primary until 80 % of the timebox is spent, warning above and over it; no sound, D8). A task
 * without a timebox has no light; its label counts the time passed.
 */
export function nowView(snapshot: NowSnapshot, now: number): NowView {
  const spent = spentAt(snapshot, now)
  const box = snapshot.timeBoxSeconds
  const paused = !snapshot.running
  if (box === null) return { line: null, mode: 'elapsed', label: clock(spent), tone: 'normal', over: false, paused }
  const left = box - spent
  const bar = getTimerBarShare(spent, box)
  const over = bar?.over ?? false
  return {
    line: bar ? bar.share / 100 : null,
    mode: over ? 'over' : 'left',
    label: over ? `+${clock(-left)}` : clock(left),
    tone: getTimeboxRingColor((spent / box) * 100) === 'warning' ? 'warning' : 'normal',
    over,
    paused,
  }
}

/** What `lineAnimates` compares between two renders of the light */
export interface LineFrame {
  taskId: string
  /** The timebox in seconds, `null` without one */
  box: number | null
  over: boolean
  line: number | null
}

export function lineFrame(snapshot: NowSnapshot, view: NowView): LineFrame {
  return { taskId: snapshot.taskId, box: snapshot.timeBoxSeconds, over: view.over, line: view.line }
}

/** The longest step (in seconds of the timebox) the light still glides over: a tick, with a second of slack for a late timer */
const MAX_GLIDE_SECONDS = 2

/**
 * Whether the light's position may transition from `prev` to `next`. Only the per-tick shrink does: a new task, a changed
 * timebox, the step into the overrun (the share back to full), a clock jump or the first frame set the position without motion, so the
 * light never slides across the pill for something other than time passing (#436).
 */
export function lineAnimates(prev: LineFrame | null, next: LineFrame): boolean {
  if (!prev || prev.line === null || next.line === null || prev.box === null || prev.box !== next.box) return false
  if (prev.taskId !== next.taskId || prev.over || next.over) return false
  return Math.abs(prev.line - next.line) * prev.box <= MAX_GLIDE_SECONDS + 1e-6
}
