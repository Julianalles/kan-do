/**
 * #356 (decision D2, point 2c): the tasks store notes what a Jetzt timer counts after the local midnight it ran
 * across, and the new day's pass takes exactly that off the task's time spent again. The note is persisted and
 * additive: older data has none, a malformed one reads as none, and nothing is ever removed for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { sanitizeAfterMidnight, useTasksStore } from '~/store/tasks'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const DAY = '2026-10-22'
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, source: 'local', externalId: null, title: id, status: TaskStatus.Progress, activity: null, topic: null, topicColorCode: null,
  priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 1000, timerId: null, ...extra,
})

function freshPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

describe('time counted after midnight (#356)', () => {
  let store: ReturnType<typeof useTasksStore>
  beforeEach(() => {
    localStorage.clear()
    freshPinia()
    store = useTasksStore()
    store.setTasks([task('a'), task('b', { status: TaskStatus.Open })])
  })

  it('reads anything but a well-formed note as none', () => {
    for (const bad of [null, undefined, 'x', 3, [], {}, { taskId: 'a', day: DAY }, { taskId: 1, day: DAY, seconds: 5 },
      { taskId: 'a', day: '22.10.', seconds: 5 }, { taskId: 'a', day: DAY, seconds: -1 }, { taskId: 'a', day: DAY, seconds: Number.NaN },
      { taskId: 'a', day: DAY, seconds: '5' }, { taskId: 'a', day: DAY, seconds: Number.POSITIVE_INFINITY }]) {
      expect(sanitizeAfterMidnight(bad)).toBeNull()
    }
    expect(sanitizeAfterMidnight({ taskId: 'a', day: DAY, seconds: 0 })).toEqual({ taskId: 'a', day: DAY, seconds: 0 })
  })

  it('counts only from the crossing on, only for that task, and only tracked seconds', () => {
    store.addTrackedSeconds('a', 30)
    expect(store.afterMidnight).toBeNull()
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 10)
    store.addTrackedSeconds('b', 99)
    store.addTrackedSeconds('a', 5)
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 15 })
    // the same crossing reported twice does not reset the count; an unknown task or day is ignored
    store.beginAfterMidnight('a', DAY)
    store.beginAfterMidnight('nope', DAY)
    store.beginAfterMidnight('a', 'tomorrow')
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 15 })
  })

  it('a later midnight replaces the note: only the last one counts', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 600)
    store.beginAfterMidnight('a', '2026-10-23')
    store.addTrackedSeconds('a', 7)
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: '2026-10-23', seconds: 7 })
  })

  it('removes exactly the noted seconds, once', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 400)
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(400)
    expect(store.task('a')!.timeSpentSeconds).toBe(1000)
    expect(store.afterMidnight).toBeNull()
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(0)
    expect(store.task('a')!.timeSpentSeconds).toBe(1000)
  })

  it('removes nothing for another task, another day or without a note, and drops the note', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 400)
    expect(store.removeTimeAfterMidnight('b', DAY)).toBe(0)
    expect(store.afterMidnight).toBeNull()
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 50)
    expect(store.removeTimeAfterMidnight('a', '2026-10-23')).toBe(0)
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(0)
    expect(store.task('a')!.timeSpentSeconds).toBe(1450)
    expect(store.task('b')!.timeSpentSeconds).toBe(1000)
  })

  it('never goes below zero, even when the stored note says more than the task holds', () => {
    store.afterMidnight = { taskId: 'a', day: DAY, seconds: 5000 }
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(1000)
    expect(store.task('a')!.timeSpentSeconds).toBe(0)
  })

  it('a malformed stored note removes nothing', () => {
    store.afterMidnight = { taskId: 'a', day: DAY, seconds: -300 }
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(0)
    store.afterMidnight = { taskId: 'a', day: DAY, seconds: 'all' } as never
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(0)
    expect(store.task('a')!.timeSpentSeconds).toBe(1000)
  })

  it('the user\'s own time edit drops the note of that task only', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 400)
    store.setTimeSpent('b', 5)
    expect(store.afterMidnight).not.toBeNull()
    store.setTimeSpent('a', 900)
    expect(store.afterMidnight).toBeNull()
    expect(store.removeTimeAfterMidnight('a', DAY)).toBe(0)
    expect(store.task('a')!.timeSpentSeconds).toBe(900)
  })

  it('survives a restart; data stored before #356 has none and is not written at hydration', async () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 20)
    await nextTick()
    freshPinia()
    expect(useTasksStore().validAfterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 20 })

    const old = JSON.parse(localStorage.getItem('tasks-store')!)
    delete old.afterMidnight
    localStorage.setItem('tasks-store', JSON.stringify(old))
    const before = localStorage.getItem('tasks-store')
    freshPinia()
    const legacy = useTasksStore()
    await nextTick()
    expect(legacy.validAfterMidnight).toBeNull()
    expect(legacy.task('a')!.timeSpentSeconds).toBe(1020)
    expect(localStorage.getItem('tasks-store')).toBe(before)
  })
})
