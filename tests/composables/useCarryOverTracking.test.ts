/**
 * #356: the carried-over count means "planned for the n-th day". A day only counts for what is on the board after
 * the new day's pass, so nothing is counted while that pass is still due; days under "Meine Aufgaben" never count.
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

describe('useCarryOverTracking and the new day (#356)', () => {
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

  it('counts nothing on a new day before the pass has run; after it only what is planned again counts the day', async () => {
    mountTracker()
    expect(days('a')).toBe(0)

    // the next morning: the board mounts or the tab returns, the count is asked for before the pass
    now = new Date(2026, 9, 22, 9, 0)
    record()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(days('a')).toBe(0)
    expect(tasks.carryOverByTaskId.a!.lastOn).toBe('2026-10-21')

    useNewDay().run(now)
    record()
    await nextTick()
    // sent back: no planned day; Wartet stayed on the board and counts its day
    expect(days('a')).toBe(0)
    expect(days('b')).toBe(0)
    expect(days('w')).toBe(1)

    tasks.planTask('a')
    await nextTick()
    expect(days('a')).toBe(1)
    expect(days('b')).toBe(0)
  })

  it('a task that waits under "Meine Aufgaben" for days keeps its count and goes on from it when planned again', async () => {
    mountTracker()
    for (const day of [22, 23, 24]) {
      now = new Date(2026, 9, day, 9, 0)
      useNewDay().run(now)
      record()
      await nextTick()
    }
    expect(days('a')).toBe(0)
    expect(days('w')).toBe(3)
    tasks.planTask('a')
    await nextTick()
    expect(days('a')).toBe(1)
  })

  it('counts as before on a board that has no pass due (a new board, the same day)', () => {
    const recap = useDayRecapStore()
    recap.lastShownDay = null
    recap.lastNewDay = null
    mountTracker()
    now = new Date(2026, 9, 22, 9, 0)
    record()
    expect(days('a')).toBe(1)
  })
})
