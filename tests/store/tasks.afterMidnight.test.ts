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
    expect(sanitizeAfterMidnight({ taskId: 'a', day: DAY, seconds: 0 })).toEqual({ taskId: 'a', day: DAY, seconds: 0, spans: [] })
  })

  it('counts only from the crossing on, only for that task, and only tracked seconds', () => {
    store.addTrackedSeconds('a', 30, 30)
    expect(store.afterMidnight).toBeNull()
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 10, 10)
    store.addTrackedSeconds('b', 99, 99)
    store.addTrackedSeconds('a', 5, 5)
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 15, spans: [] })
    // the same crossing reported twice does not reset the count; an unknown task or day is ignored
    store.beginAfterMidnight('a', DAY)
    store.beginAfterMidnight('nope', DAY)
    store.beginAfterMidnight('a', 'tomorrow')
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 15, spans: [] })
  })

  it('notes only the seconds counted while the user was away (D3 o): a second counted in the window is never noted', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 10) // all present
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 0, spans: [] })
    store.addTrackedSeconds('a', 10, 4)
    store.addTrackedSeconds('a', 10, 10)
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 14, spans: [] })
    // never more away than counted; a malformed count notes nothing
    store.addTrackedSeconds('a', 5, 50)
    store.addTrackedSeconds('a', 5, Number.NaN)
    store.addTrackedSeconds('a', 5, -3)
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 19, spans: [] })
    expect(store.task('a')!.timeSpentSeconds).toBe(1000 + 10 + 10 + 10 + 5 + 5 + 5)
  })

  it('keeps the wall-clock spans of the away seconds: merged where they touch, never before that midnight, malformed ones dropped', () => {
    const t = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute).getTime()
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 10, 10, [[t(-1, 55), t(0, 5)]]) // starts 5 minutes before midnight
    store.addTrackedSeconds('a', 10, 10, [[t(0, 5), t(0, 9)]]) // touches: one span
    store.addTrackedSeconds('a', 10, 10, [[t(2), t(2, 30)], [t(3), t(3)], [Number.NaN, 4] as never])
    store.addTrackedSeconds('a', 10, 0, [[t(5), t(6)]]) // no away seconds: its span is not noted
    expect(store.afterMidnight!.spans).toEqual([[t(0), t(0, 9)], [t(2), t(2, 30)]])
    expect(store.takeAfterMidnight('a', DAY)).toMatchObject({ taskId: 'a', seconds: 30, spans: [[t(0), t(0, 9)], [t(2), t(2, 30)]] })
    expect(store.afterMidnight).toBeNull() // handed out once: the note is dropped
    expect(store.takeAfterMidnight('a', DAY)).toBeNull()
  })

  it('a note stored without spans (or with a malformed list) loads with none; it is the same count', () => {
    expect(sanitizeAfterMidnight({ taskId: 'a', day: DAY, seconds: 7 })).toEqual({ taskId: 'a', day: DAY, seconds: 7, spans: [] })
    expect(sanitizeAfterMidnight({ taskId: 'a', day: DAY, seconds: 7, spans: 'x' })?.spans).toEqual([])
    expect(sanitizeAfterMidnight({ taskId: 'a', day: DAY, seconds: 7, spans: [[1], 'x', [5, 2]] })?.spans).toEqual([])
  })

  it('never keeps more than 50 spans: the nearest two merge', () => {
    const t = (minute: number) => new Date(2026, 9, 22, 0, minute).getTime()
    const spans = Array.from({ length: 60 }, (_, i) => [t(i * 3), t(i * 3 + 1)] as [number, number])
    expect(sanitizeAfterMidnight({ taskId: 'a', day: DAY, seconds: 1, spans })!.spans).toHaveLength(50)
  })

  it('a later midnight replaces the note: only the last one counts', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 600, 600)
    store.beginAfterMidnight('a', '2026-10-23')
    store.addTrackedSeconds('a', 7, 7)
    expect(store.afterMidnight).toEqual({ taskId: 'a', day: '2026-10-23', seconds: 7, spans: [] })
  })

  it('hands out the noted seconds once and changes no time: the pass asks the user instead of removing', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 400, 400)
    expect(store.takeAfterMidnight('a', DAY)).toEqual({ taskId: 'a', day: DAY, seconds: 400, spans: [] })
    expect(store.task('a')!.timeSpentSeconds).toBe(1400)
    expect(store.afterMidnight).toBeNull()
    expect(store.takeAfterMidnight('a', DAY)).toBeNull()
  })

  it('hands out nothing for another task, another day or without a note, and drops the note', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 400, 400)
    expect(store.takeAfterMidnight('b', DAY)).toBeNull()
    expect(store.afterMidnight).toBeNull()
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 50, 50)
    expect(store.takeAfterMidnight('a', '2026-10-23')).toBeNull()
    expect(store.takeAfterMidnight('a', DAY)).toBeNull()
    expect(store.task('a')!.timeSpentSeconds).toBe(1450)
    expect(store.task('b')!.timeSpentSeconds).toBe(1000)
  })

  it('a malformed stored note hands out nothing', () => {
    store.afterMidnight = { taskId: 'a', day: DAY, seconds: -300, spans: [] }
    expect(store.takeAfterMidnight('a', DAY)).toBeNull()
    store.afterMidnight = { taskId: 'a', day: DAY, seconds: 'all', spans: [] } as never
    expect(store.takeAfterMidnight('a', DAY)).toBeNull()
    expect(store.task('a')!.timeSpentSeconds).toBe(1000)
  })

  it('takeOffSeconds lowers the time by exactly that much and never below zero', () => {
    expect(store.takeOffSeconds('a', 400)).toBe(400)
    expect(store.task('a')!.timeSpentSeconds).toBe(600)
    expect(store.takeOffSeconds('a', 5000)).toBe(600)
    expect(store.task('a')!.timeSpentSeconds).toBe(0)
    expect(store.takeOffSeconds('a', 10)).toBe(0)
    expect(store.takeOffSeconds('a', Number.NaN)).toBe(0)
    expect(store.takeOffSeconds('nobody', 10)).toBe(0)
    expect(store.task('b')!.timeSpentSeconds).toBe(1000)
  })

  it('the user\'s own time edit drops the note of that task only', () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 400, 400)
    store.setTimeSpent('b', 5)
    expect(store.afterMidnight).not.toBeNull()
    store.setTimeSpent('a', 900)
    expect(store.afterMidnight).toBeNull()
    expect(store.takeAfterMidnight('a', DAY)).toBeNull()
    expect(store.task('a')!.timeSpentSeconds).toBe(900)
  })

  it('survives a restart; data stored before #356 has none and is not written at hydration', async () => {
    store.beginAfterMidnight('a', DAY)
    store.addTrackedSeconds('a', 20, 20)
    await nextTick()
    freshPinia()
    expect(useTasksStore().validAfterMidnight).toEqual({ taskId: 'a', day: DAY, seconds: 20, spans: [] })

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
