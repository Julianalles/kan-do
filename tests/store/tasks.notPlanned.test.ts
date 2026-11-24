/**
 * #353: a task can be held without being on today's board. `Task.notPlanned` is kan-do's own marker (absent =
 * planned, valid while the status is Open or Waiting, #793): the columns, the column order and the carried-over count leave
 * such a task out, the two moves put it on and take it off, and a merge keeps the marker of a task it already holds.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { dropStaleMarkers, inStatus, isNotPlanned, markerSurvives, plannedTasks, sourceHoldSurvives } from '~/lib/taskPlanning'
import type { Task } from '~/types/task'
import type { SourceId } from '~/types/taskSource'
import { TaskStatus } from '~/types/taskStatus'
import { mapHelpers } from '~/utils/mapHelpers'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  const source = overrides.source ?? 'local'
  return {
    id, source, externalId: source === 'local' ? null : id, title: `Task ${id}`, status: TaskStatus.Open, activity: null,
    topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
    ...overrides,
  }
}

describe('isNotPlanned: the single reader of the marker (#353)', () => {
  it('is true only for the marker `true` on an Open or a Waiting task (#793)', () => {
    expect(isNotPlanned(makeTask('a', { notPlanned: true }))).toBe(true)
    expect(isNotPlanned(makeTask('a', { notPlanned: true, status: TaskStatus.Waiting }))).toBe(true)
    expect(isNotPlanned(makeTask('a'))).toBe(false)
    expect(isNotPlanned(makeTask('a', { status: TaskStatus.Waiting }))).toBe(false)
    for (const status of [TaskStatus.Progress, TaskStatus.Done]) {
      expect(isNotPlanned(makeTask('a', { notPlanned: true, status }))).toBe(false)
    }
  })

  it('reads any other stored value as planned', () => {
    for (const value of [false, null, 'true', 1, {}]) {
      expect(isNotPlanned({ status: TaskStatus.Open, notPlanned: value as unknown as true })).toBe(false)
    }
  })

  it('plannedTasks keeps the tasks on the board', () => {
    const tasks = [makeTask('a'), makeTask('b', { notPlanned: true }), makeTask('c', { status: TaskStatus.Done })]
    expect(plannedTasks(tasks).map(t => t.id)).toEqual(['a', 'c'])
  })
})

describe('several tasks at once (#356)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('unplanTasks takes Open tasks off the board in the order given, on top of "Alle Aufgaben", with one reconcile', () => {
    const store = useTasksStore()
    const board = useBoardStore()
    store.setTasks([makeTask('a'), makeTask('b'), makeTask('c'), makeTask('old', { notPlanned: true }), makeTask('w', { status: TaskStatus.Progress })])
    board.reconcileColumnsWithTasks(store.tasks)
    board.noteNotPlanned('old')
    const reconcile = vi.spyOn(board, 'reconcileColumnsWithTasks')
    // unknown ids, a task in Jetzt, one already not planned and a repeat are skipped
    expect(store.unplanTasks(['c', 'a', 'w', 'old', 'nope', 'c'])).toEqual(['c', 'a'])
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['c', 'a', 'old'])
    expect(store.tasksOpen.map(t => t.id)).toEqual(['b'])
    expect(store.task('w')!.notPlanned).toBeUndefined()
    reconcile.mockClear()
    expect(store.unplanTasks([])).toEqual([])
    expect(store.unplanTasks(['w'])).toEqual([])
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('planTasks puts them at the end of Offen in the order given, with one reconcile', () => {
    const store = useTasksStore()
    const board = useBoardStore()
    store.setTasks([makeTask('x', { notPlanned: true }), makeTask('y', { notPlanned: true }), makeTask('z', { notPlanned: true }), makeTask('o')])
    board.reconcileColumnsWithTasks(store.tasks)
    const reconcile = vi.spyOn(board, 'reconcileColumnsWithTasks')
    expect(store.planTasks(['z', 'x', 'o', 'nope', 'z'])).toEqual(['z', 'x'])
    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(store.tasksOpen.map(t => t.id)).toEqual(['o', 'z', 'x'])
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['y'])
  })

  it('the single moves are the list moves of one: same result, same refusals', () => {
    const store = useTasksStore()
    store.setTasks([makeTask('a'), makeTask('p', { status: TaskStatus.Progress })])
    expect(store.unplanTask('p')).toBe(false)
    expect(store.unplanTask('a')).toBe(true)
    expect(store.unplanTask('a')).toBe(false)
    expect(store.planTask('a')).toBe(true)
    expect(store.planTask('a')).toBe(false)
  })

  it('markerSurvives is the one rule of every status write: only between Offen and Wartet the marker stays (#793)', () => {
    const all = [TaskStatus.Open, TaskStatus.Progress, TaskStatus.Waiting, TaskStatus.Done]
    const offable = [TaskStatus.Open, TaskStatus.Waiting]
    for (const before of all) for (const after of all) {
      expect(markerSurvives(before, after)).toBe(offable.includes(before) && offable.includes(after))
      for (const source of ['local', 'notion', 'todoist'] as const) {
        expect(sourceHoldSurvives(source, before, after)).toBe(before === TaskStatus.Open && after === TaskStatus.Open)
      }
      // A source that plans by date holds the date's answer, which no status write moves: it goes with the marker
      expect(sourceHoldSurvives('reminders', before, after)).toBe(markerSurvives(before, after))
    }
    const store = useTasksStore()
    store.setTasks([makeTask('a', { notPlanned: true }), makeTask('b', { notPlanned: true }), makeTask('c', { notPlanned: true, source: 'notion' })])
    store.updateTask('a', { status: TaskStatus.Done })
    store.batchUpdateTaskStatus(['b'], TaskStatus.Progress)
    store.mergeTasks('notion', [makeTask('c', { source: 'notion', status: TaskStatus.Done })])
    expect(store.tasks.some(t => 'notPlanned' in t)).toBe(false)
  })
})

describe('inStatus: a snapshot put into another column (#354)', () => {
  it('keeps the marker between Offen and Wartet only, and what the source holds only Open to Open (#793)', () => {
    expect(inStatus(makeTask('a', { notPlanned: true }), TaskStatus.Open).notPlanned).toBe(true)
    const waiting = inStatus(makeTask('a', { notPlanned: true, sourceNotPlanned: 'Backlog' }), TaskStatus.Waiting)
    expect(waiting.notPlanned).toBe(true)
    expect('sourceNotPlanned' in waiting).toBe(false)
    expect(inStatus(makeTask('a', { notPlanned: true, status: TaskStatus.Waiting }), TaskStatus.Open).notPlanned).toBe(true)
    for (const status of [TaskStatus.Progress, TaskStatus.Done]) {
      expect('notPlanned' in inStatus(makeTask('a', { notPlanned: true }), status)).toBe(false)
      expect('notPlanned' in inStatus(makeTask('a', { notPlanned: true, status }), TaskStatus.Waiting)).toBe(false)
    }
  })

  it('drops a stale marker of a Jetzt snapshot that returns to Offen, so the task is not hidden', () => {
    const back = inStatus(makeTask('a', { notPlanned: true, status: TaskStatus.Progress }), TaskStatus.Open)
    expect(back.status).toBe(TaskStatus.Open)
    expect(isNotPlanned(back)).toBe(false)
  })
})

describe('tasks store: a task that is not planned for today (#353)', () => {
  let store: ReturnType<typeof useTasksStore>
  let board: ReturnType<typeof useBoardStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    store = useTasksStore()
    board = useBoardStore()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  const offenOrder = () => board.columnByTaskStatus(TaskStatus.Open)?.taskOrder ?? []
  const offen = () => store.tasksOpen.map(t => t.id)

  it('is in no column and not in Offen\'s stored order, but still held and found by id', () => {
    store.setTasks([makeTask('a'), makeTask('b', { notPlanned: true }), makeTask('c')])

    expect(offen()).toEqual(['a', 'c'])
    expect(offenOrder()).toEqual(['a', 'c'])
    expect([...store.tasksProgress, ...store.tasksWaiting, ...store.tasksDone]).toEqual([])
    expect(store.tasksNotPlanned.map(t => t.id)).toEqual(['b'])
    expect(store.task('b')?.title).toBe('Task b')
    expect(store.tasks).toHaveLength(3)
  })

  it('a board without a marker reads exactly as before: every task planned, order untouched', () => {
    store.setTasks([makeTask('a'), makeTask('b'), makeTask('c', { status: TaskStatus.Waiting })])
    expect(offen()).toEqual(['a', 'b'])
    expect(store.tasksNotPlanned).toEqual([])
    expect(store.tasks.some(t => 'notPlanned' in t)).toBe(false)
  })

  describe('the two moves', () => {
    const rich = (): Task => makeTask('b', {
      source: 'notion', externalId: 'page-b', timeSpentSeconds: 1234, notes: 'call back', topic: 'Haus', priority: 3,
      timeBoxSeconds: 1800, updatedAt: new Date(2026, 10, 1),
    })

    it('"not today" takes an Offen task off the board and changes nothing else about it', () => {
      store.setTasks([makeTask('a'), rich(), makeTask('c')])
      const before = { ...store.task('b')! }

      expect(store.unplanTask('b')).toBe(true)

      expect(offen()).toEqual(['a', 'c'])
      expect(offenOrder()).toEqual(['a', 'c'])
      expect(store.task('b')).toEqual({ ...before, notPlanned: true })
      expect(store.task('b')?.pendingSync).toBeUndefined()
      expect(store.isSyncPending('b')).toBe(false)
    })

    it('planning puts it at the end of Offen, again with nothing else changed (A -> B -> A)', () => {
      store.setTasks([makeTask('a'), rich(), makeTask('c')])
      const before = { ...store.task('b')! }
      store.unplanTask('b')

      expect(store.planTask('b')).toBe(true)

      expect(offen()).toEqual(['a', 'c', 'b'])
      expect(offenOrder()).toEqual(['a', 'c', 'b'])
      expect(store.task('b')).toEqual(before)
      expect('notPlanned' in store.task('b')!).toBe(false)

      store.unplanTask('a')
      store.planTask('a')
      expect(offen()).toEqual(['c', 'b', 'a'])
    })

    it('"not today" is refused in Jetzt and Erledigt, for an unknown id and for a task that is already off', () => {
      store.setTasks([
        makeTask('p', { status: TaskStatus.Progress }),
        makeTask('d', { status: TaskStatus.Done }), makeTask('o', { notPlanned: true }),
      ])
      for (const id of ['p', 'd', 'o', 'missing']) expect(store.unplanTask(id)).toBe(false)
      expect(store.tasks.filter(t => t.notPlanned).map(t => t.id)).toEqual(['o'])
      expect(store.tasksProgress.map(t => t.id)).toEqual(['p'])
    })

    it('planning a task that is already planned (or unknown) is a no-op', () => {
      store.setTasks([makeTask('a'), makeTask('b')])
      expect(store.planTask('a')).toBe(false)
      expect(store.planTask('missing')).toBe(false)
      expect(offenOrder()).toEqual(['a', 'b'])
    })

    it('a not-planned task does not count for the Jetzt limit and can still be moved into a column by status', () => {
      store.setTasks([makeTask('a', { notPlanned: true })])
      expect(store.tasksProgress).toHaveLength(0)
      store.updateTask('a', { status: TaskStatus.Progress })
      expect(store.tasksProgress.map(t => t.id)).toEqual(['a'])
      expect('notPlanned' in store.task('a')!).toBe(false)
    })
  })

  describe('the marker cannot outlive Open', () => {
    it('a status change away from Open drops it, and the way back does not bring it back', () => {
      store.setTasks([makeTask('a', { notPlanned: true })])
      store.updateTask('a', { status: TaskStatus.Done })
      expect('notPlanned' in store.task('a')!).toBe(false)
      store.updateTask('a', { status: TaskStatus.Open })
      expect(offen()).toEqual(['a'])
    })

    it('an edit that keeps the task Open keeps it (a title change, a write echo with the same status)', () => {
      store.setTasks([makeTask('a', { notPlanned: true })])
      store.updateTask('a', { title: 'renamed' })
      store.updateTask('a', { status: TaskStatus.Open, title: 'echo' })
      expect(store.task('a')?.notPlanned).toBe(true)
      expect(offen()).toEqual([])
    })

    it('a stale marker on a task an older app moved on never hides it when it comes back to Open', () => {
      store.setTasks([makeTask('a', { notPlanned: true, status: TaskStatus.Done })])
      expect(store.tasksDone.map(t => t.id)).toEqual(['a'])
      store.updateTask('a', { status: TaskStatus.Open })
      expect(offen()).toEqual(['a'])
      expect('notPlanned' in store.task('a')!).toBe(false)
    })

    it('the batch status update follows the same rule', () => {
      vi.useFakeTimers()
      store.setTasks([makeTask('a', { notPlanned: true }), makeTask('b', { notPlanned: true, status: TaskStatus.Done })])
      store.batchUpdateTaskStatus(['a'], TaskStatus.Progress)
      store.batchUpdateTaskStatus(['b'], TaskStatus.Open)
      expect(store.tasks.some(t => 'notPlanned' in t)).toBe(false)
      vi.runAllTimers()
      vi.useRealTimers()
    })
  })

  describe.each(['notion', 'todoist'] as const)('mergeTasks keeps kan-do\'s marker (%s)', (source: SourceId) => {
    const held = (overrides: Partial<Task> = {}) => makeTask('x', { source, externalId: 'ext-x', timeSpentSeconds: 600, ...overrides })
    const fetched = (overrides: Partial<Task> = {}) => makeTask('ext-x', { source, externalId: 'ext-x', ...overrides })

    it('a fetched task that matches a held not-planned one stays not planned, sync after sync', () => {
      store.setTasks([makeTask('l'), held({ notPlanned: true })])

      store.mergeTasks(source, [fetched({ title: 'renamed upstream' })])
      store.mergeTasks(source, [fetched({ title: 'renamed upstream' })])

      const merged = store.task('x')!
      expect(merged.notPlanned).toBe(true)
      expect(merged.title).toBe('renamed upstream')
      expect(merged.timeSpentSeconds).toBe(600)
      expect(offen()).toEqual(['l'])
      expect(offenOrder()).toEqual(['l'])
    })

    it('keeps it for a task with unpushed changes too', () => {
      store.setTasks([held({ notPlanned: true, pendingSync: { since: 1, attempts: 0, lastError: null } })])
      store.mergeTasks(source, [fetched()])
      expect(store.task('x')?.notPlanned).toBe(true)
    })

    it('drops it when the source moved the task on: the task is on the board in its new column', () => {
      store.setTasks([held({ notPlanned: true })])
      store.mergeTasks(source, [fetched({ status: TaskStatus.Done })])
      expect('notPlanned' in store.task('x')!).toBe(false)
      expect(store.tasksDone.map(t => t.id)).toEqual(['x'])
    })

    it('a planned held task stays planned and a task new to kan-do arrives planned', () => {
      store.setTasks([held()])
      store.mergeTasks(source, [fetched(), makeTask('ext-new', { source, externalId: 'ext-new' })])
      expect(store.tasksNotPlanned).toEqual([])
      expect(offen().sort()).toEqual(['ext-new', 'x'])
    })

    it('a planned held task does not take a marker from the fetched copy', () => {
      store.setTasks([held()])
      store.mergeTasks(source, [fetched({ notPlanned: true })])
      expect('notPlanned' in store.task('x')!).toBe(false)
    })

    it('a not-planned task its source no longer returns is removed like a planned one', () => {
      store.setTasks([makeTask('l', { notPlanned: true }), held({ notPlanned: true })])
      store.mergeTasks(source, [])
      expect(store.tasks.map(t => t.id)).toEqual(['l'])
      expect(store.task('l')?.notPlanned).toBe(true)
    })

    it('a stale marker on a held done task does not take a re-opened task off the board', () => {
      store.setTasks([held({ notPlanned: true, status: TaskStatus.Done })])
      store.mergeTasks(source, [fetched({ status: TaskStatus.Open })])
      expect(offen()).toEqual(['x'])
    })
  })

  it('mergeTasks(local) keeps a Local task\'s marker (the fetch is the store\'s own tasks)', () => {
    store.setTasks([makeTask('a'), makeTask('b', { notPlanned: true }), makeTask('n', { source: 'notion', notPlanned: true })])
    store.mergeTasks('local', store.tasks.filter(t => t.source === 'local'))
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['b', 'n'])
    expect(offen()).toEqual(['a'])
  })

  it('a completed source switch that adopts a Local not-planned task keeps the marker', () => {
    store.setTasks([makeTask('page-1', { notPlanned: true, timeSpentSeconds: 60 })])
    store.mergeTasks('notion', [makeTask('page-1', { source: 'notion', externalId: 'page-1' })], { replaceOthers: true })
    expect(store.task('page-1')).toMatchObject({ source: 'notion', notPlanned: true, timeSpentSeconds: 60 })
  })

  describe('carried-over count', () => {
    const daysOf = (id: string) => mapHelpers.get(store.carryOverByTaskId, id)?.days

    it('is kept while the task is not planned and continues on the next planned day; days off do not count', () => {
      store.setTasks([makeTask('a'), makeTask('b')])
      store.recordCarryOver('2026-11-02')
      store.recordCarryOver('2026-11-03')
      expect(daysOf('b')).toBe(1)

      store.unplanTask('b')
      store.recordCarryOver('2026-11-04')
      store.recordCarryOver('2026-11-05')
      expect(daysOf('b')).toBe(1)
      expect(mapHelpers.get(store.carryOverByTaskId, 'b')?.lastOn).toBe('2026-11-03')
      expect(daysOf('a')).toBe(3)

      store.planTask('b')
      store.recordCarryOver('2026-11-06')
      expect(daysOf('b')).toBe(2)
      expect(daysOf('a')).toBe(4)
    })

    it('taken off and planned again on the same day counts nothing twice', () => {
      store.setTasks([makeTask('b')])
      store.recordCarryOver('2026-11-02')
      store.recordCarryOver('2026-11-03')
      store.unplanTask('b')
      store.recordCarryOver('2026-11-03')
      store.planTask('b')
      store.recordCarryOver('2026-11-03')
      expect(daysOf('b')).toBe(1)
    })

    it('a task that was never on the board gets its first day when it is planned', () => {
      store.setTasks([makeTask('b', { notPlanned: true })])
      store.recordCarryOver('2026-11-02')
      expect(mapHelpers.has(store.carryOverByTaskId, 'b')).toBe(false)
      store.planTask('b')
      store.recordCarryOver('2026-11-05')
      expect(daysOf('b')).toBe(0)
    })

    it('survives a merge while not planned, and an existing counter is never reset', () => {
      store.setTasks([makeTask('x', { source: 'notion', externalId: 'x' })])
      store.setCarryOver({ x: { firstOn: '2026-10-20', days: 5, lastOn: '2026-11-01', keptAtDays: 4 } })
      store.unplanTask('x')
      store.mergeTasks('notion', [makeTask('x', { source: 'notion', externalId: 'x' })])
      store.recordCarryOver('2026-11-03')
      expect(mapHelpers.get(store.carryOverByTaskId, 'x')).toEqual({ firstOn: '2026-10-20', days: 5, lastOn: '2026-11-01', keptAtDays: 4 })
    })
  })

  describe('the order of "Alle Aufgaben" (#354)', () => {
    const notPlanned = () => store.tasksNotPlanned.map(t => t.id)

    it('a task put back goes to the top, newest first; tasks that never were on the board follow in stored order', () => {
      store.setTasks([makeTask('n1', { notPlanned: true }), makeTask('a'), makeTask('b'), makeTask('n2', { notPlanned: true })])
      expect(notPlanned()).toEqual(['n1', 'n2'])
      store.unplanTask('a')
      store.unplanTask('b')
      expect(notPlanned()).toEqual(['b', 'a', 'n1', 'n2'])
      expect(board.notPlannedOrder).toEqual(['b', 'a'])
    })

    it('planning takes the task out of the order, and putting it back again puts it on top (A -> B -> A)', () => {
      store.setTasks([makeTask('a'), makeTask('b')])
      store.unplanTask('a')
      store.unplanTask('b')
      store.planTask('a')
      expect(board.notPlannedOrder).toEqual(['b'])
      store.unplanTask('a')
      expect(notPlanned()).toEqual(['a', 'b'])
    })

    it('survives a merge that returns the source\'s tasks in another order', () => {
      store.setTasks([makeTask('x', { source: 'notion' }), makeTask('y', { source: 'notion' }), makeTask('z', { source: 'notion' })])
      store.unplanTask('x')
      store.unplanTask('z')
      store.mergeTasks('notion', [makeTask('x', { source: 'notion' }), makeTask('y', { source: 'notion' }), makeTask('z', { source: 'notion' })])
      expect(notPlanned()).toEqual(['z', 'x'])
    })

    it('forgets a task that left "Alle Aufgaben" another way (moved on by status, removed)', () => {
      store.setTasks([makeTask('a'), makeTask('b'), makeTask('c')])
      store.unplanTask('a')
      store.unplanTask('b')
      store.updateTask('a', { status: TaskStatus.Progress })
      store.removeTask('b')
      board.reconcileColumnsWithTasks(store.tasks)
      expect(board.notPlannedOrder).toEqual([])
    })
  })
})

describe('the marker on a waiting task (#793)', () => {
  let store: ReturnType<typeof useTasksStore>
  let board: ReturnType<typeof useBoardStore>
  const ids = (list: readonly Task[]) => list.map(t => t.id)
  const order = (status: TaskStatus) => board.columnByTaskStatus(status)?.taskOrder ?? []

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useTasksStore()
    board = useBoardStore()
  })

  it('a Wartet task can be taken off today and planned again: it keeps Wartet and returns to the end of that column', () => {
    store.setTasks([makeTask('o'), makeTask('w1', { status: TaskStatus.Waiting }), makeTask('w2', { status: TaskStatus.Waiting })])
    board.reconcileColumnsWithTasks(store.tasks)

    expect(store.unplanTask('w1')).toBe(true)
    expect(store.task('w1')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
    expect(ids(store.tasksWaiting)).toEqual(['w2'])
    expect(order(TaskStatus.Waiting)).toEqual(['w2'])
    expect(ids(store.tasksNotPlanned)).toEqual(['w1'])
    expect(board.notPlannedOrder).toEqual(['w1'])

    expect(store.planTask('w1')).toBe(true)
    expect(store.task('w1')?.status).toBe(TaskStatus.Waiting)
    expect('notPlanned' in store.task('w1')!).toBe(false)
    expect(ids(store.tasksWaiting).sort()).toEqual(['w1', 'w2'])
    expect(order(TaskStatus.Waiting)).toEqual(['w2', 'w1'])
    expect(order(TaskStatus.Open)).toEqual(['o'])
    expect(board.notPlannedOrder).toEqual([])
  })

  it('planTasks sorts a mixed list into Offen and Wartet, each in the order given', () => {
    store.setTasks([
      makeTask('o'), makeTask('w', { status: TaskStatus.Waiting }),
      makeTask('a', { notPlanned: true }), makeTask('b', { notPlanned: true, status: TaskStatus.Waiting }),
      makeTask('c', { notPlanned: true }), makeTask('d', { notPlanned: true, status: TaskStatus.Waiting }),
    ])
    board.reconcileColumnsWithTasks(store.tasks)
    expect(store.planTasks(['d', 'c', 'b', 'a'])).toEqual(['d', 'c', 'b', 'a'])
    expect(order(TaskStatus.Open)).toEqual(['o', 'c', 'a'])
    expect(order(TaskStatus.Waiting)).toEqual(['w', 'd', 'b'])
  })

  it('a task off today stays off today between Offen and Wartet, through the single and the batch write', () => {
    vi.useFakeTimers()
    store.setTasks([makeTask('a', { notPlanned: true }), makeTask('b', { notPlanned: true })])
    store.updateTask('a', { status: TaskStatus.Waiting })
    expect(store.task('a')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
    store.updateTask('a', { status: TaskStatus.Open })
    expect(store.task('a')).toMatchObject({ status: TaskStatus.Open, notPlanned: true })
    store.batchUpdateTaskStatus(['b'], TaskStatus.Waiting)
    vi.runAllTimers()
    store.batchUpdateTaskStatus(['b'], TaskStatus.Open)
    vi.runAllTimers()
    expect(store.task('b')).toMatchObject({ status: TaskStatus.Open, notPlanned: true })
    expect(ids(store.tasksOpen)).toEqual([])
    expect(ids(store.tasksWaiting)).toEqual([])
    vi.useRealTimers()
  })

  it('starting a task that is off today plans it, from Offen and from Wartet; it stays planned afterwards', () => {
    for (const from of [TaskStatus.Open, TaskStatus.Waiting]) {
      store.setTasks([makeTask('a', { notPlanned: true, status: from })])
      store.updateTask('a', { status: TaskStatus.Progress })
      expect('notPlanned' in store.task('a')!).toBe(false)
      expect(ids(store.tasksProgress)).toEqual(['a'])
      store.updateTask('a', { status: TaskStatus.Waiting })
      expect(ids(store.tasksWaiting)).toEqual(['a'])
    }
  })

  it('a done task ignores the marker, and Erledigt back to Offen or Wartet plans the task', () => {
    for (const back of [TaskStatus.Open, TaskStatus.Waiting]) {
      store.setTasks([makeTask('a', { notPlanned: true, status: TaskStatus.Waiting })])
      store.updateTask('a', { status: TaskStatus.Done })
      expect(ids(store.tasksDone)).toEqual(['a'])
      expect('notPlanned' in store.task('a')!).toBe(false)
      store.updateTask('a', { status: back })
      expect(isNotPlanned(store.task('a')!)).toBe(false)
      expect(ids(store.tasksNotPlanned)).toEqual([])
    }
  })

  it('what the source holds ends when an Offen task off today goes to Wartet, so the next fetch sees no move', () => {
    store.setTasks([makeTask('n', { source: 'notion', notPlanned: true, sourceNotPlanned: 'Backlog' })])
    store.updateTask('n', { status: TaskStatus.Waiting })
    expect(store.task('n')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
    expect('sourceNotPlanned' in store.task('n')!).toBe(false)
    // The source answers with the waiting status it was written: the marker stays, sync after sync
    store.mergeTasks('notion', [makeTask('n', { source: 'notion', status: TaskStatus.Waiting })])
    store.mergeTasks('notion', [makeTask('n', { source: 'notion', status: TaskStatus.Waiting })])
    expect(store.task('n')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
  })

  describe('a sync changes the marker only when the source\'s own planning changed', () => {
    const held = (overrides: Partial<Task> = {}) => makeTask('x', { source: 'notion', status: TaskStatus.Waiting, ...overrides })
    const fetched = (overrides: Partial<Task> = {}) => makeTask('x', { source: 'notion', status: TaskStatus.Waiting, ...overrides })

    it('keeps a Wartet task off today, and keeps a planned one planned', () => {
      store.setTasks([held({ notPlanned: true })])
      store.mergeTasks('notion', [fetched({ title: 'renamed' })])
      expect(store.task('x')).toMatchObject({ notPlanned: true, title: 'renamed' })
      store.setTasks([held()])
      store.mergeTasks('notion', [fetched()])
      expect('notPlanned' in store.task('x')!).toBe(false)
    })

    it('keeps the marker when the source moves the task between Offen and Wartet, drops it for Jetzt and Erledigt', () => {
      store.setTasks([held({ notPlanned: true })])
      store.mergeTasks('notion', [fetched({ status: TaskStatus.Open })])
      expect(store.task('x')).toMatchObject({ status: TaskStatus.Open, notPlanned: true })
      store.mergeTasks('notion', [fetched({ status: TaskStatus.Waiting })])
      expect(store.task('x')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
      store.mergeTasks('notion', [fetched({ status: TaskStatus.Progress })])
      expect('notPlanned' in store.task('x')!).toBe(false)
      store.setTasks([held({ notPlanned: true })])
      store.mergeTasks('notion', [fetched({ status: TaskStatus.Done })])
      expect('notPlanned' in store.task('x')!).toBe(false)
    })

    it('Notion moved the task out of a "not planned" status into its waiting one: planned and waiting', () => {
      store.setTasks([held({ status: TaskStatus.Open, notPlanned: true, sourceNotPlanned: 'Backlog' })])
      store.mergeTasks('notion', [fetched()])
      expect(store.task('x')?.status).toBe(TaskStatus.Waiting)
      expect('notPlanned' in store.task('x')!).toBe(false)
    })

    it('Notion moved a planned waiting task into a "not planned" status: Offen, off today', () => {
      store.setTasks([held()])
      store.mergeTasks('notion', [fetched({ status: TaskStatus.Open, sourceNotPlanned: 'Backlog' })])
      expect(store.task('x')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, sourceNotPlanned: 'Backlog' })
    })

    it('a source that knows only open and done (Todoist) leaves a Wartet task off today as it is', () => {
      store.setTasks([makeTask('t', { source: 'todoist', status: TaskStatus.Waiting, notPlanned: true })])
      store.mergeTasks('todoist', [makeTask('t', { source: 'todoist', status: TaskStatus.Open })], { holdsOnlyOpenDone: true, startsNotPlanned: true })
      expect(store.task('t')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
    })

    it('a source that plans by date keeps a Wartet task off today while its date is not today, and follows the date to today', () => {
      const options = { holdsOnlyOpenDone: true, planningByDate: true, keepsKanDoFields: true }
      const reminder = (overrides: Partial<Task> = {}) => makeTask('r', { source: 'reminders', status: TaskStatus.Open, ...overrides })
      store.setTasks([reminder({ status: TaskStatus.Waiting, notPlanned: true })])
      store.mergeTasks('reminders', [reminder({ sourceNotPlanned: 'not-today' })], options)
      expect(store.task('r')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true, sourceNotPlanned: 'not-today' })
      store.mergeTasks('reminders', [reminder({ sourceNotPlanned: 'not-today' })], options)
      expect(store.task('r')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
      // The reminder's date changed to today: the source's own planning changed
      store.mergeTasks('reminders', [reminder()], options)
      expect(store.task('r')?.status).toBe(TaskStatus.Waiting)
      expect('notPlanned' in store.task('r')!).toBe(false)
    })

    it('a planned Wartet task of such a source never leaves the board by a fetch', () => {
      const options = { holdsOnlyOpenDone: true, planningByDate: true, keepsKanDoFields: true }
      store.setTasks([makeTask('r', { source: 'reminders', status: TaskStatus.Waiting })])
      store.mergeTasks('reminders', [makeTask('r', { source: 'reminders', sourceNotPlanned: 'not-today' })], options)
      expect(store.task('r')?.status).toBe(TaskStatus.Waiting)
      expect('notPlanned' in store.task('r')!).toBe(false)
    })
  })
})

describe('dropStaleMarkers: the first load of data stored before #793', () => {
  it('drops the field from Jetzt, Wartet and Erledigt tasks only, whatever its value', () => {
    const tasks = [
      { id: 'o', status: TaskStatus.Open, notPlanned: true },
      { id: 'o2', status: TaskStatus.Open, notPlanned: false },
      { id: 'p', status: TaskStatus.Progress, notPlanned: true },
      { id: 'w', status: TaskStatus.Waiting, notPlanned: true, title: 'kept' },
      { id: 'd', status: TaskStatus.Done, notPlanned: 'true' },
      { id: 'plain', status: TaskStatus.Waiting },
    ]
    expect(dropStaleMarkers(tasks)).toEqual([
      { id: 'o', status: TaskStatus.Open, notPlanned: true },
      { id: 'o2', status: TaskStatus.Open, notPlanned: false },
      { id: 'p', status: TaskStatus.Progress },
      { id: 'w', status: TaskStatus.Waiting, title: 'kept' },
      { id: 'd', status: TaskStatus.Done },
      { id: 'plain', status: TaskStatus.Waiting },
    ])
  })

  it('returns the input itself when nothing changed, and passes anything that is no task through', () => {
    const clean = [{ id: 'o', status: TaskStatus.Open, notPlanned: true }, { id: 'w', status: TaskStatus.Waiting }, null, 'x']
    expect(dropStaleMarkers(clean)).toBe(clean)
  })
})
