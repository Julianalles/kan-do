/**
 * #480: "Tag abschließen" does the fresh start's work on the user's click: done tasks are archived, every unfinished task
 * leaves today's board for "Alle", nothing is deleted, and tomorrow is marked as started with the panel "Zuletzt geplant und nicht erledigt".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { liveTimeSpent } from '~/lib/liveTime'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { useDayClose, useDayCloseData } from '~/composables/useDayClose'
import { useDayCloseAction } from '~/composables/useDayCloseAction'
import { useNewDay, resetNewDay } from '~/composables/useNewDay'
import { TaskStatus } from '~/types/taskStatus'
import { armedTaskTimerIds, disarmAllTaskTimers } from '~/lib/taskTimers'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { isNotPlanned } from '~/lib/taskPlanning'
import { dataState } from '~/lib/dataStorage'
import { emptyDataStatus } from '~/lib/dataStatus'
import { createCarryOverEntry } from '~/utils/carryOver'
import type { Task } from '~/types/task'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn(), openWorkSession: vi.fn(() => 0), extendWorkSession: vi.fn() }),
}))

const calls: string[] = []
const stopTimerMock = vi.fn((id: string) => { calls.push(`stop:${id}`) })
const moveTaskToStatusMock = vi.fn(async (id: string, status: TaskStatus) => {
  calls.push(`move:${id}:${status}`)
  // the real move changes the local status at once and writes upstream afterwards
  useTasksStore().updateTask(id, { status })
  return true
})
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ stopTimer: stopTimerMock, moveTaskToStatus: moveTaskToStatusMock }),
}))

const archiveTasksMock = vi.fn((ids: string[]) => { calls.push(`archive:${ids.join(',')}`); useTasksStore().archiveTasks(ids) })
vi.mock('~/composables/useArchiveDoneTasks', () => ({
  useArchiveDoneTasks: () => ({ archiveTasks: archiveTasksMock }),
}))

const makeTask = (id: string, status: TaskStatus, extra: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: `Task ${id}`, status, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
})

// Thursday 22 Oct 2026, 21:00 local: the evening of the close
const EVENING = new Date(2026, 9, 22, 21, 0)
const TODAY = '2026-10-22'
const TOMORROW = '2026-10-23'
const motion = (reduce: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), media: query }))

function setup() {
  const board = useBoardStore()
  board.setSources({ connected: [], default: 'local' })
  const recap = useDayRecapStore()
  // the app start of this day wrote its baseline
  recap.markNewDay(TODAY, [])
  return { tasks: useTasksStore(), board, recap }
}

function closeDay(now = EVENING): boolean {
  const dayClose = useDayClose()
  dayClose.open()
  return useDayCloseAction().finishDay(now)
}

describe('useDayCloseAction.finishDay (#480)', () => {
  beforeEach(() => {
    localStorage.clear()
    calls.length = 0
    stopTimerMock.mockClear()
    moveTaskToStatusMock.mockClear()
    archiveTasksMock.mockClear()
    setActivePinia(createPinia())
    useDayClose().close()
    resetNewDay()
    motion(true)
    vi.setSystemTime(EVENING)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    disarmAllTaskTimers()
    dataState.status = 'ok'
    dataState.available = false
  })

  it('takes every unfinished task off the board: Jetzt through Offen, Wartet through Offen, Offen as it is; nothing is deleted', () => {
    const { tasks } = setup()
    tasks.setTasks([
      makeTask('p', TaskStatus.Progress, { timeSpentSeconds: 1800, notes: 'n', topic: 'T', timeBoxSeconds: 3600 }),
      makeTask('o1', TaskStatus.Open),
      makeTask('o2', TaskStatus.Open),
      makeTask('w', TaskStatus.Waiting, { timeSpentSeconds: 60 }),
      makeTask('d', TaskStatus.Done, { completedAt: new Date(2026, 9, 22, 10, 0) }),
    ])
    expect(closeDay()).toBe(true)

    expect(moveTaskToStatusMock).toHaveBeenCalledWith('p', TaskStatus.Open)
    for (const id of ['p', 'o1', 'o2', 'w']) expect(isNotPlanned(tasks.task(id)!)).toBe(true)
    expect(tasks.tasks).toHaveLength(5)
    expect(tasks.task('p')).toMatchObject({ timeSpentSeconds: 1800, notes: 'n', topic: 'T', timeBoxSeconds: 3600 })
    expect(tasks.task('w')?.status).toBe(TaskStatus.Open)
    expect(tasks.tasksOpen).toEqual([])
    expect(tasks.tasksProgress).toEqual([])
    expect(tasks.tasksWaiting).toEqual([])
    expect(archiveTasksMock).toHaveBeenCalledWith(['d'])
    expect(useDayClose().isOpen.value).toBe(false)
  })

  it('marks tomorrow as started with the Jetzt and Offen ids (Jetzt first) and keeps the Wartet ones apart in `waiting`', () => {
    const { tasks, recap } = setup()
    tasks.setTasks([makeTask('o1', TaskStatus.Open), makeTask('p', TaskStatus.Progress), makeTask('w', TaskStatus.Waiting)])
    closeDay()
    expect(recap.validLastNewDay).toBe(TOMORROW)
    expect(recap.validSentBack).toEqual({ day: TOMORROW, ids: ['p', 'o1'], waiting: ['w'], from: '2026-10-22' })
  })

  it('next morning: no new-day notice, the fresh start moves nothing, the group and the Wartet tasks of `sentBack.waiting` are there (marker not overwritten)', () => {
    const { tasks, recap } = setup()
    tasks.setTasks([makeTask('o1', TaskStatus.Open), makeTask('p', TaskStatus.Progress), makeTask('w', TaskStatus.Waiting)])
    closeDay()

    // the app is opened the next morning
    vi.setSystemTime(new Date(2026, 9, 23, 8, 30))
    resetNewDay()
    const newDay = useNewDay()
    expect(newDay.check()).toBe(true)
    expect(newDay.noticeShown.value).toBe(false)
    expect(newDay.freshStart()).toEqual([])
    expect(recap.validSentBack).toEqual({ day: TOMORROW, ids: ['p', 'o1'], waiting: ['w'], from: '2026-10-22' })
    expect(newDay.groupIds.value).toEqual(['p', 'o1'])
    expect(newDay.waitingIds.value).toEqual(['w'])
  })

  it('the same evening nothing is offered again; a task planned from "Alle" leaves the group, a second close keeps the earlier ids', () => {
    const { tasks, recap } = setup()
    tasks.setTasks([makeTask('o1', TaskStatus.Open), makeTask('o2', TaskStatus.Open)])
    closeDay()
    const newDay = useNewDay()
    expect(newDay.noticeShown.value).toBe(false)
    expect(newDay.freshStart()).toEqual([])

    // planned again (the user's move), a new task added, closed once more
    tasks.planTasks(['o1'])
    tasks.addTask(makeTask('o3', TaskStatus.Open))
    closeDay()
    expect(recap.validSentBack?.ids).toEqual(['o1', 'o3', 'o2'])
    expect(recap.validSentBack?.day).toBe(TOMORROW)
  })

  it('a clock set back writes no marker, the tasks still leave the board', () => {
    const { tasks, recap } = setup()
    recap.markDayClosed('2026-10-25', ['x'])
    tasks.setTasks([makeTask('o1', TaskStatus.Open)])
    closeDay()
    expect(recap.validLastNewDay).toBe('2026-10-25')
    expect(recap.validSentBack).toEqual({ day: '2026-10-25', ids: ['x'] })
    expect(isNotPlanned(tasks.task('o1')!)).toBe(true)
  })

  it('nothing unfinished: nothing is taken off and the group of tomorrow is empty', () => {
    const { tasks, recap } = setup()
    tasks.setTasks([makeTask('d', TaskStatus.Done, { completedAt: new Date(2026, 9, 22, 10, 0) })])
    expect(closeDay()).toBe(true)
    expect(moveTaskToStatusMock).not.toHaveBeenCalled()
    expect(recap.validSentBack).toEqual({ day: TOMORROW, ids: [] })
  })

  it('the board day already counted today is not taken back; it counts again when planned the next day', () => {
    const { tasks } = setup()
    tasks.setTasks([makeTask('o1', TaskStatus.Open)])
    tasks.setCarryOver({ o1: { ...createCarryOverEntry(TODAY), days: 2, lastOn: TODAY } })
    closeDay()
    expect(tasks.carryOverByTaskId.o1).toMatchObject({ days: 2, lastOn: TODAY })
    tasks.recordCarryOver(TODAY)
    expect(tasks.carryOverByTaskId.o1).toMatchObject({ days: 2 })
    tasks.planTasks(['o1'])
    tasks.recordCarryOver(TOMORROW)
    expect(tasks.carryOverByTaskId.o1).toMatchObject({ days: 3, lastOn: TOMORROW })
  })

  it('does nothing when the stage is not open (a second click) and while the data file blocks writes', () => {
    const { tasks, recap } = setup()
    tasks.setTasks([makeTask('o1', TaskStatus.Open)])
    expect(useDayCloseAction().finishDay(EVENING)).toBe(false)
    expect(isNotPlanned(tasks.task('o1')!)).toBe(false)

    dataState.available = true
    dataState.status = 'conflict'
    expect(closeDay()).toBe(false)
    expect(isNotPlanned(tasks.task('o1')!)).toBe(false)
    expect(recap.validSentBack?.ids).toEqual([])
    dataState.available = false
    dataState.status = emptyDataStatus().status

    expect(closeDay()).toBe(true)
    expect(useDayCloseAction().finishDay(EVENING)).toBe(false)
    expect(moveTaskToStatusMock).not.toHaveBeenCalled()
  })

  it('a move that is refused keeps its Jetzt task counting and out of the group; the rest is taken off', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(EVENING)
    const { tasks, recap } = setup()
    tasks.setTasks([makeTask('p', TaskStatus.Progress), makeTask('o', TaskStatus.Open)])
    const driver = useTaskTimerDriver()
    driver.start()
    vi.advanceTimersByTime(2000)
    moveTaskToStatusMock.mockImplementationOnce(async () => false) // refused: the status stays
    closeDay()
    expect(tasks.task('p')?.status).toBe(TaskStatus.Progress)
    expect(armedTaskTimerIds()).toEqual(['p'])
    vi.advanceTimersByTime(3000)
    expect(liveTimeSpent(tasks.task('p')!)).toBe(5)
    expect(recap.validSentBack?.ids).toEqual(['o'])
    expect(isNotPlanned(tasks.task('o')!)).toBe(true)
    driver.stop()
  })

  it('a move that goes through stops the timer first: the open seconds are written and nothing stays armed (#352)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(EVENING)
    const { tasks } = setup()
    tasks.setTasks([makeTask('p', TaskStatus.Progress)])
    const driver = useTaskTimerDriver()
    driver.start()
    vi.advanceTimersByTime(2000)
    closeDay()
    vi.advanceTimersByTime(3000)
    expect(armedTaskTimerIds()).toEqual([])
    expect(tasks.task('p')?.timeSpentSeconds).toBe(2)
    driver.stop()
  })

  it('a move that rejects still takes the rest off and archives', () => {
    const { tasks } = setup()
    tasks.setTasks([makeTask('p', TaskStatus.Progress), makeTask('d', TaskStatus.Done, { completedAt: new Date(2026, 9, 22, 10, 0) })])
    moveTaskToStatusMock.mockRejectedValueOnce(new Error('move failed'))
    expect(() => closeDay()).not.toThrow()
    expect(archiveTasksMock).toHaveBeenCalledWith(['d'])
  })

  describe('Erledigt is archived (#292)', () => {
    const today = () => new Date(2026, 9, 22, 10, 0)
    const earlier = () => new Date(2026, 9, 21, 10, 0)

    it('archives today\'s done tasks and the earlier unacknowledged ones through the shared archive path, nothing else', () => {
      const { tasks } = setup()
      tasks.setTasks([
        makeTask('d1', TaskStatus.Done, { completedAt: today() }),
        makeTask('d0', TaskStatus.Done, { completedAt: earlier() }),
        makeTask('o', TaskStatus.Open),
      ])
      closeDay()
      expect(archiveTasksMock).toHaveBeenCalledTimes(1)
      expect([...archiveTasksMock.mock.calls[0]![0]].sort()).toEqual(['d0', 'd1'])
      expect(useDayRecapStore().validClosedTaskIds.sort()).toEqual(['d0', 'd1'])
    })

    it('leaves already archived tasks alone and archives nothing when nothing is done', () => {
      const { tasks } = setup()
      tasks.setTasks([makeTask('a', TaskStatus.Done, { completedAt: today() })])
      tasks.archiveTasks(['a'])
      closeDay()
      expect(archiveTasksMock).not.toHaveBeenCalled()
    })

    it('the sheet keeps showing the day it was confirmed on while it leaves', () => {
      const { tasks } = setup()
      tasks.setTasks([makeTask('d1', TaskStatus.Done, { completedAt: today(), timeSpentSeconds: 600 }), makeTask('o', TaskStatus.Open)])
      const data = useDayCloseData()
      closeDay()
      expect(tasks.tasksDoneToday).toEqual([])
      expect(data.done.value.map(t => t.id)).toEqual(['d1'])
      expect(data.inFlight.value.map(t => t.id)).toEqual(['o'])
      useDayClose().open()
      expect(data.done.value).toEqual([])
    })

    it('fades first: the list is flagged, the tasks stay until the fade is over, then they go and the flag clears', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(EVENING)
      motion(false)
      const { tasks, board } = setup()
      tasks.setTasks([makeTask('d1', TaskStatus.Done, { completedAt: today() })])
      closeDay()
      expect(board.doneLeaving).toBe(true)
      expect(archiveTasksMock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(250)
      expect(archiveTasksMock).toHaveBeenCalledWith(['d1'])
      expect(board.doneLeaving).toBe(false)
    })

    it('hands focus to the board after the archive when the control that had it is gone', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(EVENING)
      motion(false)
      document.body.innerHTML = '<div data-task-sheet-return></div><button id="cta">Tag abschließen</button>'
      const cta = document.getElementById('cta')!
      cta.focus()
      const { tasks } = setup()
      tasks.setTasks([makeTask('d1', TaskStatus.Done, { completedAt: today() })])
      closeDay()
      archiveTasksMock.mockImplementationOnce(() => { cta.remove() })
      await vi.advanceTimersByTimeAsync(250)
      expect(document.activeElement).toBe(document.querySelector('[data-task-sheet-return]'))
      document.body.innerHTML = ''
    })

    it('plain close() archives nothing and moves nothing', () => {
      const { tasks } = setup()
      tasks.setTasks([makeTask('d1', TaskStatus.Done, { completedAt: today() }), makeTask('o', TaskStatus.Open)])
      const dayClose = useDayClose()
      dayClose.open()
      dayClose.close()
      expect(archiveTasksMock).not.toHaveBeenCalled()
      expect(isNotPlanned(tasks.task('o')!)).toBe(false)
      expect(useDayRecapStore().validSentBack?.ids).toEqual([])
    })
  })
})
