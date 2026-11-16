/**
 * #357: a connection may have a planning state of its own (Notion with "not planned" statuses mapped; Todoist, where
 * every task starts not planned). `Task.sourceNotPlanned` holds what the source said last; `mergeTasks` changes
 * kan-do's marker only when that answer changes, so kan-do's own moves survive a sync.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore, sanitizeSourceBackNotes } from '~/store/board'
import { isNotPlanned, sourceMarker } from '~/lib/taskPlanning'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const source = overrides.source ?? 'notion'
  return {
    id, source, externalId: source === 'local' ? null : id, title: `Task ${id}`, status: TaskStatus.Open, activity: null,
    topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
    ...overrides,
  }
}
const HELD = 'todoist:open'
const todoist = (id: string, overrides: Partial<Task> = {}) => makeTask(id, { source: 'todoist', sourceNotPlanned: HELD, ...overrides })

describe('sourceMarker', () => {
  it('a task seen for the first time starts where its source holds it', () => {
    expect(sourceMarker(false, undefined, 'Backlog', true)).toBe(true)
    expect(sourceMarker(false, undefined, undefined, true)).toBe(false)
  })
  it('the same answer as last time leaves the local marker alone', () => {
    expect(sourceMarker(true, undefined, undefined)).toBe(true)
    expect(sourceMarker(false, 'Backlog', 'Backlog')).toBe(false)
    // another "not planned" status is no move
    expect(sourceMarker(false, 'Backlog', 'Someday')).toBe(false)
  })
  it('a change at the source wins', () => {
    expect(sourceMarker(false, undefined, 'Backlog')).toBe(true)
    expect(sourceMarker(true, 'Backlog', undefined)).toBe(false)
  })
})

describe('mergeTasks follows a source only when its planning state changes (#357)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a task without the field (data stored before #357) merges as before: planned stays planned, held stays held', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a'), makeTask('b', { notPlanned: true })])
    expect(store.mergeTasks('notion', [makeTask('a'), makeTask('b')])).toEqual([])
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(isNotPlanned(store.task('b')!)).toBe(true)
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
  })

  it('a new task starts not planned when its source holds it so, and is not reported as taken off the board', () => {
    const store = useTasksStore()
    const taken = store.mergeTasks('notion', [makeTask('n', { sourceNotPlanned: 'Backlog' }), makeTask('p'), makeTask('d', { status: TaskStatus.Done, sourceNotPlanned: 'Backlog' })])
    expect(taken).toEqual([])
    expect(isNotPlanned(store.task('n')!)).toBe(true)
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['n'])
    expect(store.tasksOpen.map(t => t.id)).toEqual(['p'])
    expect(store.task('d')!.notPlanned).toBeUndefined()
  })

  it('a fetched marker is never taken as it is: only the source value counts', () => {
    const store = useTasksStore()
    store.mergeTasks('notion', [makeTask('x', { notPlanned: true })])
    expect(isNotPlanned(store.task('x')!)).toBe(false)
  })

  it('Notion moved a task into a "not planned" status: it leaves the board, also from Jetzt, and is reported only from Offen', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('o'), makeTask('j', { status: TaskStatus.Progress })])
    const taken = store.mergeTasks('notion', [makeTask('o', { sourceNotPlanned: 'Backlog' }), makeTask('j', { sourceNotPlanned: 'Backlog' })])
    expect(taken).toEqual(['o'])
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['j', 'o'])
    expect(store.task('o')!.sourceNotPlanned).toBe('Backlog')
  })

  it('Notion moved a task from "not planned" to today: it shows in Offen', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a', { notPlanned: true, sourceNotPlanned: 'Backlog' })])
    store.mergeTasks('notion', [makeTask('a')])
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
    expect(store.tasksOpen.map(t => t.id)).toEqual(['a'])
  })

  it('a task kan-do put back by itself (the source still says planned) stays put back, fetch after fetch', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a')])
    store.unplanTasks(['a'])
    store.mergeTasks('notion', [makeTask('a')])
    store.mergeTasks('notion', [makeTask('a')])
    expect(isNotPlanned(store.task('a')!)).toBe(true)
  })

  it('a task the user planned while the source still holds it as not planned stays planned (a stale fetch, Todoist always)', () => {
    const store = useTasksStore()
    store.mergeTasks('todoist', [todoist('t')])
    expect(isNotPlanned(store.task('t')!)).toBe(true)
    store.planTasks(['t'])
    store.mergeTasks('todoist', [todoist('t')])
    store.mergeTasks('todoist', [todoist('t')])
    expect(isNotPlanned(store.task('t')!)).toBe(false)
    // put back again by hand: stays back
    store.unplanTasks(['t'])
    store.mergeTasks('todoist', [todoist('t')])
    expect(isNotPlanned(store.task('t')!)).toBe(true)
  })

  it('a task with an unpushed change keeps its local planning state and value', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a', { notPlanned: true, sourceNotPlanned: 'Backlog' })])
    store.markPendingSync('a')
    store.mergeTasks('notion', [makeTask('a')])
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    expect(store.task('a')!.sourceNotPlanned).toBe('Backlog')
  })

  it('existing Todoist board, first fetch after the update: Offen moves once, Jetzt, Wartet and Erledigt stay, what was held stays held', () => {
    const store = useTasksStore()
    const before = (id: string, overrides: Partial<Task> = {}) => makeTask(id, { source: 'todoist', ...overrides })
    store.setTasks([
      before('o1'), before('o2'), before('held', { notPlanned: true }),
      before('j', { status: TaskStatus.Progress }), before('w', { status: TaskStatus.Waiting }), before('d', { status: TaskStatus.Done }),
    ])
    const fetched = [todoist('o1'), todoist('o2'), todoist('held'), todoist('j'), todoist('w'), todoist('d', { status: TaskStatus.Done })]
    const taken = store.mergeTasks('todoist', fetched, { holdsOnlyOpenDone: true })
    expect(taken).toEqual(['o1', 'o2'])
    expect(store.tasksOpen).toEqual([])
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['held', 'o1', 'o2'])
    expect(store.task('j')!.status).toBe(TaskStatus.Progress)
    expect(store.task('w')!.status).toBe(TaskStatus.Waiting)
    expect(store.task('d')!.status).toBe(TaskStatus.Done)

    // the second fetch moves nothing: a card planned again stays, a Jetzt task moved back to Offen stays on the board
    store.planTasks(['o1'])
    store.updateTask('j', { status: TaskStatus.Open })
    expect(store.mergeTasks('todoist', fetched, { holdsOnlyOpenDone: true })).toEqual([])
    expect(store.tasksOpen.map(t => t.id).sort()).toEqual(['j', 'o1'])
  })

  it('a source that only knows open and done keeps Jetzt and Wartet, and still follows a completion', () => {
    const store = useTasksStore()
    store.setTasks([todoist('j', { status: TaskStatus.Progress }), todoist('w', { status: TaskStatus.Waiting })])
    store.mergeTasks('todoist', [todoist('j'), todoist('w', { status: TaskStatus.Done })], { holdsOnlyOpenDone: true })
    expect(store.task('j')!.status).toBe(TaskStatus.Progress)
    expect(store.task('w')!.status).toBe(TaskStatus.Done)
    // without the option (Notion) the source's status wins as before
    store.setTasks([makeTask('n', { status: TaskStatus.Progress })])
    store.mergeTasks('notion', [makeTask('n')])
    expect(store.task('n')!.status).toBe(TaskStatus.Open)
  })

  it('a move to another source drops the value and its undo brings it back', () => {
    const store = useTasksStore()
    store.setTasks([todoist('t')])
    const previous = store.reassignSource('t', 'local')
    expect(store.task('t')!.sourceNotPlanned).toBeUndefined()
    store.restoreMoveOrigin('t', previous!)
    expect(store.task('t')!.sourceNotPlanned).toBe(HELD)
    // so the next fetch does not read the task as changed at the source
    store.mergeTasks('todoist', [todoist('t')])
    expect(isNotPlanned(store.task('t')!)).toBe(false)
  })
})

describe('the one-time note of a source (#357)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('is written once per source and closed for good', () => {
    const board = useBoardStore()
    board.noteSourceBack('todoist', [])
    expect(board.sourceBackNotes).toEqual({})
    board.noteSourceBack('todoist', ['a', 'b'])
    board.noteSourceBack('todoist', ['c'])
    expect(board.sourceBackNotes).toEqual({ todoist: { ids: ['a', 'b'], closed: false } })
    board.closeSourceBackNote('todoist')
    board.noteSourceBack('todoist', ['c'])
    expect(board.sourceBackNotes).toEqual({ todoist: { ids: ['a', 'b'], closed: true } })
  })

  it('older or malformed stored data reads as no note', () => {
    for (const raw of [undefined, null, 'x', 3, [], { todoist: null }, { todoist: { ids: 'a' } }]) {
      expect(sanitizeSourceBackNotes(raw)).toEqual({})
    }
    expect(sanitizeSourceBackNotes({ todoist: { ids: ['a', 1, '', 'a'], closed: 'yes' } })).toEqual({ todoist: { ids: ['a'], closed: false } })
  })
})
