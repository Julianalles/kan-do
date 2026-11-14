/**
 * #132: with a topic focus on, the capacity line counts the same scope as the list it sits in, so Wartet cards of
 * hidden topics do not use up the day. Real Pinia stores.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { ColumnItem } from '~/types/columnItem'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useSettingsStore } from '~/store/settings'
import { useTaskStatisticsStore } from '~/store/taskStatistics'
import { useDayCapacity } from '~/composables/useDayCapacity'
import { sourceOf } from '../helpers/taskSource'

const makeTask = (id: string, status: TaskStatus, topic: string | null): Task => ({
  id, ...sourceOf(id), title: id, status, activity: null, topic, topicColorCode: null, priority: 0, notes: null,
  timeSpentSeconds: 0, timeBoxSeconds: 3600, timerId: null,
})

describe('useDayCapacity with a topic focus', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('does not count Wartet cards of other topics', () => {
    const tasks = useTasksStore()
    // 5 h of Wartet in topic B, two 1 h Offen cards in topic A; the default day is 6 h
    for (let i = 0; i < 5; i++) tasks.addTask(makeTask(`w${i}`, TaskStatus.Waiting, 'B'))
    useBoardStore().reconcileColumnsWithTasks(tasks.tasks)
    const items = ['o1', 'o2'].map((id): ColumnItem => ({ kind: 'card', key: id, task: makeTask(id, TaskStatus.Open, 'A') }) as ColumnItem)
    const { lineAfterKey } = useDayCapacity(items, true)
    expect(lineAfterKey.value).toBe('o1') // unfocused: 5 h + 1 h fills the day after o1
    useBoardStore().setFocus('A')
    expect(lineAfterKey.value).toBeNull() // focused on A: 2 h of 6 h
  })
})

describe('useDayCapacity with a user-set working day (#306)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('moves the line when the setting changes, and back when it is automatic again', () => {
    const items = ['o1', 'o2', 'o3', 'o4'].map((id): ColumnItem => ({ kind: 'card', key: id, task: makeTask(id, TaskStatus.Open, null) }) as ColumnItem)
    const settings = useSettingsStore()
    const { lineAfterKey } = useDayCapacity(items, true)
    expect(lineAfterKey.value).toBeNull() // 4 h of the default 6 h
    settings.setWorkingHoursMinutes(180)
    expect(lineAfterKey.value).toBe('o3') // 3 h day: full after the third 1 h card
    settings.setWorkingHoursMinutes(720)
    expect(lineAfterKey.value).toBeNull() // beyond the learned 2-10 h clamp
    settings.setWorkingHoursMinutes(null)
    expect(lineAfterKey.value).toBeNull()
  })
})

describe('useDayCapacity with learned estimates (#302)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const unboxed = (id: string, title: string, status = TaskStatus.Open): Task => ({ ...makeTask(id, status, null), title, timeBoxSeconds: null })
  const finished = (n: number, title: string, minutes: number) => Array.from({ length: n }, (_, i) => ({
    taskId: `done-${title}-${i}`, title, completedAt: new Date(), timeBoxSeconds: null, actualTimeSpentSeconds: minutes * 60,
    estimationAccuracy: null, topic: null, topicColorCode: null, activity: null, isUnplanned: false,
  }))
  const itemsOf = (...tasks: Task[]) => tasks.map((task): ColumnItem => ({ kind: 'card', key: task.id, task }) as ColumnItem)

  it('counts an unboxed card as the time similar finished tasks took, a boxed one as its box', () => {
    useSettingsStore().setWorkingHoursMinutes(180)
    const boxed = { ...unboxed('o3', 'Bericht schreiben'), timeBoxSeconds: 3600 }
    const items = itemsOf(unboxed('o1', 'Bericht schreiben'), unboxed('o2', 'Bericht schreiben'), boxed)
    const { lineAfterKey } = useDayCapacity(items, true)
    expect(lineAfterKey.value).toBeNull() // no history: 30 + 30 + 60 min of 3 h
    useTaskStatisticsStore().completionRecords.push(...finished(3, 'Bericht schreiben', 90))
    expect(lineAfterKey.value).toBe('o2') // 90 + 90 min fill the 3 h; the boxed card is not touched by the history
  })

  it('counts Jetzt and Wartet cards without a box the same way', () => {
    useSettingsStore().setWorkingHoursMinutes(180)
    useTaskStatisticsStore().completionRecords.push(...finished(3, 'Bericht schreiben', 90))
    const tasks = useTasksStore()
    tasks.addTask(unboxed('j1', 'Bericht schreiben', TaskStatus.Progress))
    useBoardStore().reconcileColumnsWithTasks(tasks.tasks)
    const { lineAfterKey } = useDayCapacity(itemsOf(unboxed('o1', 'Bericht schreiben'), unboxed('o2', 'Zahnarzt')), true)
    expect(lineAfterKey.value).toBe('o1') // Jetzt 90 + o1 90 = 180
  })

  it('reads old stored statistics without completion records as no history', () => {
    useSettingsStore().setWorkingHoursMinutes(60)
    const statistics = useTaskStatisticsStore()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(statistics as any).completionRecords = [null, { title: 'Bericht schreiben' }, 'x']
    const { lineAfterKey } = useDayCapacity(itemsOf(unboxed('o1', 'Bericht schreiben'), unboxed('o2', 'Bericht schreiben')), true)
    expect(lineAfterKey.value).toBe('o2') // 30 + 30 = 60: the fallback
  })
})
