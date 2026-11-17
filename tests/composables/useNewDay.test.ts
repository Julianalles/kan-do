/**
 * #387 (replaces the automatic pass of #356): a new day starts fresh only on the user's click. The day check on the
 * app's start or return moves no card and writes to no connection; the fresh start takes Jetzt, Offen and Wartet off
 * the board once per local day; the question about time a timer counted after midnight comes with the day check and
 * removes nothing by itself.
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
import { isNewDayDue, resetNewDay, useNewDay } from '~/composables/useNewDay'
import { resetNewDayRecap, useNewDayRecap } from '~/composables/useNewDayRecap'
import { syncToday } from '~/composables/useToday'
import { useDayClose } from '~/composables/useDayClose'
import { useTaskSync } from '~/composables/useTaskSync'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
import { armedTaskTimerIds, disarmAllTaskTimers } from '~/lib/taskTimers'
import { clearAllLiveSeconds } from '~/lib/liveTime'
import { returnedAfterAbsence, resetPresence } from '~/lib/appPresence'
import { dataState } from '~/lib/dataStorage'
import { emptyDataStatus } from '~/lib/dataStatus'
import { isNotPlanned } from '~/lib/taskPlanning'
import { demoTaskId } from '~/lib/demoIds'
import { createCarryOverEntry } from '~/utils/carryOver'
/* eslint-enable import/first */

// Thursday 22 Oct 2026, 09:00 local: the morning of the new day
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

/** The window loses the focus (or the tab is hidden): from here on the user is away, after the grace */
const leaveWindow = () => { window.dispatchEvent(new Event('blur')) }

const notPlannedIds = () => useTasksStore().tasksNotPlanned.map(t => t.id)

/** The morning as the app runs it: the day check, then the user's click. */
const startFresh = (newDay: ReturnType<typeof useNewDay>) => {
  newDay.check()
  return newDay.freshStart()
}

describe('useNewDay: the day check and the fresh start (#387)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(MORNING)
    localStorage.clear()
    setActivePinia(createPinia())
    resetNewDay()
    resetNewDayRecap()
    Object.values(notion).forEach(fn => fn.mockReset())
    notion.updateTask.mockImplementation(async t => t)
    Object.assign(dataState, emptyDataStatus(), { available: false })
    useDayClose().close()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    resetPresence()
    resetNewDay()
    disarmAllTaskTimers()
    clearAllLiveSeconds()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('the app does nothing by itself', () => {
    it('the day check moves no card, stops no timer and leaves every marker of a task alone', () => {
      const { tasks, recap, newDay } = setup()
      const driver = useTaskTimerDriver()
      driver.start()
      const before = JSON.parse(JSON.stringify(tasks.tasks.map(({ timerId: _t, ...rest }) => rest)))
      expect(newDay.check()).toBe(true)
      expect(JSON.parse(JSON.stringify(tasks.tasks.map(({ timerId: _t, ...rest }) => rest)))).toEqual(before)
      expect(tasks.tasksProgress.map(t => t.id)).toEqual(['j'])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1', 'o2'])
      expect(tasks.tasksWaiting.map(t => t.id)).toEqual(['w'])
      expect(notPlannedIds()).toEqual([])
      expect(armedTaskTimerIds()).toEqual(['j'])
      // the day is still not started fresh: the marker and the group are yesterday's
      expect(recap.lastNewDay).toBe(YESTERDAY)
      expect(recap.sentBack).toBeNull()
      expect(isNewDayDue()).toBe(true)
      // a second return the same day changes nothing either, and the timer goes on counting
      newDay.check()
      vi.advanceTimersByTime(10_000)
      expect(tasks.task('j')!.timeSpentSeconds).toBe(610)
      driver.stop()
    })

    it('the day check writes nothing to a connection, also with a Notion "not planned" status mapped', async () => {
      const mapping = notionConfig.config.statusMapping as { archive: string | null; notPlanned?: string[] }
      mapping.notPlanned = ['Backlog']
      try {
        const { tasks, board, newDay } = setup({ tasks: [
          task('nj', TaskStatus.Progress, { source: 'notion' }), task('no', TaskStatus.Open, { source: 'notion' }), task('nw', TaskStatus.Waiting, { source: 'notion' }),
        ] })
        board.setSources({ connected: ['notion'], default: 'notion' })
        useIntegrationHealthStore().recordSuccessfulSync('notion')
        newDay.check()
        await vi.runAllTimersAsync()
        expect(notion.updateTask).not.toHaveBeenCalled()
        expect(tasks.tasks.every(t => t.pendingSync === undefined && t.sourceNotPlanned === undefined)).toBe(true)
      } finally {
        delete mapping.notPlanned
      }
    })

    it('the day begins in this window only with the check: before it neither the recap nor the notice may show', () => {
      const { newDay } = setup()
      expect(newDay.isDayBegun()).toBe(false)
      expect(newDay.noticeShown.value).toBe(false)
      newDay.check()
      expect(newDay.isDayBegun()).toBe(true)
      // the window stays open across midnight: the next day has not begun until the next check
      vi.setSystemTime(at(23, 0, 5))
      syncToday()
      expect(newDay.isDayBegun()).toBe(false)
      expect(newDay.noticeShown.value).toBe(false)
    })
  })

  describe('the fresh start (the user\'s click)', () => {
    it('takes Jetzt, Offen and Wartet off the board: Jetzt first, then Offen in board order, then Wartet; Erledigt stays', () => {
      const { tasks, board, recap, newDay } = setup()
      expect(startFresh(newDay)).toEqual(['j', 'o1', 'o2', 'w'])
      expect(notPlannedIds()).toEqual(['j', 'o1', 'o2', 'w'])
      expect(tasks.tasksOpen).toEqual([])
      expect(tasks.tasksProgress).toEqual([])
      expect(tasks.tasksWaiting).toEqual([])
      expect(tasks.task('d')!.status).toBe(TaskStatus.Done)
      expect(recap.lastNewDay).toBe(TODAY)
      // the group is what came from Jetzt and Offen; what came from Wartet is its own category
      expect(recap.sentBack).toEqual({ day: TODAY, ids: ['j', 'o1', 'o2'] })
      expect(newDay.groupIds.value).toEqual(['j', 'o1', 'o2'])
      expect(board.notPlannedFromWaiting).toEqual(['w'])
      expect(newDay.waitingIds.value).toEqual(['w'])
      expect(isNewDayDue()).toBe(false)
    })

    it('follows Offen\'s own order, not the stored order of the tasks', () => {
      const { board, newDay } = setup()
      board.columns.find(c => c.taskStatus === TaskStatus.Open)!.taskOrder = ['o2', 'o1']
      expect(startFresh(newDay)).toEqual(['j', 'o2', 'o1', 'w'])
    })

    it('never deletes a task and changes nothing but the plan: title, notes, topic, time box, time spent, source', () => {
      const { tasks, newDay } = setup()
      const before = { ...tasks.task('o1')! }
      startFresh(newDay)
      expect(tasks.tasks).toHaveLength(5)
      expect(tasks.task('o1')).toEqual({ ...before, notPlanned: true })
      // the Jetzt task: Open, not planned, no timer; the Wartet task: Open, not planned; their time is untouched
      expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null, timeSpentSeconds: 600 })
      expect(tasks.task('w')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, title: 'Task w' })
      // a Local task has no connection: nothing waits to be pushed
      expect(tasks.tasks.every(t => t.pendingSync === undefined)).toBe(true)
    })

    it('the carried-over count is kept: a day counted this morning is taken back, an earlier count stays', () => {
      const { tasks, newDay } = setup()
      tasks.setCarryOver({
        o1: { ...createCarryOverEntry('2026-10-19'), days: 3, lastOn: TODAY },
        w: { ...createCarryOverEntry('2026-10-19'), days: 2, lastOn: YESTERDAY },
      })
      startFresh(newDay)
      expect(tasks.carryOverByTaskId.o1).toMatchObject({ firstOn: '2026-10-19', days: 2, lastOn: YESTERDAY })
      expect(tasks.carryOverByTaskId.w).toMatchObject({ firstOn: '2026-10-19', days: 2, lastOn: YESTERDAY })
    })

    it('keeps tasks that were already not planned below the group, in their order', () => {
      const { tasks, board, newDay } = setup({ tasks: [
        task('o1', TaskStatus.Open), task('old1', TaskStatus.Open, { notPlanned: true }), task('old2', TaskStatus.Open, { notPlanned: true }),
      ] })
      board.noteNotPlanned('old2')
      startFresh(newDay)
      expect(notPlannedIds()).toEqual(['o1', 'old2', 'old1'])
      expect(newDay.groupIds.value).toEqual(['o1'])
      expect(newDay.waitingIds.value).toEqual([])
      expect(isNotPlanned(tasks.task('old1')!)).toBe(true)
    })

    it('once per day: a second click, a later click that day and a reload move nothing again', () => {
      const { tasks, recap, newDay } = setup()
      startFresh(newDay)
      tasks.planTask('o1')
      expect(newDay.freshStart()).toEqual([])
      vi.setSystemTime(at(22, 23, 59))
      expect(newDay.freshStart()).toEqual([])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1'])
      expect(newDay.groupIds.value).toEqual(['j', 'o2'])
      // a reload: fresh module state, the same persisted marker
      resetNewDay()
      newDay.check()
      expect(newDay.freshStart()).toEqual([])
      expect(recap.sentBack).toEqual({ day: TODAY, ids: ['j', 'o1', 'o2'] })
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1'])
    })

    it('a group task planned and put back the same day returns to the group', () => {
      const { tasks, newDay } = setup()
      startFresh(newDay)
      tasks.planTask('o1')
      expect(newDay.groupIds.value).toEqual(['j', 'o2'])
      tasks.unplanTask('o1')
      expect(newDay.groupIds.value).toEqual(['j', 'o1', 'o2'])
    })

    it('the next day\'s fresh start replaces the group; several days without planning: it takes everything unfinished at once', () => {
      const { tasks, recap, newDay } = setup()
      startFresh(newDay)
      tasks.planTask('o1')
      // two days pass without a fresh start: nothing moves by the check alone
      for (const day of [23, 24]) {
        vi.setSystemTime(at(day, 8))
        resetNewDay()
        newDay.check()
        expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1'])
      }
      tasks.updateTask('o2', { status: TaskStatus.Waiting, notPlanned: undefined })
      expect(newDay.freshStart()).toEqual(['o1', 'o2'])
      expect(recap.sentBack).toEqual({ day: '2026-10-24', ids: ['o1'] })
      // the earlier leftovers are plain "not planned" tasks now, below today's group and what came from Wartet
      expect(notPlannedIds()).toEqual(['o1', 'o2', 'j', 'w'])
      expect(newDay.groupIds.value).toEqual(['o1'])
      expect(newDay.waitingIds.value).toEqual(['w', 'o2'])
    })

    it('a clock set back never repeats the fresh start', () => {
      const { tasks, newDay } = setup()
      startFresh(newDay)
      tasks.planTask('o1')
      vi.setSystemTime(at(20, 9))
      expect(startFresh(newDay)).toEqual([])
      vi.setSystemTime(at(22, 10))
      expect(startFresh(newDay)).toEqual([])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['o1'])
    })

    it('does nothing while the data status blocks writes; the next check after it clears offers it again', () => {
      const { tasks, recap, newDay } = setup()
      Object.assign(dataState, emptyDataStatus(), { available: true, status: 'conflict' })
      expect(newDay.check()).toBe(false)
      expect(newDay.isDayBegun()).toBe(false)
      expect(newDay.freshStart()).toEqual([])
      newDay.closeNotice()
      expect(tasks.tasksOpen).toHaveLength(2)
      expect(recap.lastNewDay).toBe(YESTERDAY)
      expect(recap.noticeClosedDay).toBeNull()
      Object.assign(dataState, emptyDataStatus(), { available: true, status: 'ok' })
      expect(newDay.check()).toBe(true)
      expect(newDay.noticeShown.value).toBe(true)
      expect(newDay.freshStart()).toEqual(['j', 'o1', 'o2', 'w'])
    })

    it('runs from a window event: nothing in it needs a component setup (the toast behind the move path is resolved before)', () => {
      const { newDay } = setup()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // as on the return to the app: no component instance is current
      window.addEventListener('focus', () => startFresh(newDay), { once: true })
      window.dispatchEvent(new Event('focus'))
      expect(notPlannedIds()).toEqual(['j', 'o1', 'o2', 'w'])
      expect(warn.mock.calls.filter(call => String(call[0]).includes('inject()'))).toEqual([])
    })

    it('does nothing on a board that is not onboarded', () => {
      const { recap, newDay } = setup({ onboarded: false })
      expect(newDay.check()).toBe(false)
      expect(newDay.freshStart()).toEqual([])
      expect(recap.lastNewDay).toBe(YESTERDAY)
      expect(isNewDayDue()).toBe(false)
      expect(newDay.noticeShown.value).toBe(false)
    })

    it('waits while the day-close dialog is open: neither the check nor the fresh start acts under it', () => {
      const { tasks, newDay } = setup()
      useDayClose().open()
      expect(newDay.check()).toBe(false)
      expect(newDay.freshStart()).toEqual([])
      expect(tasks.tasksOpen).toHaveLength(2)
      useDayClose().close()
      expect(startFresh(newDay)).toHaveLength(4)
    })

    it('leaves demo tasks on the board', () => {
      const demoOpen = demoTaskId('load', 'open')
      const demoNow = demoTaskId('load', 'now')
      const demoWaiting = demoTaskId('load', 'waiting')
      const { tasks, recap, newDay } = setup({ tasks: [
        task(demoNow, TaskStatus.Progress), task(demoOpen, TaskStatus.Open), task(demoWaiting, TaskStatus.Waiting), task('real', TaskStatus.Open),
      ] })
      expect(startFresh(newDay)).toEqual(['real'])
      expect(tasks.tasksProgress.map(t => t.id)).toEqual([demoNow])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual([demoOpen])
      expect(tasks.tasksWaiting.map(t => t.id)).toEqual([demoWaiting])
      expect(recap.lastNewDay).toBe(TODAY)
    })

    it('a Jetzt task whose move is refused stays in Jetzt and keeps counting', () => {
      const { tasks, newDay } = setup()
      const driver = useTaskTimerDriver()
      driver.start()
      newDay.check()
      // the task is gone from the move path's view (a refused move): the status does not change
      const original = tasks.updateTask
      vi.spyOn(tasks, 'updateTask').mockImplementation((id, updates) => {
        if (id === 'j' && updates.status === TaskStatus.Open) return undefined as never
        return original(id, updates)
      })
      expect(newDay.freshStart()).toEqual(['o1', 'o2', 'w'])
      expect(tasks.task('j')!.status).toBe(TaskStatus.Progress)
      expect(armedTaskTimerIds()).toEqual(['j'])
      driver.stop()
    })
  })

  describe('the category of the tasks that came from Wartet', () => {
    it('lasts beyond its day until each task is planned again; a pick lands in Offen and leaves the category', () => {
      const { tasks, newDay } = setup({ tasks: [task('o1', TaskStatus.Open), task('w1', TaskStatus.Waiting), task('w2', TaskStatus.Waiting)] })
      startFresh(newDay)
      expect(newDay.waitingIds.value).toEqual(['w1', 'w2'])
      // the next days, without another fresh start: the group of the day is gone, the category stays
      vi.setSystemTime(at(24, 9))
      syncToday()
      expect(newDay.groupIds.value).toEqual([])
      expect(newDay.waitingIds.value).toEqual(['w1', 'w2'])
      tasks.planTask('w1')
      expect(tasks.task('w1')).toMatchObject({ status: TaskStatus.Open })
      expect(isNotPlanned(tasks.task('w1')!)).toBe(false)
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['w1'])
      expect(newDay.waitingIds.value).toEqual(['w2'])
      // put back by hand later, it comes from Offen: it does not return to the category
      tasks.unplanTask('w1')
      expect(newDay.waitingIds.value).toEqual(['w2'])
    })

    it('a task whose status changed without a reconcile (the sheet\'s status picker) is not listed, and a deleted one is gone', () => {
      const { tasks, newDay } = setup({ tasks: [task('w1', TaskStatus.Waiting), task('w2', TaskStatus.Waiting)] })
      startFresh(newDay)
      tasks.updateTask('w1', { status: TaskStatus.Progress })
      expect(newDay.waitingIds.value).toEqual(['w2'])
      tasks.setTasks([task('w1', TaskStatus.Progress)])
      expect(newDay.waitingIds.value).toEqual([])
    })
  })

  describe('the notice that offers the fresh start', () => {
    it('shows after the day check on a day that was not started fresh, while something unfinished is on the board', () => {
      const { newDay } = setup()
      expect(newDay.noticeShown.value).toBe(false)
      newDay.check()
      expect(newDay.noticeShown.value).toBe(true)
      newDay.freshStart()
      expect(newDay.noticeShown.value).toBe(false)
    })

    it('"Schließen" hides it for that day, also after a reload, and it is back the next morning', () => {
      const { tasks, recap, newDay } = setup()
      newDay.check()
      newDay.closeNotice()
      expect(newDay.noticeShown.value).toBe(false)
      expect(recap.noticeClosedDay).toBe(TODAY)
      // nothing moved, and the day is still not started fresh
      expect(tasks.tasksOpen).toHaveLength(2)
      expect(isNewDayDue()).toBe(true)
      resetNewDay()
      newDay.check()
      expect(newDay.noticeShown.value).toBe(false)
      vi.setSystemTime(at(23, 8))
      syncToday()
      resetNewDay()
      newDay.check()
      expect(newDay.noticeShown.value).toBe(true)
    })

    it('a day whose board has nothing unfinished counts as started: no notice, also for what is planned later that day', () => {
      const { tasks, recap, newDay } = setup({ tasks: [task('d', TaskStatus.Done, { completedAt: at(21, 15) }), task('held', TaskStatus.Open, { notPlanned: true })] })
      newDay.check()
      expect(recap.lastNewDay).toBe(TODAY)
      expect(recap.sentBack).toEqual({ day: TODAY, ids: [] })
      expect(newDay.noticeShown.value).toBe(false)
      tasks.planTask('held')
      expect(newDay.noticeShown.value).toBe(false)
      expect(newDay.freshStart()).toEqual([])
      expect(tasks.tasksOpen.map(t => t.id)).toEqual(['held'])
      // the next morning that card is yesterday's plan
      vi.setSystemTime(at(23, 8))
      syncToday()
      resetNewDay()
      newDay.check()
      expect(newDay.noticeShown.value).toBe(true)
    })

    it('leaves by itself when the last unfinished card is done; demo tasks never raise it', () => {
      const { tasks, newDay } = setup({ tasks: [task('o1', TaskStatus.Open), task(demoTaskId('load', 'open'), TaskStatus.Open)] })
      newDay.check()
      expect(newDay.noticeShown.value).toBe(true)
      tasks.updateTask('o1', { status: TaskStatus.Done })
      expect(newDay.noticeShown.value).toBe(false)
    })
  })

  describe('the first run (no marker yet)', () => {
    it('a board whose recap marker is an earlier day (data from before #356): nothing moves by itself, the notice offers the fresh start', () => {
      const { tasks, newDay } = setup({ lastNewDay: null, lastShownDay: YESTERDAY })
      expect(isNewDayDue()).toBe(true)
      newDay.check()
      expect(tasks.tasksOpen).toHaveLength(2)
      expect(newDay.noticeShown.value).toBe(true)
      expect(newDay.freshStart()).toEqual(['j', 'o1', 'o2', 'w'])
    })

    describe('data from before #356 on a morning with a recap (the update from v0.16.0): leaving the recap moves its marker to today', () => {
      /** The page's order: the day check, then the recap opens on yesterday's done task */
      function recapMorning() {
        const context = setup({ lastNewDay: null, lastShownDay: YESTERDAY })
        const page = useNewDayRecap()
        context.newDay.check()
        page.check('tasks')
        expect(page.isOpen.value).toBe(true)
        return { ...context, page }
      }

      it('"Tag neu planen": the recap is left first, the fresh start still takes yesterday\'s cards off the board', () => {
        const { tasks, recap, newDay, page } = recapMorning()
        page.leave()
        expect(recap.lastShownDay).toBe(TODAY)
        expect(newDay.freshStart()).toEqual(['j', 'o1', 'o2', 'w'])
        expect(notPlannedIds()).toEqual(['j', 'o1', 'o2', 'w'])
        expect(tasks.tasksOpen).toHaveLength(0)
        expect(recap.lastNewDay).toBe(TODAY)
        expect(newDay.groupIds.value).toEqual(['j', 'o1', 'o2'])
        // once per day holds here too
        expect(newDay.freshStart()).toEqual([])
      })

      it('"Direkt zum Board": the notice offers the fresh start, also after a reload, and its button does it', () => {
        const { tasks, newDay, page } = recapMorning()
        page.leave()
        expect(tasks.tasksOpen).toHaveLength(2)
        expect(newDay.noticeShown.value).toBe(true)
        // a reload: the app starts again with what the morning stored
        resetNewDay()
        resetNewDayRecap()
        newDay.check()
        expect(newDay.noticeShown.value).toBe(true)
        expect(newDay.freshStart()).toEqual(['j', 'o1', 'o2', 'w'])
        expect(newDay.noticeShown.value).toBe(false)
      })

      it('the day check stores the day the board was last seen as the baseline: nothing moves, the day stays one to start fresh, and no group is made up', () => {
        const { tasks, recap, newDay } = setup({ lastNewDay: null, lastShownDay: '2026-10-19' })
        const before = JSON.stringify(tasks.tasks)
        newDay.check()
        expect(JSON.stringify(tasks.tasks)).toBe(before)
        expect(recap.lastNewDay).toBe('2026-10-19')
        expect(isNewDayDue()).toBe(true)
        expect(newDay.groupIds.value).toEqual([])
        // a second check that day keeps it
        newDay.check()
        expect(recap.lastNewDay).toBe('2026-10-19')
      })

      it('while the data status blocks writes the day check stores nothing; the next check after it clears does', () => {
        const { recap, newDay } = setup({ lastNewDay: null, lastShownDay: YESTERDAY })
        Object.assign(dataState, { available: true, status: 'conflict' })
        expect(newDay.check()).toBe(false)
        expect(recap.lastNewDay).toBeNull()
        Object.assign(dataState, { status: 'ok' })
        expect(newDay.check()).toBe(true)
        expect(recap.lastNewDay).toBe(YESTERDAY)
      })
    })

    it('no recap marker (a new board): today is the baseline, nothing is offered, the first day to start fresh is tomorrow', () => {
      const { tasks, recap, newDay } = setup({ lastNewDay: null, lastShownDay: null })
      expect(isNewDayDue()).toBe(false)
      newDay.check()
      expect(newDay.freshStart()).toEqual([])
      expect(tasks.tasksOpen).toHaveLength(2)
      expect(recap.lastNewDay).toBe(TODAY)
      expect(newDay.noticeShown.value).toBe(false)
      vi.setSystemTime(at(23, 8))
      syncToday()
      resetNewDay()
      newDay.check()
      expect(newDay.noticeShown.value).toBe(true)
      expect(newDay.freshStart()).toEqual(['j', 'o1', 'o2', 'w'])
    })

    it('the update arrived during the day (recap marker is today): baseline, the cards stay today', () => {
      const { tasks, newDay } = setup({ lastNewDay: null, lastShownDay: TODAY })
      expect(startFresh(newDay)).toEqual([])
      expect(tasks.tasksOpen).toHaveLength(2)
      expect(newDay.noticeShown.value).toBe(false)
    })

    it('a board the automatic pass of #356 emptied this morning, before the update: it stays as it is, its group still shows today', () => {
      const { tasks, recap, newDay } = setup({ lastNewDay: TODAY, lastShownDay: TODAY, tasks: [
        task('j', TaskStatus.Open, { notPlanned: true }), task('o1', TaskStatus.Open, { notPlanned: true }), task('w', TaskStatus.Waiting),
      ] })
      recap.sentBack = { day: TODAY, ids: ['j', 'o1'] }
      Object.assign(recap, { firstBackDay: TODAY, backNoteClosed: false })
      expect(startFresh(newDay)).toEqual([])
      expect(notPlannedIds()).toEqual(['j', 'o1'])
      expect(tasks.tasksWaiting.map(t => t.id)).toEqual(['w'])
      expect(newDay.groupIds.value).toEqual(['j', 'o1'])
      expect(newDay.noticeShown.value).toBe(false)
    })

    it('a malformed marker reads as "no start yet"', () => {
      const { recap, newDay } = setup({ lastShownDay: null })
      recap.lastNewDay = 'yesterday' as never
      expect(startFresh(newDay)).toEqual([])
      expect(recap.lastNewDay).toBe(TODAY)
    })
  })

  describe('a connected task', () => {
    const connect = (tasks: Task[]) => {
      const context = setup({ tasks })
      context.board.setSources({ connected: ['notion'], default: 'notion' })
      useIntegrationHealthStore().recordSuccessfulSync('notion')
      return context
    }
    const lastSent = (id: string) => notion.updateTask.mock.calls.filter(([sent]) => sent.id === id).at(-1)?.[0]

    it('Notion without a "not planned" status: a task from Jetzt or Wartet gets its open status (as "Fertig" writes it), one from Offen gets no write', async () => {
      const { tasks, newDay } = connect([
        task('nj', TaskStatus.Progress, { source: 'notion' }), task('no', TaskStatus.Open, { source: 'notion', updatedAt: at(21, 10) }),
        task('nw', TaskStatus.Waiting, { source: 'notion' }),
      ])
      startFresh(newDay)
      expect(tasks.task('no')!.pendingSync).toBeUndefined()
      expect(tasks.task('no')!.updatedAt).toEqual(at(21, 10))
      await vi.runAllTimersAsync()
      expect(notion.updateTask.mock.calls.map(([sent]) => sent.id).sort()).toEqual(['nj', 'nw'])
      expect(lastSent('nj')).toMatchObject({ status: TaskStatus.Open })
      expect(lastSent('nw')).toMatchObject({ status: TaskStatus.Open })
      // the echo of those writes keeps the marker, and nothing is noted as held "not planned" by Notion
      expect(notPlannedIds()).toEqual(['nj', 'no', 'nw'])
      expect(tasks.tasks.every(t => t.pendingSync === undefined && t.sourceNotPlanned === undefined)).toBe(true)
    })

    it('Notion with a "not planned" status mapped: every card taken off the board ends in that status there, at once', async () => {
      const mapping = notionConfig.config.statusMapping as { archive: string | null; notPlanned?: string[] }
      mapping.notPlanned = ['Backlog']
      try {
        const { tasks, newDay } = connect([
          task('nj', TaskStatus.Progress, { source: 'notion' }), task('no', TaskStatus.Open, { source: 'notion' }),
          task('nw', TaskStatus.Waiting, { source: 'notion' }),
        ])
        startFresh(newDay)
        // marked at once: a fetch that lands before the writes keeps the local state
        for (const id of ['nj', 'no', 'nw']) {
          expect(tasks.task(id)).toMatchObject({ status: TaskStatus.Open, notPlanned: true, sourceNotPlanned: 'Backlog' })
          expect(tasks.task(id)!.pendingSync).toBeDefined()
        }
        tasks.mergeTasks('notion', [
          task('nj', TaskStatus.Progress, { source: 'notion' }), task('no', TaskStatus.Open, { source: 'notion' }), task('nw', TaskStatus.Waiting, { source: 'notion' }),
        ])
        expect(notPlannedIds()).toEqual(['nj', 'no', 'nw'])
        await vi.runAllTimersAsync()
        // the last write of every task holds its final state: open, not planned, as "Backlog"
        for (const id of ['nj', 'no', 'nw']) {
          expect(lastSent(id)).toMatchObject({ status: TaskStatus.Open, notPlanned: true, sourceNotPlanned: 'Backlog' })
          expect(tasks.task(id)!.pendingSync).toBeUndefined()
        }
        // a pick is the user's move too: Notion gets the "today" status back
        notion.updateTask.mockClear()
        useTaskSync().planTask('no')
        await vi.runAllTimersAsync()
        expect(lastSent('no')).toMatchObject({ status: TaskStatus.Open })
        expect(lastSent('no')!.notPlanned).toBeUndefined()
        expect(lastSent('no')!.sourceNotPlanned).toBeUndefined()
      } finally {
        delete mapping.notPlanned
      }
    })

    it('a Local board: no connection is called at all', async () => {
      const { newDay } = setup()
      startFresh(newDay)
      await vi.runAllTimersAsync()
      expect(notion.updateTask).not.toHaveBeenCalled()
      expect(notion.createTask).not.toHaveBeenCalled()
    })

    it('a fetch after the fresh start keeps the marker, also for a task its connection still reports as open', () => {
      const { tasks, newDay } = connect([task('no', TaskStatus.Open, { source: 'notion' })])
      startFresh(newDay)
      tasks.mergeTasks('notion', [task('no', TaskStatus.Open, { source: 'notion', title: 'Renamed there' })])
      expect(tasks.task('no')).toMatchObject({ title: 'Renamed there', notPlanned: true })
      expect(newDay.groupIds.value).toEqual(['no'])
    })
  })

  describe('the Jetzt task\'s time (#356 D2 point 2c, the user\'s decision of 2026-11-16): nothing removes any; the time its timer counted after midnight while the user was away goes only when the user takes it off', () => {
    let driver: ReturnType<typeof useTaskTimerDriver>
    const stored = (id: string) => useTasksStore().task(id)!.timeSpentSeconds

    /**
     * A board at `start` with `j` in Jetzt (600 s) and its timer running. The user leaves the window at once
     * (blur), so what the timer counts after the grace (`AWAY_GRACE_MS`, D3 o) is counted while away; `present: true`
     * keeps the user in the window.
     */
    function running(start: Date, options: SetupOptions & { present?: boolean } = {}) {
      vi.setSystemTime(start)
      const context = setup(options)
      driver = useTaskTimerDriver()
      driver.start()
      if (options.present !== true) leaveWindow()
      return context
    }
    afterEach(() => driver?.stop())

    it('app left open over midnight while the user is away: the pass removes no time; "Zeit abziehen" takes the time after midnight off, the time until midnight stays', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      // 10 min before midnight, 20 min after it, the user away from 23:50; the return to the app runs the pass
      vi.advanceTimersByTime(30 * 60 * 1000)
      expect(tasks.validAfterMidnight).toMatchObject({ taskId: 'j', day: TODAY })
      startFresh(newDay)
      // nothing silent: the whole stretch is still on the card, and a question asks what to do with the 20 minutes
      expect(stored('j')).toBe(600 + 30 * 60)
      expect(newDay.timeOffer.value).toEqual({ taskId: 'j', title: 'Task j', seconds: 20 * 60 })
      expect(newDay.takeOffTime()).toBe(20 * 60)
      expect(stored('j')).toBe(600 + 10 * 60)
      expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null })
      expect(armedTaskTimerIds()).toEqual([])
      expect(tasks.afterMidnight).toBeNull()
      // the stopped timer adds nothing later
      vi.advanceTimersByTime(60 * 1000)
      expect(stored('j')).toBe(600 + 10 * 60)
    })

    it('the second that crosses midnight counts as before it; a stretch under a minute is not asked about and stays', () => {
      const { newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime((10 * 60 + 5) * 1000)
      startFresh(newDay)
      // the ticks up to and with the one at 00:00:00 belong to yesterday; the five after them are below the minute
      expect(newDay.timeOffer.value).toBeNull()
      expect(newDay.takeOffTime()).toBe(0)
      expect(stored('j')).toBe(600 + 10 * 60 + 5)
    })

    it('other tasks keep their time, also an Offen task with time spent', () => {
      const { newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(30 * 60 * 1000)
      startFresh(newDay)
      expect(stored('o1')).toBe(120)
    })

    it('a timer paused before midnight: nothing is removed', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(5 * 60 * 1000)
      // the user moves the task out of Jetzt at 23:55; the app stays open over night
      tasks.updateTask('j', { status: TaskStatus.Waiting })
      vi.advanceTimersByTime(9 * 60 * 60 * 1000)
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 5 * 60)
      expect(newDay.timeOffer.value).toBeNull()
      // from Wartet it goes off the board with the rest (#387), its time untouched
      expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true })
    })

    it('several midnights passed: only the time after the last one, the one that starts the day of the pass', () => {
      const { newDay } = running(at(20, 23, 50), { lastNewDay: '2026-10-20' })
      // open from the 20th, 23:50 until the 22nd, 00:20: 10 min + a whole day + 20 min
      vi.advanceTimersByTime((10 + 24 * 60 + 20) * 60 * 1000)
      startFresh(newDay)
      // the offer covers only the 20 minutes after the last midnight
      expect(newDay.timeOffer.value?.seconds).toBe(20 * 60)
      newDay.takeOffTime()
      expect(stored('j')).toBe(600 + (10 + 24 * 60) * 60)
    })

    it('app closed over night: no time was counted while closed, nothing is removed', () => {
      const { newDay } = running(at(21, 22, 0))
      vi.advanceTimersByTime(10 * 60 * 1000)
      driver.stop() // the app is closed at 22:10
      vi.setSystemTime(MORNING)
      driver.start() // opened at 09:00: the timer is armed again, then the board mounts and runs the pass
      vi.advanceTimersByTime(2000)
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 10 * 60 + 2)
    })

    it('app closed after midnight (the user was away) and opened again that day: the time counted after midnight is still known and taken off', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(40 * 60 * 1000) // until 00:30
      driver.stop()
      expect(tasks.validAfterMidnight).toMatchObject({ taskId: 'j', day: TODAY, seconds: 30 * 60 })
      vi.setSystemTime(MORNING)
      driver.start()
      startFresh(newDay)
      newDay.takeOffTime()
      expect(stored('j')).toBe(600 + 10 * 60)
    })

    it('a task that entered Jetzt after midnight was started by hand: nothing is removed', () => {
      const { tasks, newDay } = running(at(21, 23, 50), { tasks: [task('j', TaskStatus.Open, { timeSpentSeconds: 600 }), task('o1', TaskStatus.Open)] })
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10, the window kept the focus
      tasks.updateTask('j', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(30 * 60 * 1000)
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 30 * 60)
    })

    it('a task taken out of Jetzt and put back after midnight keeps everything, also what ran before the break', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10
      tasks.updateTask('j', { status: TaskStatus.Waiting })
      tasks.updateTask('j', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(10 * 60 * 1000)
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 30 * 60)
    })

    it('another task is in Jetzt at the pass: the note of the one that crossed midnight is not used for it', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10
      tasks.updateTask('j', { status: TaskStatus.Open })
      tasks.updateTask('o1', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(10 * 60 * 1000)
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 20 * 60)
      expect(stored('o1')).toBe(120 + 10 * 60)
      expect(tasks.afterMidnight).toBeNull()
    })

    it('a time the user set after midnight is the truth: nothing counted before the edit is taken off, never below zero', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(30 * 60 * 1000)
      tasks.setTimeSpent('j', 5)
      startFresh(newDay)
      expect(stored('j')).toBe(5)
    })

    it('a clock set back over midnight: no pass, nothing removed; the real morning removes only what its own day counted', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10 on the 22nd: 10 min counted after midnight
      vi.setSystemTime(at(21, 20, 0)) // the clock goes back to the evening before
      expect(startFresh(newDay)).toEqual([])
      expect(tasks.tasksProgress.map(t => t.id)).toEqual(['j'])
      vi.advanceTimersByTime(10 * 1000)
      expect(stored('j')).toBe(600 + 20 * 60 + 10)
    })

    it('a time zone or clock jump ahead into the next day: only ticks that carry the new day are taken off', () => {
      const { newDay } = running(at(21, 15, 0))
      vi.advanceTimersByTime(60 * 1000)
      vi.setSystemTime(at(22, 3, 0)) // the clock jumps ahead; nothing was counted "after midnight" yet
      vi.advanceTimersByTime(3000)
      startFresh(newDay)
      // the first tick after the jump is the crossing second; only the two after it were counted after the jump,
      // and that is under a minute: nothing is asked, nothing goes
      expect(newDay.timeOffer.value).toBeNull()
      expect(stored('j')).toBe(600 + 60 + 3)
    })

    it('a count noted for an earlier day is not used by a later pass', () => {
      const { tasks, newDay } = running(at(22, 8, 0))
      tasks.afterMidnight = { taskId: 'j', day: YESTERDAY, seconds: 500, spans: [] }
      vi.advanceTimersByTime(60 * 1000)
      vi.setSystemTime(at(22, 9, 0))
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 60)
    })

    it('the user works through midnight and never leaves: nothing is removed, however late the pass runs (D3 o)', () => {
      const { tasks, newDay } = running(at(21, 23, 50), { present: true })
      vi.advanceTimersByTime(30 * 60 * 1000) // 00:20, always in the window
      expect(tasks.validAfterMidnight).toMatchObject({ taskId: 'j', day: TODAY, seconds: 0 })
      // the pass has not run (no return, a route change never starts it); the next start or return runs it
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 30 * 60)
      // the cards went back all the same, and the carried-over count and the recap wait for exactly this pass
      expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null })
      expect(notPlannedIds()).toEqual(['j', 'o1', 'o2', 'w'])
    })

    it('away from 23:50 to 08:00: only the seconds counted after midnight go, none before it', () => {
      const { newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime((10 + 8 * 60) * 60 * 1000) // 08:00 the next morning
      startFresh(newDay)
      newDay.takeOffTime()
      expect(stored('j')).toBe(600 + 10 * 60)
    })

    it('the user leaves after midnight: what the timer counted in the window and in the grace stays, only the away seconds go', () => {
      const { newDay } = running(at(21, 23, 50), { present: true })
      vi.advanceTimersByTime(30 * 60 * 1000) // 00:20 in the window
      leaveWindow()
      vi.advanceTimersByTime(7 * 60 * 60 * 1000 + 40 * 60 * 1000) // away until 08:00
      startFresh(newDay)
      newDay.takeOffTime()
      // 600 s before midnight, 1200 s after it in the window, and the 59 seconds of the grace in which the user still counts as present
      expect(stored('j')).toBe(600 + 600 + 1200 + 59)
    })

    it('a glance at another window (below the grace) is not leaving: nothing is removed', () => {
      const { newDay } = running(at(21, 23, 50), { present: true })
      vi.advanceTimersByTime(15 * 60 * 1000) // 00:05
      leaveWindow()
      vi.advanceTimersByTime(30 * 1000) // back within half a minute
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(5 * 60 * 1000)
      startFresh(newDay)
      expect(stored('j')).toBe(600 + 20 * 60 + 30)
    })

    it('away 23:50 to 00:10, then working on until 01:00: the return at 00:10 starts the new day, so the card goes back with the 10 away minutes off, and the timer does not run on', () => {
      const { tasks, newDay } = running(at(21, 23, 50))
      vi.advanceTimersByTime(20 * 60 * 1000) // 00:10: back after 20 minutes away
      // the page's handler: the return follows a real absence, so it runs the pass
      expect(returnedAfterAbsence()).toBe(true)
      startFresh(newDay)
      expect(newDay.timeOffer.value?.seconds).toBe(10 * 60)
      newDay.takeOffTime()
      expect(stored('j')).toBe(600 + 10 * 60)
      expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null })
      expect(armedTaskTimerIds()).toEqual([])
      // working on until 01:00 adds nothing to the card: it has to be planned again and started
      vi.advanceTimersByTime(50 * 60 * 1000)
      expect(stored('j')).toBe(600 + 10 * 60)
      expect(startFresh(newDay)).toEqual([])
    })

    describe('a day that is not started fresh (#387): the question comes with the day check, the timer keeps tracking', () => {
      const sessions = () => useTaskStatisticsStore().workSessions.map(({ start, end }) => [start, end])
      const ms = (day: number, hour: number, minute = 0, second = 0) => at(day, hour, minute, second).getTime()
      /** Away from 23:50 to 08:00, then back in the window: the page's handler runs the day check, nothing else */
      const backInTheMorning = () => {
        const context = running(at(21, 23, 50))
        vi.advanceTimersByTime((10 + 8 * 60) * 60 * 1000)
        window.dispatchEvent(new Event('focus'))
        context.newDay.check()
        return context
      }

      it('asks about the time after midnight without a fresh start: the task stays in Jetzt and its timer runs on', () => {
        const { tasks, newDay } = backInTheMorning()
        expect(newDay.timeOffer.value).toEqual({ taskId: 'j', title: 'Task j', seconds: 8 * 60 * 60 })
        expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Progress })
        expect(armedTaskTimerIds()).toEqual(['j'])
        expect(stored('j')).toBe(600 + (10 + 8 * 60) * 60)
        expect(notPlannedIds()).toEqual([])
        // the user works on: the timer counts, and nothing is noted for a later question
        vi.advanceTimersByTime(10 * 60 * 1000)
        expect(stored('j')).toBe(600 + (10 + 8 * 60 + 10) * 60)
        expect(tasks.afterMidnight).toBeNull()
        expect(newDay.timeOffer.value?.seconds).toBe(8 * 60 * 60)
      })

      it('"Zeit abziehen" while the timer runs: exactly the offered stretch goes, the seconds collected since stay, and the timer runs on', () => {
        const { newDay } = backInTheMorning()
        vi.advanceTimersByTime(4000) // four collected seconds, below the 10 s checkpoint
        expect(newDay.takeOffTime()).toBe(8 * 60 * 60)
        expect(stored('j')).toBe(600 + 10 * 60 + 4)
        expect(armedTaskTimerIds()).toEqual(['j'])
        vi.advanceTimersByTime(10_000)
        expect(stored('j')).toBe(600 + 10 * 60 + 4 + 10)
        expect(newDay.takeOffTime()).toBe(0)
      })

      it('the Statistik session of a timer that runs on: the night is cut out and the next heartbeats do not stretch a session back over it', () => {
        const { newDay } = backInTheMorning()
        newDay.takeOffTime()
        // the night is gone from the sessions; what follows the return is a session of its own
        expect(sessions()[0]).toEqual([ms(21, 23, 50), ms(22, 0)])
        vi.advanceTimersByTime(5 * 60 * 1000) // five heartbeats
        const after = sessions()
        expect(after[0]).toEqual([ms(21, 23, 50), ms(22, 0)])
        expect(after).toHaveLength(2)
        expect(after[1]![0]).toBeGreaterThanOrEqual(ms(22, 8, 0))
        expect(after[1]![1]).toBe(ms(22, 8, 5))
      })

      it('"Zeit behalten" on a skipped day changes nothing and the timer runs on', () => {
        const { newDay } = backInTheMorning()
        newDay.keepTime()
        expect(newDay.timeOffer.value).toBeNull()
        expect(stored('j')).toBe(600 + (10 + 8 * 60) * 60)
        expect(armedTaskTimerIds()).toEqual(['j'])
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 8, 0)]])
      })

      it('only the time until the day check is asked about: a later absence that day is the user\'s own running timer, as on any day', () => {
        const { tasks, newDay } = backInTheMorning()
        newDay.keepTime()
        leaveWindow()
        vi.advanceTimersByTime(60 * 60 * 1000) // an hour away at midday, the timer running
        window.dispatchEvent(new Event('focus'))
        newDay.check()
        expect(newDay.timeOffer.value).toBeNull()
        expect(tasks.afterMidnight).toBeNull()
      })

      it('the machine slept over midnight and the return runs the day check before the timer\'s first tick: a later absence that day is still not asked about', () => {
        const { tasks, newDay } = running(at(21, 23, 50))
        vi.advanceTimersByTime(5 * 60 * 1000) // 23:55, then the machine sleeps: no tick until it wakes
        vi.setSystemTime(at(22, 8, 0))
        // the wake-up's focus event reaches the page before the timer's interval does
        window.dispatchEvent(new Event('focus'))
        newDay.check()
        expect(newDay.timeOffer.value).toBeNull()
        // the first tick after the check is the one that sees the midnight: it may not start a note for the day already checked
        vi.advanceTimersByTime(60 * 1000)
        expect(tasks.afterMidnight).toBeNull()
        leaveWindow()
        vi.advanceTimersByTime(60 * 60 * 1000) // an hour away at midday, the timer running
        window.dispatchEvent(new Event('focus'))
        newDay.check()
        expect(newDay.timeOffer.value).toBeNull()
        expect(tasks.afterMidnight).toBeNull()
        expect(stored('j')).toBe(600 + 5 * 60 + 60 + 60 * 60)
      })

      it('the day after a checked day is asked about again: the next midnight starts its own note', () => {
        const { tasks, newDay } = backInTheMorning()
        newDay.keepTime()
        leaveWindow()
        vi.advanceTimersByTime(17 * 60 * 60 * 1000) // away from 08:00 until 01:00 the next night
        expect(tasks.validAfterMidnight).toMatchObject({ taskId: 'j', day: '2026-10-23', seconds: 60 * 60 })
        window.dispatchEvent(new Event('focus'))
        newDay.check()
        expect(newDay.timeOffer.value).toEqual({ taskId: 'j', title: 'Task j', seconds: 60 * 60 })
      })

      it('the fresh start after the question was raised asks nothing twice and removes nothing', () => {
        const { tasks, newDay } = backInTheMorning()
        expect(newDay.freshStart()).toEqual(['j', 'o1', 'o2', 'w'])
        expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null })
        expect(newDay.timeOffer.value?.seconds).toBe(8 * 60 * 60)
        expect(stored('j')).toBe(600 + (10 + 8 * 60) * 60)
        expect(newDay.takeOffTime()).toBe(8 * 60 * 60)
        expect(stored('j')).toBe(600 + 10 * 60)
      })

      it('a fresh start without a check before it (a caller outside the app\'s flow) still loses no question', () => {
        const { newDay } = running(at(21, 23, 50))
        vi.advanceTimersByTime(30 * 60 * 1000)
        newDay.freshStart()
        expect(newDay.timeOffer.value?.seconds).toBe(20 * 60)
      })
    })

    describe('the Statistik work sessions follow the removal (D3 h): one stretch, cut at the same boundary', () => {
      const sessions = () => useTaskStatisticsStore().workSessions.map(({ start, end }) => [start, end])
      const ms = (day: number, hour: number, minute = 0, second = 0) => at(day, hour, minute, second).getTime()

      it('away from 23:50 to 08:00: the session ends at midnight, and its length is the time the card keeps from that night', () => {
        // a session of the afternoon before is old data and stays as it is
        const yesterdayAfternoon = { start: ms(21, 14), end: ms(21, 15) }
        useTaskStatisticsStore().workSessions = [yesterdayAfternoon]
        const { newDay } = running(at(21, 23, 50))
        vi.advanceTimersByTime((10 + 8 * 60) * 60 * 1000)
        startFresh(newDay)
        // the question is open: the sessions are whole until the user answers
        expect(sessions()).toEqual([[yesterdayAfternoon.start, yesterdayAfternoon.end], [ms(21, 23, 50), ms(22, 8, 0)]])
        newDay.takeOffTime()
        expect(sessions()).toEqual([[yesterdayAfternoon.start, yesterdayAfternoon.end], [ms(21, 23, 50), ms(22, 0)]])
        // the card kept 600 s of the night, the session 600 s: they agree
        expect(stored('j') - 600).toBe(600)
      })

      it('the user leaves after midnight: the session is cut where the removed seconds begin, not at midnight', () => {
        const { newDay } = running(at(21, 23, 50), { present: true })
        vi.advanceTimersByTime(30 * 60 * 1000) // 00:20 in the window
        leaveWindow()
        vi.advanceTimersByTime(7 * 60 * 60 * 1000 + 40 * 60 * 1000)
        startFresh(newDay)
        newDay.takeOffTime()
        // the 59 seconds of the grace count as present: the session keeps them with the card's 600 + 1200 + 59 s
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 0, 20, 59)]])
        expect(stored('j') - 600).toBe((ms(22, 0, 20, 59) - ms(21, 23, 50)) / 1000)
      })

      it('present through midnight: the session is untouched, and so is the card', () => {
        const { newDay } = running(at(21, 23, 50), { present: true })
        vi.advanceTimersByTime(30 * 60 * 1000)
        startFresh(newDay)
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 0, 20)]])
        expect(stored('j')).toBe(600 + 30 * 60)
      })

      it('away 23:50 to 00:10: the ten minutes after midnight leave the session as they leave the card', () => {
        const { newDay } = running(at(21, 23, 50))
        vi.advanceTimersByTime(20 * 60 * 1000)
        startFresh(newDay)
        newDay.takeOffTime()
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 0)]])
        expect(stored('j')).toBe(600 + 10 * 60)
      })

      it('exactly once: a second pass the same day and a stopped timer cut nothing more', () => {
        const { newDay } = running(at(21, 23, 50))
        vi.advanceTimersByTime((10 + 8 * 60) * 60 * 1000)
        startFresh(newDay)
        newDay.takeOffTime()
        const after = sessions()
        const timeAfter = stored('j')
        // a second answer, a second pass and a stopped timer cut and take off nothing more
        expect(newDay.takeOffTime()).toBe(0)
        startFresh(newDay)
        vi.advanceTimersByTime(60 * 60 * 1000)
        expect(sessions()).toEqual(after)
        expect(stored('j')).toBe(timeAfter)
        expect(useTasksStore().takeAfterMidnight('j', TODAY)).toBeNull()
      })

      it('never time before midnight: a span noted from before it is clipped to it', () => {
        useTasksStore().setTasks([task('j', TaskStatus.Progress, { timeSpentSeconds: 600 })])
        useTasksStore().afterMidnight = { taskId: 'j', day: TODAY, seconds: 120, spans: [[ms(21, 23, 58), ms(22, 0, 2)]] }
        expect(useTasksStore().takeAfterMidnight('j', TODAY)?.spans).toEqual([[ms(22, 0), ms(22, 0, 2)]])
      })
    })

    describe('the question after midnight: the user decides (the user\'s decision of 2026-11-16)', () => {
      const away = (start = at(21, 23, 50)) => {
        const context = running(start)
        vi.advanceTimersByTime((10 + 50) * 60 * 1000) // 50 minutes after midnight, the user away
        return context
      }
      const sessions = () => useTaskStatisticsStore().workSessions.map(({ start, end }) => [start, end])
      const ms = (day: number, hour: number, minute = 0, second = 0) => at(day, hour, minute, second).getTime()

      it('no silent removal: after the pass the card and the Statistik sessions are whole, and the question names the stretch and the task', () => {
        const { newDay, tasks, recap } = away()
        startFresh(newDay)
        expect(stored('j')).toBe(600 + 60 * 60)
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 0, 50)]])
        expect(newDay.timeOffer.value).toEqual({ taskId: 'j', title: 'Task j', seconds: 50 * 60 })
        // the pass still sends the task back and stops its timer
        expect(tasks.task('j')).toMatchObject({ status: TaskStatus.Open, notPlanned: true, timerId: null })
        expect(recap.validTimeOffer).toMatchObject({ taskId: 'j', day: TODAY, seconds: 50 * 60 })
      })

      it('"Zeit abziehen": card and Statistik session lose the same stretch, once', () => {
        const { newDay } = away()
        startFresh(newDay)
        expect(newDay.takeOffTime()).toBe(50 * 60)
        expect(stored('j')).toBe(600 + 10 * 60)
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 0)]])
        expect(stored('j') - 600).toBe((sessions()[0]![1]! - sessions()[0]![0]!) / 1000)
        expect(newDay.timeOffer.value).toBeNull()
        expect(newDay.takeOffTime()).toBe(0)
        expect(stored('j')).toBe(600 + 10 * 60)
      })

      it('"Zeit behalten": everything stays as recorded and the question is gone', () => {
        const { newDay } = away()
        startFresh(newDay)
        newDay.keepTime()
        expect(newDay.timeOffer.value).toBeNull()
        expect(newDay.takeOffTime()).toBe(0)
        expect(stored('j')).toBe(600 + 60 * 60)
        expect(sessions()).toEqual([[ms(21, 23, 50), ms(22, 0, 50)]])
      })

      it('unanswered the time stays, and the question survives a reload that day', () => {
        const { newDay, recap } = away()
        startFresh(newDay)
        vi.advanceTimersByTime(3 * 60 * 60 * 1000) // later that day
        expect(stored('j')).toBe(600 + 60 * 60)
        const storedOffer = JSON.parse(JSON.stringify(recap.timeOffer))
        const storedTasks = JSON.parse(JSON.stringify(useTasksStore().tasks))
        // a reload: fresh stores, the same persisted values
        setActivePinia(createPinia())
        const again = setup({ tasks: storedTasks, lastNewDay: TODAY, lastShownDay: TODAY })
        again.recap.timeOffer = storedOffer
        expect(again.newDay.timeOffer.value).toEqual({ taskId: 'j', title: 'Task j', seconds: 50 * 60 })
        expect(again.newDay.takeOffTime()).toBe(50 * 60)
        expect(useTasksStore().task('j')!.timeSpentSeconds).toBe(600 + 10 * 60)
      })

      it('the question ends with its day: the next day it is not shown, the next pass drops it, and nothing was removed', () => {
        const { newDay, recap } = away()
        startFresh(newDay)
        vi.setSystemTime(at(23, 9, 0))
        syncToday() // the shared "today" moves on (the page's timer and every return)
        expect(newDay.timeOffer.value).toBeNull() // before any write: it follows the shared "today"
        startFresh(newDay)
        expect(recap.timeOffer).toBeNull()
        expect(newDay.takeOffTime()).toBe(0)
        expect(stored('j')).toBe(600 + 60 * 60)
      })

      it('reads nothing malformed as a question, and a deleted task has none', () => {
        const { newDay, recap, tasks } = setup()
        recap.timeOffer = { taskId: 'j', day: TODAY, seconds: -5, spans: [] }
        expect(newDay.timeOffer.value).toBeNull()
        recap.timeOffer = { taskId: 'j', day: 'soon', seconds: 500, spans: [] }
        expect(newDay.timeOffer.value).toBeNull()
        recap.timeOffer = 'x' as never
        expect(newDay.timeOffer.value).toBeNull()
        recap.timeOffer = { taskId: 'gone', day: TODAY, seconds: 500, spans: [] }
        expect(newDay.timeOffer.value).toBeNull()
        recap.timeOffer = { taskId: 'j', day: TODAY, seconds: 500, spans: [] }
        expect(newDay.timeOffer.value).toMatchObject({ taskId: 'j', seconds: 500 })
        tasks.setTasks([task('o1', TaskStatus.Open)])
        expect(newDay.timeOffer.value).toBeNull()
      })

      it('never takes more than the card holds: below zero never', () => {
        const { newDay, recap } = setup()
        recap.timeOffer = { taskId: 'j', day: TODAY, seconds: 5000, spans: [] }
        expect(newDay.takeOffTime()).toBe(600)
        expect(stored('j')).toBe(0)
      })

      it('the answer waits while writes are blocked (desktop data status), the question stays', () => {
        const { newDay, recap } = setup()
        recap.timeOffer = { taskId: 'j', day: TODAY, seconds: 500, spans: [] }
        Object.assign(dataState, emptyDataStatus({ status: 'conflict' }), { available: true })
        expect(newDay.takeOffTime()).toBe(0)
        newDay.keepTime()
        expect(newDay.timeOffer.value).not.toBeNull()
        expect(stored('j')).toBe(600)
      })

      it('after the card was planned and started again, the seconds its running timer has not written yet are not lost', () => {
        const { newDay, tasks } = away()
        startFresh(newDay)
        tasks.updateTask('j', { status: TaskStatus.Progress, notPlanned: undefined })
        vi.setSystemTime(at(22, 9, 0))
        vi.advanceTimersByTime(4000) // four collected seconds, below the 10 s checkpoint
        expect(newDay.takeOffTime()).toBe(50 * 60)
        expect(stored('j')).toBe(600 + 60 * 60 + 4 - 50 * 60)
      })

      it('a connected task: the lowered time goes to the connection only when the user takes it off', async () => {
        const { tasks, board, newDay } = running(at(21, 23, 50), { tasks: [task('nj', TaskStatus.Progress, { source: 'notion', timeSpentSeconds: 600 })] })
        board.setSources({ connected: ['notion'], default: 'notion' })
        useIntegrationHealthStore().recordSuccessfulSync('notion')
        vi.advanceTimersByTime(60 * 60 * 1000)
        startFresh(newDay)
        const queued = tasks.pendingTimeUpdates.nj?.timeSpentSeconds
        expect(queued).toBe(stored('nj'))
        newDay.takeOffTime()
        expect(tasks.pendingTimeUpdates.nj).toMatchObject({ timeSpentSeconds: 600 + 10 * 60, absolute: true })
      })
    })

    it('a Notion task: the lowered time is pushed like a user\'s time edit, so a fetch cannot bring the higher one back', async () => {
      const { tasks, board, newDay } = running(at(21, 23, 50), { tasks: [task('nj', TaskStatus.Progress, { source: 'notion', timeSpentSeconds: 600 })] })
      board.setSources({ connected: ['notion'], default: 'notion' })
      useIntegrationHealthStore().recordSuccessfulSync('notion')
      vi.advanceTimersByTime(30 * 60 * 1000)
      startFresh(newDay)
      // the question is open: the time is as recorded until the user answers
      expect(stored('nj')).toBe(2400)
      newDay.takeOffTime()
      expect(stored('nj')).toBe(1200)
      expect(tasks.pendingTimeUpdates.nj).toMatchObject({ timeSpentSeconds: 1200, absolute: true })
      // a fetch that lands before the push still holds the higher total
      tasks.mergeTasks('notion', [task('nj', TaskStatus.Progress, { source: 'notion', timeSpentSeconds: 2400 })])
      expect(stored('nj')).toBe(1200)
    })
  })
})
