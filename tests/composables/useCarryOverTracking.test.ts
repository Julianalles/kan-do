/**
 * #356, #387: the carried-over count means "planned for the n-th day". Every further day an unfinished card is on the
 * board counts, also when the user skipped planning; the user's fresh start takes the day back for the cards it takes
 * off, so it counts only for what is planned again. Days under "Meine Aufgaben" never count.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useCarryOverTracking } from '~/composables/useCarryOver'
import { useNewDay } from '~/composables/useNewDay'
import { useDayClose } from '~/composables/useDayClose'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useDayRecapStore } from '~/store/dayRecap'
import { dataState } from '~/lib/dataStorage'
import { emptyDataStatus } from '~/lib/dataStatus'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const task = (id: string, status: TaskStatus): Task => ({
  id, source: 'local', externalId: null, title: id, notes: null, status, priority: 1, timeBoxSeconds: null, timeSpentSeconds: 0,
  topic: null, topicColorCode: null, activity: null, timerId: null,
})

let now = new Date(2026, 9, 21, 10, 0)
let record = () => {}
const mountTracker = () => mount(defineComponent({ setup() { record = useCarryOverTracking(() => now).record; return () => null } }))

describe('useCarryOverTracking and the new day (#356, #387)', () => {
  let tasks: ReturnType<typeof useTasksStore>
  const days = (id: string) => tasks.carryOverByTaskId[id]?.days

  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    now = new Date(2026, 9, 21, 10, 0)
    Object.assign(dataState, emptyDataStatus(), { available: false })
    useDayClose().close()
    tasks = useTasksStore()
    useBoardStore().setSources({ connected: [], default: 'local' })
    tasks.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Open), task('w', TaskStatus.Waiting)])
    const recap = useDayRecapStore()
    recap.lastShownDay = '2026-10-21'
    recap.lastNewDay = '2026-10-21'
  })

  it('a skipped day counts: every card that stays on the board over a new day gains that day, without a fresh start', () => {
    mountTracker()
    expect(days('a')).toBe(0)
    now = new Date(2026, 9, 22, 9, 0)
    record()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(days('a')).toBe(1)
    expect(days('b')).toBe(1)
    expect(days('w')).toBe(1)
    // the same day again: counted once
    record()
    expect(days('a')).toBe(1)
    // two more days without planning
    now = new Date(2026, 9, 23, 9, 0)
    record()
    now = new Date(2026, 9, 24, 9, 0)
    record()
    expect(days('a')).toBe(3)
    expect(days('w')).toBe(3)
  })

  it('the fresh start takes the day back for the cards it takes off; only what is planned again counts it', async () => {
    mountTracker()
    now = new Date(2026, 9, 22, 9, 0)
    // the board mounts and counts the morning, then the user starts the day fresh
    record()
    expect(days('a')).toBe(1)
    expect(useNewDay().freshStart(now)).toEqual(['a', 'b', 'w'])
    await nextTick()
    expect(days('a')).toBe(0)
    expect(days('b')).toBe(0)
    expect(days('w')).toBe(0)

    tasks.planTask('a')
    await nextTick()
    expect(days('a')).toBe(1)
    expect(days('b')).toBe(0)
    // planned and put back the same day: the day stays counted once, it is never taken back twice
    tasks.unplanTask('a')
    tasks.planTask('a')
    await nextTick()
    expect(days('a')).toBe(1)
  })

  it('a task that waits under "Meine Aufgaben" for days keeps its count and goes on from it when planned again', async () => {
    mountTracker()
    now = new Date(2026, 9, 22, 9, 0)
    record()
    useNewDay().freshStart(now)
    for (const day of [23, 24]) {
      now = new Date(2026, 9, day, 9, 0)
      record()
      await nextTick()
    }
    expect(days('a')).toBe(0)
    tasks.planTask('a')
    await nextTick()
    expect(days('a')).toBe(1)
  })

  it('takeBackCarryOver leaves an entry first seen today, one last counted earlier and an unknown id as they are', () => {
    tasks.setCarryOver({
      a: { firstOn: '2026-10-22', days: 0, lastOn: '2026-10-22', keptAtDays: null },
      b: { firstOn: '2026-10-19', days: 2, lastOn: '2026-10-21', keptAtDays: null },
      w: { firstOn: '2026-10-19', days: 3, lastOn: '2026-10-22', keptAtDays: 3 },
    })
    tasks.takeBackCarryOver(['a', 'b', 'w', 'nope'], '2026-10-22')
    expect(tasks.carryOverByTaskId.a).toEqual({ firstOn: '2026-10-22', days: 0, lastOn: '2026-10-22', keptAtDays: null })
    expect(tasks.carryOverByTaskId.b).toEqual({ firstOn: '2026-10-19', days: 2, lastOn: '2026-10-21', keptAtDays: null })
    expect(tasks.carryOverByTaskId.w).toEqual({ firstOn: '2026-10-19', days: 2, lastOn: '2026-10-21', keptAtDays: 3 })
    tasks.takeBackCarryOver(['w'], 'soon')
    expect(days('w')).toBe(2)
  })

  it('counts on a board that has no start due (a new board, the same day)', () => {
    const recap = useDayRecapStore()
    recap.lastShownDay = null
    recap.lastNewDay = null
    mountTracker()
    now = new Date(2026, 9, 22, 9, 0)
    record()
    expect(days('a')).toBe(1)
  })
})
