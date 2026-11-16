/**
 * #356: a new day sends what was planned and not finished back to "Nicht geplant". One pass per local day over
 * Jetzt and Offen; the Jetzt task stops its timer and loses the time counted after the local midnight that starts
 * the new day (the user's decision D2), nothing else about any task changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  createTask: vi.fn<(draft: Partial<Task>) => Promise<Task>>(),
  archiveTask: vi.fn<(externalId: string) => Promise<void>>(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { isNewDayDue, useNewDay } from '~/composables/useNewDay'
import { useDayClose } from '~/composables/useDayClose'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { armedTaskTimerIds, disarmAllTaskTimers } from '~/lib/taskTimers'
import { clearAllLiveSeconds } from '~/lib/liveTime'
import { dataState } from '~/lib/dataStorage'
import { emptyDataStatus } from '~/lib/dataStatus'
import { isNotPlanned } from '~/lib/taskPlanning'
import { demoTaskId } from '~/lib/demoIds'
import { createCarryOverEntry } from '~/utils/carryOver'
/* eslint-enable import/first */

// Thursday 22 Oct 2026, 09:00 local: the morning the pass runs on
const MORNING = new Date(2026, 9, 22, 9, 0)
const TODAY = '2026-10-22'
const YESTERDAY = '2026-10-21'
const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second)

const task = (id: string, status: TaskStatus, extra: Partial<Task> = {}): Task => {
  const source = extra.source ?? 'local'
  return {
    id, source, externalId: source === 'local' ? null : `page-${id}`, title: `Task ${id}`, status, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

interface SetupOptions { tasks?: Task[], lastNewDay?: string | null, lastShownDay?: string | null, onboarded?: boolean }

function setup(options: SetupOptions = {}) {
  const tasks = useTasksStore()
  const board = useBoardStore()
  const recap = useDayRecapStore()
  if (options.onboarded !== false) board.setSources({ connected: [], default: 'local' })
  tasks.setTasks(options.tasks ?? [
    task('j', TaskStatus.Progress, { timeSpentSeconds: 600 }),
    task('o1', TaskStatus.Open, { timeSpentSeconds: 120, notes: 'n', topic: 'T', timeBoxSeconds: 900 }),
    task('o2', TaskStatus.Open),
    task('w', TaskStatus.Waiting),
    task('d', TaskStatus.Done, { completedAt: at(21, 15) }),
  ])
  board.reconcileColumnsWithTasks(tasks.tasks)
  recap.lastNewDay = options.lastNewDay === undefined ? YESTERDAY : options.lastNewDay
  recap.lastShownDay = options.lastShownDay === undefined ? YESTERDAY : options.lastShownDay
  return { tasks, board, recap, newDay: useNewDay() }
}

const notPlannedIds = () => useTasksStore().tasksNotPlanned.map(t => t.id)

describe('useNewDay: the pass (#356)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(MORNING)
    localStorage.clear()
    setActivePinia(createPinia())
    Object.values(notion).forEach(fn => fn.mockReset())
    notion.updateTask.mockImplementation(async t => t)
    Object.assign(dataState, emptyDataStatus(), { available: false })
    useDayClose().close()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    disarmAllTaskTimers()
    clearAllLiveSeconds()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('sends Jetzt and Offen back in board order (Jetzt first); Wartet and Erledigt stay', () => {
    const { tasks, recap, newDay } = setup()
    expect(newDay.run()).toEqual(['j', 'o1', 'o2'])
    expect(notPlannedIds()).toEqual(['j', 'o1', 'o2'])
    expect(tasks.tasksOpen).toEqual([])
    expect(tasks.tasksProgress).toEqual([])
    expect(tasks.tasksWaiting.map(t => t.id)).toEqual(['w'])
    expect(tasks.task('d')!.status).toBe(TaskStatus.Done)
    expect(recap.lastNewDay).toBe(TODAY)
    expect(recap.sentBack).toEqual({ day: TODAY, ids: ['j', 'o1', 'o2'] })
    expect(newDay.groupIds.value).toEqual(['j', 'o1', 'o2'])
  })

  it('follows Offen\'s own order, not the stored order of the tasks', () => {
    const { board, newDay } = setup()
    board.columns.find(c => c.taskStatus === TaskStatus.Open)!.taskOrder = ['o2', 'o1']
    expect(newDay.run()).toEqual(['j', 'o2', 'o1'])
  })

  it('never deletes a task and changes nothing but the plan: title, notes, topic, time box, time spent, source, carried-over entry', () => {
    const { tasks, newDay } = setup()
    const entry = { ...createCarryOverEntry('2026-10-19'), days: 2, lastOn: YESTERDAY }
    tasks.setCarryOver({ o1: entry })
    const before = { ...tasks.task('o1')! }
    newDay.run()
    expect(tasks.tasks).toHaveLength(5)
    expect(tasks.task('o1')).toEqual({ ...before, notPlanned: true })
    expect(tasks.carryOverByTaskId.o1).toEqual(entry)
    // the Jetzt task: Open, not planned, no timer; its time is untouched without a midnight crossing
    expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null, timeSpentSeconds: 600 })
  })

  it('keeps tasks that were already not planned below the group, in their order', () => {
    const { tasks, board, newDay } = setup({ tasks: [
      task('o1', TaskStatus.Open), task('old1', TaskStatus.Open, { notPlanned: true }), task('old2', TaskStatus.Open, { notPlanned: true }),
    ] })
    board.noteNotPlanned('old2')
    newDay.run()
    expect(notPlannedIds()).toEqual(['o1', 'old2', 'old1'])
    expect(newDay.groupIds.value).toEqual(['o1'])
    expect(isNotPlanned(tasks.task('old1')!)).toBe(true)
  })

  it('runs once per day: a card planned again stays in Offen on every later run that day', () => {
    const { tasks, newDay } = setup()
    newDay.run()
    tasks.planTask('o1')
    expect(newDay.run()).toEqual([])
    vi.setSystemTime(at(22, 23, 59))
    expect(newDay.run()).toEqual([])
    expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1'])
    expect(newDay.groupIds.value).toEqual(['j', 'o2'])
  })

  it('a group task planned and put back the same day returns to the group', () => {
    const { tasks, newDay } = setup()
    newDay.run()
    tasks.planTask('o1')
    expect(newDay.groupIds.value).toEqual(['j', 'o2'])
    tasks.unplanTask('o1')
    expect(newDay.groupIds.value).toEqual(['j', 'o1', 'o2'])
  })

  it('the next day\'s pass replaces the group', () => {
    const { tasks, recap, newDay } = setup()
    newDay.run()
    tasks.planTask('o1')
    vi.setSystemTime(at(23, 8))
    expect(newDay.run()).toEqual(['o1'])
    expect(recap.sentBack).toEqual({ day: '2026-10-23', ids: ['o1'] })
    // yesterday's leftovers are plain "not planned" tasks now, below today's group
    expect(notPlannedIds()).toEqual(['o1', 'j', 'o2'])
  })

  it('a clock set back never repeats the pass', () => {
    const { tasks, newDay } = setup()
    newDay.run()
    tasks.planTask('o1')
    vi.setSystemTime(at(20, 9))
    expect(newDay.run()).toEqual([])
    vi.setSystemTime(at(22, 10))
    expect(newDay.run()).toEqual([])
    expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1'])
  })

  it('does nothing while the data status blocks writes and runs on the next return after it clears', () => {
    const { tasks, recap, newDay } = setup()
    Object.assign(dataState, emptyDataStatus(), { available: true, status: 'conflict' })
    expect(newDay.run()).toEqual([])
    expect(tasks.tasksOpen).toHaveLength(2)
    expect(recap.lastNewDay).toBe(YESTERDAY)
    Object.assign(dataState, emptyDataStatus(), { available: true, status: 'ok' })
    expect(newDay.run()).toEqual(['j', 'o1', 'o2'])
  })

  it('runs from a window event: nothing in the pass needs a component setup (the toast behind the move path is resolved before)', () => {
    const { newDay } = setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // as on the return to the app: no component instance is current
    window.addEventListener('focus', () => newDay.run(), { once: true })
    window.dispatchEvent(new Event('focus'))
    expect(notPlannedIds()).toEqual(['j', 'o1', 'o2'])
    expect(warn.mock.calls.filter(call => String(call[0]).includes('inject()'))).toEqual([])
  })

  it('does nothing on a board that is not onboarded', () => {
    const { recap, newDay } = setup({ onboarded: false })
    expect(newDay.run()).toEqual([])
    expect(recap.lastNewDay).toBe(YESTERDAY)
    expect(isNewDayDue()).toBe(false)
  })

  it('waits while the day-close dialog is open (its list must not empty) and runs on the next return', () => {
    const { tasks, newDay } = setup()
    useDayClose().open()
    expect(newDay.run()).toEqual([])
    expect(tasks.tasksOpen).toHaveLength(2)
    useDayClose().close()
    expect(newDay.run()).toHaveLength(3)
  })

  it('leaves demo tasks on the board', () => {
    const demoOpen = demoTaskId('load', 'open')
    const demoNow = demoTaskId('load', 'now')
    const { tasks, recap, newDay } = setup({ tasks: [task(demoNow, TaskStatus.Progress), task(demoOpen, TaskStatus.Open), task('real', TaskStatus.Open)] })
    expect(newDay.run()).toEqual(['real'])
    expect(tasks.tasksProgress.map(t => t.id)).toEqual([demoNow])
    expect(tasks.tasksOpen.map(t => t.id)).toEqual([demoOpen])
    expect(recap.lastNewDay).toBe(TODAY)
  })

  it('an empty board still moves the marker, with an empty group and no note', () => {
    const { recap, newDay } = setup({ tasks: [task('w', TaskStatus.Waiting)] })
    expect(newDay.run()).toEqual([])
    expect(recap.lastNewDay).toBe(TODAY)
    expect(newDay.groupIds.value).toEqual([])
    expect(recap.firstBackDay).toBeNull()
  })

  describe('the first run (no marker yet)', () => {
    it('a board whose recap marker is an earlier day (the first morning after the update): the pass runs and the one-time note shows', () => {
      const { recap, newDay } = setup({ lastNewDay: null, lastShownDay: YESTERDAY })
      expect(isNewDayDue()).toBe(true)
      expect(newDay.run()).toEqual(['j', 'o1', 'o2'])
      expect(recap.firstBackDay).toBe(TODAY)
      expect(newDay.noteShown.value).toBe(true)
    })

    it('no recap marker (a new board): today is the baseline, nothing moves, the first pass is tomorrow\'s', () => {
      const { tasks, recap, newDay } = setup({ lastNewDay: null, lastShownDay: null })
      expect(isNewDayDue()).toBe(false)
      expect(newDay.run()).toEqual([])
      expect(tasks.tasksOpen).toHaveLength(2)
      expect(recap.lastNewDay).toBe(TODAY)
      expect(newDay.noteShown.value).toBe(false)
      vi.setSystemTime(at(23, 8))
      expect(newDay.run()).toEqual(['j', 'o1', 'o2'])
      expect(newDay.noteShown.value).toBe(true)
    })

    it('the update arrived during the day (recap marker is today): baseline, the cards stay today', () => {
      const { tasks, newDay } = setup({ lastNewDay: null, lastShownDay: TODAY })
      expect(newDay.run()).toEqual([])
      expect(tasks.tasksOpen).toHaveLength(2)
    })

    it('a malformed marker reads as "no pass yet"', () => {
      const { recap, newDay } = setup({ lastShownDay: null })
      recap.lastNewDay = 'yesterday' as never
      expect(newDay.run()).toEqual([])
      expect(recap.lastNewDay).toBe(TODAY)
    })
  })

  describe('the one-time note and "Alle wieder einplanen" (D2, point 1a)', () => {
    it('plans the whole group again at the end of Offen, in its order, and the note is gone', () => {
      const { tasks, newDay } = setup({ lastNewDay: null, tasks: [
        task('j', TaskStatus.Progress, { timeSpentSeconds: 60 }), task('o1', TaskStatus.Open), task('o2', TaskStatus.Open),
        task('old', TaskStatus.Open, { notPlanned: true }),
      ] })
      newDay.run()
      expect(newDay.planAllAgain()).toEqual(['j', 'o1', 'o2'])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['j', 'o1', 'o2'])
      // back in Offen, not in Jetzt: no timer starts by itself; a task that was not planned before stays where it was
      expect(tasks.tasksProgress).toEqual([])
      expect(armedTaskTimerIds()).toEqual([])
      expect(notPlannedIds()).toEqual(['old'])
      expect(newDay.noteShown.value).toBe(false)
    })

    it('leaves out what the user already planned or completed, and never touches a task outside the group', () => {
      const { tasks, newDay } = setup({ lastNewDay: null })
      newDay.run()
      tasks.planTask('o2')
      tasks.unplanTask('o2')
      tasks.planTask('o1')
      expect(newDay.planAllAgain()).toEqual(['j', 'o2'])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1', 'j', 'o2'])
    })

    it('closing the note keeps the cards where they are', () => {
      const { newDay } = setup({ lastNewDay: null })
      newDay.run()
      newDay.closeNote()
      expect(newDay.noteShown.value).toBe(false)
      expect(newDay.groupIds.value).toEqual(['j', 'o1', 'o2'])
    })

    it('shows once ever: not on a later day\'s pass, and not after its own day', () => {
      const { tasks, newDay } = setup({ lastNewDay: null })
      newDay.run()
      expect(newDay.noteShown.value).toBe(true)
      tasks.planTask('o1')
      vi.setSystemTime(at(23, 8))
      newDay.run()
      expect(newDay.groupIds.value).toEqual(['o1'])
      expect(newDay.noteShown.value).toBe(false)
    })

    it('a pass that follows earlier passes (marker present) shows no note', () => {
      const { recap, newDay } = setup()
      recap.firstBackDay = '2026-10-20'
      newDay.run()
      expect(newDay.noteShown.value).toBe(false)
    })
  })

  describe('a connected task', () => {
    it('writes nothing to a connection for the Offen tasks; the Jetzt task\'s status goes there as "Fertig" does', async () => {
      const { tasks, board, newDay } = setup({ tasks: [
        task('nj', TaskStatus.Progress, { source: 'notion' }), task('no', TaskStatus.Open, { source: 'notion', updatedAt: at(21, 10) }),
      ] })
      board.setSources({ connected: ['notion'], default: 'notion' })
      useIntegrationHealthStore().recordSuccessfulSync('notion')
      newDay.run()
      expect(tasks.task('no')!.pendingSync).toBeUndefined()
      expect(tasks.task('no')!.updatedAt).toEqual(at(21, 10))
      await vi.runAllTimersAsync()
      expect(notion.updateTask).toHaveBeenCalledTimes(1)
      expect(notion.updateTask.mock.calls[0]![0]).toMatchObject({ id: 'nj', status: TaskStatus.Open })
      // the echo of that write keeps the marker
      expect(notPlannedIds()).toEqual(['nj', 'no'])
      expect(tasks.task('nj')!.pendingSync).toBeUndefined()
    })

    it('a fetch after the pass keeps the marker, also for a task its connection still reports as open', () => {
      const { tasks, board, newDay } = setup({ tasks: [task('no', TaskStatus.Open, { source: 'notion' })] })
      board.setSources({ connected: ['notion'], default: 'notion' })
      newDay.run()
      tasks.mergeTasks('notion', [task('no', TaskStatus.Open, { source: 'notion', title: 'Renamed there' })])
      expect(tasks.task('no')).toMatchObject({ title: 'Renamed there', notPlanned: true })
      expect(newDay.groupIds.value).toEqual(['no'])
    })
  })

  describe('the Jetzt task\'s time (D2, point 2c): only what its timer counted after the midnight that starts the new day goes', () => {
    let driver: ReturnType<typeof useTaskTimerDriver>
    const stored = (id: string) => useTasksStore().task(id)!.timeSpentSeconds

    /** A board at `start` with `j` in Jetzt (600 s) and its timer running. */
    function running(start: Date, options: SetupOptions = {}) {
      vi.setSystemTime(start)
      const context = setup(options)
      driver = useTaskTimerDriver()
      driver.start()
      return context
    }
    afterEach(() => driver?.stop())

    it('app left open over midnight: the time until midnight stays, the time after it is taken off', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      // 10 min before midnight, 20 min after it; the return to the app runs the pass
      vi.advanceTimersByTime(30 * 60 * 1000)
      expect(tasks.validAfterMidnight).toMatchObject({ taskId: 'j', day: TODAY })
      newDay.run()
      expect(stored('j')).toBe(600 + 10 * 60)
      expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null })
      expect(armedTaskTimerIds()).toEqual([])
      expect(tasks.afterMidnight).toBeNull()
      // the stopped timer adds nothing later
      vi.advanceTimersByTime(60 * 1000)
      expect(stored('j')).toBe(600 + 10 * 60)
    })

    it('the second that crosses midnight counts as before it', () => {
      const { newDay } = running(at(21, 23, 59, 58))
      vi.advanceTimersByTime(5000)
      newDay.run()
      // ticks at 23:59:59 and 00:00:00 belong to yesterday, the three after them are taken off
      expect(stored('j')).toBe(602)
    })

    it('other tasks keep their time, also an Offen task with time spent', () => {
      const { newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(30 * 60 * 1000)
      newDay.run()
      expect(stored('o1')).toBe(120)
    })

    it('a timer paused before midnight: nothing is removed', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(5 * 60 * 1000)
      // the user moves the task out of Jetzt at 23:55; the app stays open over night
      tasks.updateTask('j', { status: TaskStatus.Waiting })
      vi.advanceTimersByTime(9 * 60 * 60 * 1000)
      newDay.run()
      expect(stored('j')).toBe(600 + 5 * 60)
      expect(tasks.task('j')!.status).toBe(TaskStatus.Waiting)
    })

    it('several midnights passed: only the time after the last one, the one that starts the day of the pass', () => {
      const { newDay } = running(at(20, 23, 50), { lastNewDay: '2026-10-20' })
      // open from the 20th, 23:50 until the 22nd, 00:20: 10 min + a whole day + 20 min
      vi.advanceTimersByTime((10 + 24 * 60 + 20) * 60 * 1000)
      newDay.run()
      expect(stored('j')).toBe(600 + (10 + 24 * 60) * 60)
    })

    it('app closed over night: no time was counted while closed, nothing is removed', () => {
      const { newDay } = running(at(21, 22, 0))
      vi.advanceTimersByTime(10 * 60 * 1000)
      driver.stop() // the app is closed at 22:10
      vi.setSystemTime(MORNING)
      driver.start() // opened at 09:00: the timer is armed again, then the board mounts and runs the pass
      vi.advanceTimersByTime(2000)
      newDay.run()
      expect(stored('j')).toBe(600 + 10 * 60 + 2)
    })

    it('app closed after midnight and opened again that day: the time counted after midnight is still known and taken off', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(40 * 60 * 1000) // until 00:30
      driver.stop()
      expect(tasks.validAfterMidnight).toMatchObject({ taskId: 'j', day: TODAY, seconds: 30 * 60 })
      vi.setSystemTime(MORNING)
      driver.start()
      newDay.run()
      expect(stored('j')).toBe(600 + 10 * 60)
    })

    it('a task that entered Jetzt after midnight was started by hand: nothing is removed', () => {
      const { tasks, newDay } = running(at(21, 23, 50), { tasks: [task('j', TaskStatus.Open, { timeSpentSeconds: 600 }), task('o1', TaskStatus.Open)] })
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10, the window kept the focus
      tasks.updateTask('j', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(30 * 60 * 1000)
      newDay.run()
      expect(stored('j')).toBe(600 + 30 * 60)
    })

    it('a task taken out of Jetzt and put back after midnight keeps everything, also what ran before the break', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10
      tasks.updateTask('j', { status: TaskStatus.Waiting })
      tasks.updateTask('j', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(10 * 60 * 1000)
      newDay.run()
      expect(stored('j')).toBe(600 + 30 * 60)
    })

    it('another task is in Jetzt at the pass: the note of the one that crossed midnight is not used for it', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10
      tasks.updateTask('j', { status: TaskStatus.Open })
      tasks.updateTask('o1', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(10 * 60 * 1000)
      newDay.run()
      expect(stored('j')).toBe(600 + 20 * 60)
      expect(stored('o1')).toBe(120 + 10 * 60)
      expect(tasks.afterMidnight).toBeNull()
    })

    it('a time the user set after midnight is the truth: nothing counted before the edit is taken off, never below zero', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(30 * 60 * 1000)
      tasks.setTimeSpent('j', 5)
      newDay.run()
      expect(stored('j')).toBe(5)
    })

    it('a clock set back over midnight: no pass, nothing removed; the real morning removes only what its own day counted', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10 on the 22nd: 10 min counted after midnight
      vi.setSystemTime(at(21, 20, 0)) // the clock goes back to the evening before
      expect(newDay.run()).toEqual([])
      expect(tasks.tasksProgress.map(t => t.id)).toEqual(['j'])
      vi.advanceTimersByTime(10 * 1000)
      expect(stored('j')).toBe(600 + 20 * 60 + 10)
    })

    it('a time zone or clock jump ahead into the next day: only ticks that carry the new day are taken off', () => {
      const { newDay } = running(at(21, 15, 0))
      vi.advanceTimersByTime(60 * 1000)
      vi.setSystemTime(at(22, 3, 0)) // the clock jumps ahead; nothing was counted "after midnight" yet
      vi.advanceTimersByTime(3000)
      newDay.run()
      // the first tick after the jump is the crossing second (kept), the next two are taken off
      expect(stored('j')).toBe(600 + 60 + 1)
    })

    it('a count noted for an earlier day is not used by a later pass', () => {
      const { tasks, newDay } = running(at(22, 8, 0))
      tasks.afterMidnight = { taskId: 'j', day: YESTERDAY, seconds: 500 }
      vi.advanceTimersByTime(60 * 1000)
      vi.setSystemTime(at(22, 9, 0))
      newDay.run()
      expect(stored('j')).toBe(600 + 60)
    })

    it('a Notion task: the lowered time is pushed like a user\'s time edit, so a fetch cannot bring the higher one back', async () => {
      const { tasks, board, newDay } = running(at(21, 23, 50), { tasks: [task('nj', TaskStatus.Progress, { source: 'notion', timeSpentSeconds: 600 })] })
      board.setSources({ connected: ['notion'], default: 'notion' })
      useIntegrationHealthStore().recordSuccessfulSync('notion')
      vi.advanceTimersByTime(30 * 60 * 1000)
      newDay.run()
      expect(stored('nj')).toBe(1200)
      expect(tasks.pendingTimeUpdates.nj).toMatchObject({ timeSpentSeconds: 1200, absolute: true })
      // a fetch that lands before the push still holds the higher total
      tasks.mergeTasks('notion', [task('nj', TaskStatus.Progress, { source: 'notion', timeSpentSeconds: 2400 })])
      expect(stored('nj')).toBe(1200)
    })
  })
})
