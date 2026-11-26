/**
 * @module remoteCommands
 * @description The desktop side of the MCP bridge (ADR 023): turns a command queued by the `kando-mcp` Worker ("start work
 * on X", "45 minutes on X yesterday") into the app's own operations, and a board into the snapshot the Worker serves back.
 * Pure: every board operation arrives through `RemoteBoardDeps`, so the real wiring (`useTaskSync`, `useTaskOperations`,
 * the tasks store) stays in one place and the rules (one task in Jetzt, source sync, pending-sync markers) are the app's own.
 */
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import { isNotPlanned } from '~/lib/taskPlanning'

export type RemoteBoardStatus = 'open' | 'progress' | 'waiting' | 'done'

export interface RemoteCommand {
  id: string
  type: 'start_work' | 'log_time' | 'add_task' | 'set_status' | 'set_timebox'
  payload: Record<string, unknown>
}

export interface RemoteResult {
  ok: boolean
  message: string
}

export interface RemoteSnapshot {
  day: string
  tasks: {
    id: string
    title: string
    status: RemoteBoardStatus
    timeBoxMinutes: number | null
    timeSpentMinutes: number
    topic: string | null
    source: string
  }[]
}

/** The board operations a command may use. The caller wires them to the real store and sync. */
export interface RemoteBoardDeps {
  /** Every task of the board that is not archived or in the trash. */
  tasks(): Task[]
  /** Start of the local day. */
  today(): Date
  defaultSource(): SourceId
  createTask(draft: Partial<Task>, source: SourceId): Promise<Task>
  /** The guarded board move (`useTaskOperations().moveTaskToStatus`); false when refused. */
  moveToStatus(taskId: string, status: TaskStatus): Promise<boolean>
  /** Writes a new total (seconds) like the user's own time edit does, including the source push. */
  setTimeSpent(taskId: string, seconds: number): Promise<void>
  /** Stored plus not yet checkpointed seconds (`liveTimeSpent`). */
  timeSpent(task: Task): number
  setTimeBox(taskId: string, seconds: number): Promise<void>
}

const STATUS_TO_ENUM: Record<RemoteBoardStatus, TaskStatus> = {
  open: TaskStatus.Open,
  progress: TaskStatus.Progress,
  waiting: TaskStatus.Waiting,
  done: TaskStatus.Done,
}

const STATUS_LABEL: Record<RemoteBoardStatus, string> = { open: 'Offen', progress: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }

export const normalizeTitle = (value: string): string => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')

export type TitleMatch = { kind: 'found'; task: Task } | { kind: 'ambiguous'; titles: string[] } | { kind: 'none' }

/**
 * Finds the task a spoken title means: an exact match (case and spacing aside) wins; otherwise the one task whose title contains
 * the words or is contained in them. Several candidates are never guessed: the caller reports them so the user can be specific.
 * An open task is preferred over a finished one with the same title.
 */
export function findTaskByTitle(tasks: readonly Task[], title: string): TitleMatch {
  const wanted = normalizeTitle(title)
  if (wanted === '') return { kind: 'none' }
  const rank = (list: Task[]): Task[] => [...list].sort((a, b) => Number(a.status === TaskStatus.Done) - Number(b.status === TaskStatus.Done))
  const exact = rank(tasks.filter(task => normalizeTitle(task.title) === wanted))
  if (exact.length > 0) return { kind: 'found', task: exact[0]! }
  const loose = rank(tasks.filter((task) => {
    const have = normalizeTitle(task.title)
    return have.includes(wanted) || (have.length >= 4 && wanted.includes(have))
  }))
  const open = loose.filter(task => task.status !== TaskStatus.Done)
  const pool = open.length > 0 ? open : loose
  if (pool.length === 1) return { kind: 'found', task: pool[0]! }
  if (pool.length > 1) return { kind: 'ambiguous', titles: pool.slice(0, 5).map(task => task.title) }
  return { kind: 'none' }
}

const statusOf = (status: TaskStatus): RemoteBoardStatus | null => {
  switch (status) {
    case TaskStatus.Open: return 'open'
    case TaskStatus.Progress: return 'progress'
    case TaskStatus.Waiting: return 'waiting'
    case TaskStatus.Done: return 'done'
    default: return null
  }
}

/** Today's board as the Worker serves it: planned Offen, Jetzt and Wartet tasks plus what was finished today. */
export function buildSnapshot(tasks: readonly Task[], today: Date, dayKey: string, timeSpent: (task: Task) => number): RemoteSnapshot {
  const rows: RemoteSnapshot['tasks'] = []
  for (const task of tasks) {
    const status = statusOf(task.status)
    if (status === null || task.archivedAt) continue
    if (status === 'done') {
      if (task.completedAt && new Date(task.completedAt) < today) continue
    } else if (isNotPlanned(task)) {
      continue
    }
    rows.push({
      id: task.id,
      title: task.title.slice(0, 500),
      status,
      timeBoxMinutes: task.timeBoxSeconds ? Math.round(task.timeBoxSeconds / 60) : null,
      timeSpentMinutes: Math.round(timeSpent(task) / 60),
      topic: task.topic ?? null,
      source: task.source,
    })
  }
  return { day: dayKey, tasks: rows.slice(0, 300) }
}

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null)
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)
const isStatus = (value: unknown): value is RemoteBoardStatus => typeof value === 'string' && value in STATUS_TO_ENUM

/** Local noon of a `YYYY-MM-DD` day: unambiguous for the day split in every timezone. */
const dayToDate = (day: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const date = new Date(`${day}T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

const failure = (message: string): RemoteResult => ({ ok: false, message })

function describeAmbiguity(match: Extract<TitleMatch, { kind: 'ambiguous' }>): RemoteResult {
  return failure(`Several tasks match: ${match.titles.map(title => `"${title}"`).join(', ')}. Say which one.`)
}

/** Applies one command. Never throws: a failure becomes a result the Worker hands back to Claude. */
export async function applyRemoteCommand(command: RemoteCommand, deps: RemoteBoardDeps): Promise<RemoteResult> {
  try {
    return await apply(command, deps)
  } catch (error) {
    return failure(error instanceof Error ? error.message.slice(0, 200) : 'Unexpected error')
  }
}

async function apply({ type, payload }: RemoteCommand, deps: RemoteBoardDeps): Promise<RemoteResult> {
  const title = str(payload.title)
  if (title === null) return failure('A title is required.')
  const match = findTaskByTitle(deps.tasks(), title)
  if (match.kind === 'ambiguous') return describeAmbiguity(match)

  switch (type) {
    case 'start_work': {
      let task: Task
      let created = false
      if (match.kind === 'found') {
        task = match.task
      } else {
        const timeBox = num(payload.timeBoxMinutes)
        task = await deps.createTask({ title, status: TaskStatus.Open, ...(timeBox ? { timeBoxSeconds: Math.round(timeBox) * 60 } : {}) }, deps.defaultSource())
        created = true
      }
      if (task.status === TaskStatus.Progress) return { ok: true, message: `"${task.title}" is already in Jetzt.` }
      // Jetzt holds one task: the one in it is paused, never dropped or finished.
      const current = deps.tasks().find(other => other.status === TaskStatus.Progress && other.id !== task.id)
      if (current && !(await deps.moveToStatus(current.id, TaskStatus.Waiting))) return failure(`Could not pause "${current.title}" in Jetzt.`)
      if (!(await deps.moveToStatus(task.id, TaskStatus.Progress))) return failure(`Could not move "${task.title}" to Jetzt.`)
      const extra = [created ? 'created' : null, current ? `paused "${current.title}" to Wartet` : null].filter(Boolean).join(', ')
      return { ok: true, message: `"${task.title}" is in Jetzt, timer running${extra ? ` (${extra})` : ''}.` }
    }

    case 'log_time': {
      const minutes = num(payload.minutes)
      if (minutes === null) return failure('minutes must be a positive number.')
      const seconds = Math.round(minutes * 60)
      if (match.kind === 'found') {
        await deps.setTimeSpent(match.task.id, deps.timeSpent(match.task) + seconds)
        return { ok: true, message: `Added ${minutes} minutes to "${match.task.title}" (now ${Math.round((deps.timeSpent(match.task) + seconds) / 60)} minutes). Board unchanged.` }
      }
      const day = str(payload.day)
      const when = day === null ? new Date() : dayToDate(day)
      if (when === null) return failure('day must be YYYY-MM-DD.')
      await deps.createTask({ title, status: TaskStatus.Done, completedAt: when, timeSpentSeconds: seconds }, deps.defaultSource())
      return { ok: true, message: `Created "${title}" as Erledigt${day ? ` on ${day}` : ''} with ${minutes} minutes.` }
    }

    case 'add_task': {
      const status = isStatus(payload.status) ? payload.status : 'open'
      const timeBox = num(payload.timeBoxMinutes)
      const draft: Partial<Task> = {
        title,
        status: TaskStatus.Open,
        ...(timeBox ? { timeBoxSeconds: Math.round(timeBox) * 60 } : {}),
        ...(str(payload.topic) ? { topic: str(payload.topic) } : {}),
        ...(str(payload.notes) ? { notes: str(payload.notes) } : {}),
      }
      if (match.kind === 'found' && normalizeTitle(match.task.title) === normalizeTitle(title) && match.task.status !== TaskStatus.Done) {
        return { ok: true, message: `"${match.task.title}" already exists (${STATUS_LABEL[statusOf(match.task.status) ?? 'open']}); nothing added.` }
      }
      const task = await deps.createTask(draft, deps.defaultSource())
      if (status !== 'open' && !(await deps.moveToStatus(task.id, STATUS_TO_ENUM[status]))) {
        return { ok: true, message: `Created "${title}" in Offen; the move to ${STATUS_LABEL[status]} was refused.` }
      }
      return { ok: true, message: `Created "${title}" in ${STATUS_LABEL[status]}.` }
    }

    case 'set_status': {
      if (!isStatus(payload.status)) return failure('status must be open, progress, waiting or done.')
      if (match.kind === 'none') return failure(`No task matches "${title}".`)
      const target = STATUS_TO_ENUM[payload.status]
      if (match.task.status === target) return { ok: true, message: `"${match.task.title}" is already in ${STATUS_LABEL[payload.status]}.` }
      const current = target === TaskStatus.Progress ? deps.tasks().find(other => other.status === TaskStatus.Progress && other.id !== match.task.id) : undefined
      if (current && !(await deps.moveToStatus(current.id, TaskStatus.Waiting))) return failure(`Could not pause "${current.title}" in Jetzt.`)
      if (!(await deps.moveToStatus(match.task.id, target))) return failure(`Move of "${match.task.title}" to ${STATUS_LABEL[payload.status]} was refused.`)
      return { ok: true, message: `"${match.task.title}" is now ${STATUS_LABEL[payload.status]}${current ? ` ("${current.title}" paused to Wartet)` : ''}.` }
    }

    case 'set_timebox': {
      const minutes = num(payload.minutes)
      if (minutes === null) return failure('minutes must be a positive number.')
      if (match.kind === 'none') return failure(`No task matches "${title}".`)
      await deps.setTimeBox(match.task.id, Math.round(minutes) * 60)
      return { ok: true, message: `Time box of "${match.task.title}" is ${Math.round(minutes)} minutes.` }
    }

    default:
      return failure(`Unknown command ${String(type)}.`)
  }
}
