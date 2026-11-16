/**
 * #357: a connection may have a planning state of its own (Notion with "not planned" statuses mapped).
 * `Task.sourceNotPlanned` holds what the source said last; `mergeTasks` changes kan-do's marker only when that
 * answer changes, so kan-do's own moves survive a sync. A source without one whose tasks start not planned
 * (Todoist) decides only for a task kan-do sees for the first time: a fetch never moves a card it already holds (#387).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { inStatus, isNotPlanned } from '~/lib/taskPlanning'
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
const todoist = (id: string, overrides: Partial<Task> = {}) => makeTask(id, { source: 'todoist', ...overrides })
/** How the integration manager merges a Todoist fetch (`TodoistSource.startsNotPlanned`, `holdsOnlyOpenDone`) */
const TODOIST = { startsNotPlanned: true, holdsOnlyOpenDone: true }

describe('mergeTasks follows a source only when its planning state changes (#357)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('a task without the field (data stored before #357) merges as before: planned stays planned, held stays held', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a'), makeTask('b', { notPlanned: true })])
    store.mergeTasks('notion', [makeTask('a'), makeTask('b')])
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(isNotPlanned(store.task('b')!)).toBe(true)
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
  })

  it('a new task starts not planned when its source holds it so', () => {
    const store = useTasksStore()
    store.mergeTasks('notion', [makeTask('n', { sourceNotPlanned: 'Backlog' }), makeTask('p'), makeTask('d', { status: TaskStatus.Done, sourceNotPlanned: 'Backlog' })])
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

  it('Notion moved a task into a "not planned" status: it leaves the board, also from Jetzt', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('o'), makeTask('j', { status: TaskStatus.Progress })])
    store.mergeTasks('notion', [makeTask('o', { sourceNotPlanned: 'Backlog' }), makeTask('j', { sourceNotPlanned: 'Backlog' })])
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

  it('another "not planned" status is no move: a task planned in kan-do while Notion goes from Backlog to Someday stays planned', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a', { sourceNotPlanned: 'Backlog' })])
    store.mergeTasks('notion', [makeTask('a', { sourceNotPlanned: 'Someday' })])
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.sourceNotPlanned).toBe('Someday')
  })

  it('a Todoist task seen for the first time starts not planned; planned by the user it stays planned, put back it stays back', () => {
    const store = useTasksStore()
    store.mergeTasks('todoist', [todoist('t'), todoist('done', { status: TaskStatus.Done })], TODOIST)
    expect(isNotPlanned(store.task('t')!)).toBe(true)
    expect(store.task('done')!.notPlanned).toBeUndefined()
    // nothing about planning is stored for the source: the plan is kan-do's alone
    expect(store.task('t')!.sourceNotPlanned).toBeUndefined()
    store.planTasks(['t'])
    store.mergeTasks('todoist', [todoist('t')], TODOIST)
    store.mergeTasks('todoist', [todoist('t')], TODOIST)
    expect(isNotPlanned(store.task('t')!)).toBe(false)
    store.unplanTasks(['t'])
    store.mergeTasks('todoist', [todoist('t')], TODOIST)
    expect(isNotPlanned(store.task('t')!)).toBe(true)
  })

  // Review of PR 384: a status write sends the column's status to the source, so the held value ends with the marker
  it('a status write that ends the marker ends the held value too: single move, batch move, a snapshot put into a column', () => {
    const store = useTasksStore()
    const held = (id: string) => makeTask(id, { notPlanned: true, sourceNotPlanned: 'Backlog' })
    store.setTasks([held('single'), held('batch'), held('stays')])
    store.updateTask('single', { status: TaskStatus.Progress })
    store.batchUpdateTaskStatus(['batch'], TaskStatus.Waiting)
    store.updateTask('stays', { title: 'Neuer Titel' })
    expect(store.task('single')!.sourceNotPlanned).toBeUndefined()
    expect(store.task('batch')!.sourceNotPlanned).toBeUndefined()
    expect(store.task('stays')).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Backlog' })
    expect(inStatus(held('x'), TaskStatus.Progress)).not.toHaveProperty('sourceNotPlanned')
    expect(inStatus(held('x'), TaskStatus.Open)).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Backlog' })
  })

  it('a task with an unpushed change keeps its local planning state and value', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a', { notPlanned: true, sourceNotPlanned: 'Backlog' })])
    store.markPendingSync('a')
    store.mergeTasks('notion', [makeTask('a')])
    expect(isNotPlanned(store.task('a')!)).toBe(true)
    expect(store.task('a')!.sourceNotPlanned).toBe('Backlog')
  })

  // #387 (the user, 2026-11-16): the app never moves cards by itself. The cards an existing Todoist user has on the
  // board at the update stay there; only a task kan-do sees for the first time starts under "Meine Aufgaben"
  it('existing Todoist board, first fetch after the update: every card stays where it is, only the task seen for the first time starts not planned', () => {
    const store = useTasksStore()
    store.setTasks([
      todoist('o1'), todoist('o2'), todoist('held', { notPlanned: true }),
      todoist('j', { status: TaskStatus.Progress }), todoist('w', { status: TaskStatus.Waiting }), todoist('d', { status: TaskStatus.Done }),
    ])
    const fetched = [todoist('o1'), todoist('o2'), todoist('held'), todoist('j'), todoist('w'), todoist('d', { status: TaskStatus.Done }), todoist('new')]
    store.mergeTasks('todoist', fetched, TODOIST)
    expect(store.tasksOpen.map(t => t.id)).toEqual(['o1', 'o2'])
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['held', 'new'])
    expect(store.task('j')!.status).toBe(TaskStatus.Progress)
    expect(store.task('w')!.status).toBe(TaskStatus.Waiting)
    expect(store.task('d')!.status).toBe(TaskStatus.Done)

    // later fetches move nothing either: a Jetzt task moved back to Offen stays on the board, a card put back stays back
    store.updateTask('j', { status: TaskStatus.Open })
    store.unplanTasks(['o2'])
    store.mergeTasks('todoist', fetched, TODOIST)
    expect(store.tasksOpen.map(t => t.id).sort()).toEqual(['j', 'o1'])
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['held', 'new', 'o2'])
  })

  it('a source without the rule (Local, Notion without a mapping) starts every task on the board', () => {
    const store = useTasksStore()
    store.mergeTasks('notion', [makeTask('a')])
    expect(isNotPlanned(store.task('a')!)).toBe(false)
  })

  it('a source that only knows open and done keeps Jetzt and Wartet, and still follows a completion', () => {
    const store = useTasksStore()
    store.setTasks([todoist('j', { status: TaskStatus.Progress }), todoist('w', { status: TaskStatus.Waiting })])
    store.mergeTasks('todoist', [todoist('j'), todoist('w', { status: TaskStatus.Done })], TODOIST)
    expect(store.task('j')!.status).toBe(TaskStatus.Progress)
    expect(store.task('w')!.status).toBe(TaskStatus.Done)
    // without the option (Notion) the source's status wins as before
    store.setTasks([makeTask('n', { status: TaskStatus.Progress })])
    store.mergeTasks('notion', [makeTask('n')])
    expect(store.task('n')!.status).toBe(TaskStatus.Open)
  })

  // Review of PR 384: the capped "not planned" list was merged as a complete one, so a held task past the cap was
  // dropped with its unpushed edit and with what only kan-do holds (time, the carried-over count, order)
  describe('a list the source capped is a part of what it holds', () => {
    const PARTIAL = { partialNotPlanned: ['Backlog', 'Someday'] }
    const seed = () => {
      const store = useTasksStore()
      store.setTasks([
        makeTask('in-list', { notPlanned: true, sourceNotPlanned: 'Backlog' }),
        makeTask('past-cap', { notPlanned: true, sourceNotPlanned: 'Someday', timeSpentSeconds: 900, title: 'Lokal umbenannt' }),
        makeTask('planned-unpushed', { title: 'Gerade eingeplant' }),
        makeTask('other-status', { notPlanned: true, sourceNotPlanned: 'Archiv' }),
        makeTask('gone-from-board'),
      ])
      store.markPendingSync('past-cap')
      // planned by the user a moment ago: the value is cleared, Notion still holds the page past the cap
      store.markPendingSync('planned-unpushed')
      return store
    }
    const fetched = () => [makeTask('in-list', { sourceNotPlanned: 'Backlog' }), makeTask('new', { sourceNotPlanned: 'Backlog' })]

    it('a held task the list lacks stays as it is, with its unpushed change and local time; so does a task with an unpushed change', () => {
      const store = seed()
      store.mergeTasks('notion', fetched(), PARTIAL)
      expect(store.task('past-cap')).toMatchObject({ notPlanned: true, sourceNotPlanned: 'Someday', timeSpentSeconds: 900, title: 'Lokal umbenannt' })
      expect(store.task('past-cap')!.pendingSync).toBeDefined()
      expect(store.task('planned-unpushed')).toMatchObject({ title: 'Gerade eingeplant' })
      expect(store.tasksOpen.map(t => t.id)).toEqual(['planned-unpushed'])
      // what the cap cannot hide is gone as before: a board task, and a task held in a status that is not capped
      expect(store.task('gone-from-board')).toBeNull()
      expect(store.task('other-status')).toBeNull()
      expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['in-list', 'new', 'past-cap'])
    })

    it('a complete list drops what it lacks, as before', () => {
      const store = seed()
      store.mergeTasks('notion', fetched())
      expect(store.tasks.map(t => t.id).sort()).toEqual(['in-list', 'new'])
      const again = seed()
      again.mergeTasks('notion', fetched(), { partialNotPlanned: [] })
      expect(again.tasks.map(t => t.id).sort()).toEqual(['in-list', 'new'])
    })

    it('a kept task is matched again once the list has it, and follows Notion from there', () => {
      const store = seed()
      store.mergeTasks('notion', fetched(), PARTIAL)
      store.clearPendingSync('past-cap')
      store.mergeTasks('notion', [...fetched(), makeTask('past-cap')], PARTIAL)
      expect(store.tasks.filter(t => t.id === 'past-cap')).toHaveLength(1)
      expect(isNotPlanned(store.task('past-cap')!)).toBe(false)
      expect(store.task('past-cap')!.timeSpentSeconds).toBe(900)
    })
  })

  it('a move to another source drops the value and its undo brings it back', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('t', { notPlanned: true, sourceNotPlanned: 'Backlog' })])
    const previous = store.reassignSource('t', 'local')
    expect(store.task('t')!.sourceNotPlanned).toBeUndefined()
    store.restoreMoveOrigin('t', previous!)
    expect(store.task('t')!.sourceNotPlanned).toBe('Backlog')
    // so the next fetch does not read the task as changed at the source
    store.planTasks(['t'])
    store.mergeTasks('notion', [makeTask('t', { sourceNotPlanned: 'Backlog' })])
    expect(isNotPlanned(store.task('t')!)).toBe(false)
  })
})
