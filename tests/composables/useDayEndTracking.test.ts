/**
 * #537: the day-end count. The value of a day is the last count seen that day; nothing is written for a board that
 * is not onboarded, while the data status blocks writes, or when only demo tasks (or none) exist.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useDayEndTracking } from '~/composables/useDayEndTracking'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { dataState } from '~/lib/dataStorage'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task = (id: string, status: TaskStatus): Task => ({
  id, source: 'local', externalId: null, title: id, notes: null, status, priority: 1, timeBoxSeconds: null, timeSpentSeconds: 0,
  topic: null, topicColorCode: null, activity: null, timerId: null,
} as Task)

let day = new Date(2026, 10, 3, 18, 0)
const mountTracker = () => mount(defineComponent({ setup() { useDayEndTracking(() => day); return () => null } }))

describe('useDayEndTracking (#537)', () => {
  let tasks: ReturnType<typeof useTasksStore>
  let stats: ReturnType<typeof useTaskStatisticsStore>

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    day = new Date(2026, 10, 3, 18, 0)
    dataState.available = false
    dataState.status = 'ok'
    tasks = useTasksStore()
    stats = useTaskStatisticsStore()
    useBoardStore().setSources({ connected: [], default: 'local' })
    tasks.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Progress), task('c', TaskStatus.Waiting), task('d', TaskStatus.Done)])
  })

  it('counts Offen + Jetzt + Wartet on mount and follows status changes, the last value of the day wins', async () => {
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 3 })
    tasks.updateTask('a', { status: TaskStatus.Done })
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 2 })
    tasks.addTask(task('e', TaskStatus.Open))
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 3 })
  })

  it('writes the next local day under its own key and keeps the old day', async () => {
    mountTracker()
    day = new Date(2026, 10, 4, 9, 0)
    tasks.updateTask('b', { status: TaskStatus.Done })
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 3, '2026-11-04': 2 })
  })

  it('the new day\'s pass (#356) writes under today\'s key only: yesterday\'s figure stays what the evening saw', async () => {
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 3 })
    day = new Date(2026, 10, 4, 9, 0)
    // Offen and Jetzt go back to "Alle Aufgaben": only Wartet is still in flight
    tasks.updateTask('b', { status: TaskStatus.Open })
    tasks.unplanTasks(['a', 'b'])
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 3, '2026-11-04': 1 })
  })

  it('a board whose every task went back records 0 for the day instead of keeping an older count (#353 review)', async () => {
    tasks.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
    mountTracker()
    await nextTick()
    expect(stats.dayEndInFlight['2026-11-03']).toBe(2)
    tasks.unplanTasks(['a', 'b'])
    await nextTick()
    expect(stats.dayEndInFlight['2026-11-03']).toBe(0)
  })

  it('writes when the tab becomes visible again', () => {
    const tracker = mountTracker()
    stats.dayEndInFlight = {}
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 3 })
    tracker.unmount()
    stats.dayEndInFlight = {}
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stats.dayEndInFlight).toEqual({})
  })

  it('writes nothing for a board that was never onboarded', () => {
    useBoardStore().boardConfig.sources = null
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({})
  })

  it('writes nothing while the desktop data status blocks writes (ADR 011)', () => {
    dataState.available = true
    dataState.status = 'conflict'
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({})
  })

  it('writes nothing for an empty board or one with only demo tasks, and never counts demo tasks', () => {
    tasks.setTasks([])
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({})
    tasks.setTasks([task('demo-1', TaskStatus.Open)])
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stats.dayEndInFlight).toEqual({})
    tasks.setTasks([task('demo-1', TaskStatus.Open), task('r', TaskStatus.Open)])
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 1 })
  })

  it('never counts a task that is not planned for today, and follows the two moves (#353)', async () => {
    tasks.setTasks([task('a', TaskStatus.Open), { ...task('n', TaskStatus.Open), notPlanned: true }, task('d', TaskStatus.Done)])
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 1 })
    tasks.planTask('n')
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 2 })
    tasks.unplanTask('a')
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 1 })
  })

  it('records 0 once every held task is not planned, instead of keeping the count from before (#354)', async () => {
    tasks.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 2 })
    tasks.unplanTask('a')
    tasks.unplanTask('b')
    await nextTick()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 0 })
  })

  it('a board with everything done records 0 (a real value, not a missing one)', () => {
    tasks.setTasks([task('d', TaskStatus.Done)])
    mountTracker()
    expect(stats.dayEndInFlight).toEqual({ '2026-11-03': 0 })
  })
})
