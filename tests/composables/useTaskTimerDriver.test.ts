import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { toRaw } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskTimerDriver, stopTaskTimer } from '~/composables/useTaskTimerDriver'
import { useTasksStore } from '~/store/tasks'
import { armedTaskTimerIds, disarmAllTaskTimers, isResumeEntry, withResumeEntry } from '~/lib/taskTimers'
import { clearAllLiveSeconds, liveTimeSpent, LIVE_CHECKPOINT_SECONDS } from '~/lib/liveTime'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe('useTaskTimerDriver (#352)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let driver: ReturnType<typeof useTaskTimerDriver>

  /** What the user sees: stored time plus the seconds not yet checkpointed (#286) */
  const spent = (id: string) => liveTimeSpent(tasksStore.task(id)!)
  const stored = (id: string) => tasksStore.task(id)!.timeSpentSeconds

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    tasksStore = useTasksStore()
    driver = useTaskTimerDriver()
  })

  afterEach(() => {
    driver.stop()
    disarmAllTaskTimers()
    clearAllLiveSeconds()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('start arms every task in Jetzt and counts from the saved time', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress, timeSpentSeconds: 40 }), makeTask('b')])
    driver.start()
    vi.advanceTimersByTime(3000)

    expect(spent('a')).toBe(43)
    expect(spent('b')).toBe(0)
    expect(armedTaskTimerIds()).toEqual(['a'])
    expect(tasksStore.task('a')!.timerId).not.toBeNull()
    expect(tasksStore.task('b')!.timerId).toBeNull()
  })

  it('start overwrites a stale persisted timerId without ever calling clearInterval on it', () => {
    tasksStore.setTasks([
      makeTask('a', { status: TaskStatus.Progress, timerId: 7 }),
      makeTask('b', { status: TaskStatus.Waiting, timerId: 8 }),
    ])
    const clear = vi.spyOn(window, 'clearInterval')
    driver.start()

    expect(clear).not.toHaveBeenCalledWith(7)
    expect(clear).not.toHaveBeenCalledWith(8)
    expect(tasksStore.task('b')!.timerId).toBeNull()
    expect(tasksStore.task('a')!.timerId).not.toBe(7)
    expect(armedTaskTimerIds()).toEqual(['a'])
  })

  it('a stale timerId that equals a live interval of the page does not kill that interval', () => {
    const other = vi.fn()
    const liveHandle = window.setInterval(other, 1000)
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Waiting, timerId: liveHandle })])
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(other).toHaveBeenCalledTimes(2)
    window.clearInterval(liveHandle)
  })

  it('a task entering Jetzt starts counting at once, one that leaves stops at once with timerId null', () => {
    tasksStore.setTasks([makeTask('a')])
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(spent('a')).toBe(0)

    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2000)
    expect(spent('a')).toBe(2)

    tasksStore.updateTask('a', { status: TaskStatus.Waiting })
    expect(tasksStore.task('a')!.timerId).toBeNull()
    expect(armedTaskTimerIds()).toEqual([])
    vi.advanceTimersByTime(5000)
    expect(spent('a')).toBe(2)
  })

  it('Offen -> Jetzt -> Wartet -> Jetzt resumes from the kept time with one interval', () => {
    tasksStore.setTasks([makeTask('a')])
    driver.start()
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Waiting })
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(3000)

    expect(spent('a')).toBe(5)
    expect(vi.getTimerCount()).toBe(1)
    expect(armedTaskTimerIds()).toEqual(['a'])
  })

  it('Jetzt -> Erledigt -> undo (back to Jetzt) resumes with one interval', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Done })
    vi.advanceTimersByTime(2000)
    tasksStore.updateTask('a', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(2000)

    expect(spent('a')).toBe(4)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('a removed task disarms; re-adding it (undo of a delete) arms one interval again', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const snapshot = { ...tasksStore.task('a')!, timerId: null }
    tasksStore.removeTask('a')
    expect(armedTaskTimerIds()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)

    tasksStore.addTask(snapshot)
    vi.advanceTimersByTime(2000)
    expect(spent('a')).toBe(2)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('an explicit stop of a task that stays in Jetzt is not re-armed, not even by another task entering Jetzt', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b')])
    driver.start()
    vi.advanceTimersByTime(1000)

    expect(stopTaskTimer('a')).toBe(true)
    expect(tasksStore.task('a')!.timerId).toBeNull()
    tasksStore.updateTask('b', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(3000)

    expect(spent('a')).toBe(1)
    expect(spent('b')).toBe(3)
    expect(armedTaskTimerIds()).toEqual(['b'])
    expect(stopTaskTimer('a')).toBe(false)
  })

  it('a tick for a task that vanished disarms itself: no write, no console error', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const update = vi.spyOn(tasksStore, 'addTrackedSeconds')
    // Through the raw array, so the Jetzt watcher never sees it: only the tick guard can notice
    toRaw(tasksStore.tasks).splice(0, 1)
    vi.advanceTimersByTime(1000)

    expect(update).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(armedTaskTimerIds()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a tick whose task left Jetzt unseen by the watcher disarms, clears timerId and writes no time', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    const update = vi.spyOn(tasksStore, 'addTrackedSeconds')
    toRaw(tasksStore.task('a')!).status = TaskStatus.Waiting
    vi.advanceTimersByTime(1000)

    expect(update).not.toHaveBeenCalled()
    expect(armedTaskTimerIds()).toEqual([])
    expect(tasksStore.task('a')!.timerId).toBeNull()
  })

  it('start twice (HMR re-run) leaves exactly one interval per Jetzt task', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
    driver.start()
    driver.start()
    vi.advanceTimersByTime(3000)
    expect(spent('a')).toBe(3)
    expect(vi.getTimerCount()).toBe(1)
  })

  it('stop disarms everything and stops following the board', () => {
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b')])
    driver.start()
    driver.stop()
    tasksStore.updateTask('b', { status: TaskStatus.Progress })
    vi.advanceTimersByTime(3000)
    expect(vi.getTimerCount()).toBe(0)
    expect(spent('a')).toBe(0)
    expect(spent('b')).toBe(0)
  })

  it('queues tracked time of a Notion task as a pending update and none for a Local task', () => {
    tasksStore.setTasks([
      makeTask('n', { status: TaskStatus.Progress, source: 'notion', externalId: 'page-n' }),
    ])
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(tasksStore.pendingTimeUpdates['n']).toBeUndefined() // not checkpointed yet (#286)
    stopTaskTimer('n')
    expect(tasksStore.pendingTimeUpdates['n']?.timeSpentSeconds).toBe(2)
    driver.stop()

    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    tasksStore.setTasks([makeTask('l', { status: TaskStatus.Progress })])
    driver = useTaskTimerDriver()
    driver.start()
    vi.advanceTimersByTime(2000)
    expect(Object.keys(tasksStore.pendingTimeUpdates)).toEqual([])
  })

  describe('checkpointed time (#286)', () => {
    it('writes the store once per checkpoint, not once per tick', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress, timeSpentSeconds: 100 })])
      driver.start()
      const write = vi.spyOn(tasksStore, 'addTrackedSeconds')

      vi.advanceTimersByTime(30 * 1000)

      expect(write).toHaveBeenCalledTimes(3)
      expect(stored('a')).toBe(130)
      expect(spent('a')).toBe(130)
    })

    it('the shown time advances every second between checkpoints while the stored time stays', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress, timeSpentSeconds: 100 })])
      driver.start()

      vi.advanceTimersByTime(4000)
      expect(spent('a')).toBe(104)
      expect(stored('a')).toBe(100)

      vi.advanceTimersByTime((LIVE_CHECKPOINT_SECONDS - 4) * 1000)
      expect(stored('a')).toBe(100 + LIVE_CHECKPOINT_SECONDS)
    })

    it('a task leaving Jetzt keeps every second, also the ones of the open checkpoint', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(14 * 1000)
      tasksStore.updateTask('a', { status: TaskStatus.Done })

      expect(stored('a')).toBe(14)
      expect(spent('a')).toBe(14)
      vi.advanceTimersByTime(30 * 1000)
      expect(spent('a')).toBe(14)
    })

    it('an explicit stop writes the open seconds before the timer goes', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(3000)

      stopTaskTimer('a')

      expect(stored('a')).toBe(3)
      expect(tasksStore.task('a')!.timerId).toBeNull()
    })

    it('driver stop writes the open seconds', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(3000)
      driver.stop()
      expect(stored('a')).toBe(3)
    })

    it('pagehide writes the open seconds and the timer keeps counting', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(4000)

      window.dispatchEvent(new Event('pagehide'))
      expect(stored('a')).toBe(4)

      vi.advanceTimersByTime(2000)
      expect(spent('a')).toBe(6)
    })

    it('the page turning hidden writes the open seconds, turning visible writes nothing', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(4000)
      const state = vi.spyOn(document, 'visibilityState', 'get')

      state.mockReturnValue('visible')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(stored('a')).toBe(0)

      state.mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(stored('a')).toBe(4)
    })

    it('stops listening to the page when the last timer is gone', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      const remove = vi.spyOn(window, 'removeEventListener')
      driver.start()
      driver.stop()
      expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function))
    })

    it('a Notion task that leaves Jetzt keeps its queued time with the open seconds', () => {
      tasksStore.setTasks([makeTask('n', { status: TaskStatus.Progress, source: 'notion', externalId: 'page-n', timeSpentSeconds: 60 })])
      driver.start()
      vi.advanceTimersByTime(13 * 1000) // one checkpoint (10) and 3 open seconds

      tasksStore.updateTask('n', { status: TaskStatus.Waiting })

      expect(stored('n')).toBe(73)
      expect(tasksStore.pendingTimeUpdates['n']?.timeSpentSeconds).toBe(73)
    })

    it('midnight (#356): the seconds until the crossing are written as they are, the count for the new day starts after them and notes the away seconds only', () => {
      vi.setSystemTime(new Date(2026, 9, 21, 23, 58, 0))
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      window.dispatchEvent(new Event('blur')) // the user leaves the window at 23:58:00; the grace is 60 s
      vi.advanceTimersByTime(119 * 1000)
      expect(tasksStore.afterMidnight).toBeNull()
      vi.advanceTimersByTime(1000) // the tick at 00:00:00
      // 120 seconds written at once (not a checkpoint of ten): none of them is "after midnight"
      expect(stored('a')).toBe(120)
      expect(tasksStore.afterMidnight).toEqual({ taskId: 'a', day: '2026-10-22', seconds: 0, spans: [] })
      vi.advanceTimersByTime(12 * 1000)
      expect(tasksStore.afterMidnight).toMatchObject({ taskId: 'a', day: '2026-10-22', seconds: 10 })
      stopTaskTimer('a')
      // the seconds and the wall-clock stretch they were counted in (from midnight on, the Statistik sessions are cut by it)
      expect(tasksStore.afterMidnight).toEqual({
        taskId: 'a', day: '2026-10-22', seconds: 12, spans: [[new Date(2026, 9, 22, 0, 0, 0).getTime(), new Date(2026, 9, 22, 0, 0, 12).getTime()]],
      })
      expect(stored('a')).toBe(132)
    })

    it('midnight (#356): seconds counted with the user in the window are not noted, the ones after the user left are', () => {
      vi.setSystemTime(new Date(2026, 9, 21, 23, 59, 55))
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(5000) // 00:00:00, the crossing
      vi.advanceTimersByTime(30 * 1000) // 30 s in the window
      expect(tasksStore.afterMidnight).toEqual({ taskId: 'a', day: '2026-10-22', seconds: 0, spans: [] })
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(59 * 1000) // inside the grace: still present
      expect(tasksStore.afterMidnight).toEqual({ taskId: 'a', day: '2026-10-22', seconds: 0, spans: [] })
      vi.advanceTimersByTime(21 * 1000) // 21 s with the user away (the tick at the grace itself counts as away)
      stopTaskTimer('a')
      // the away seconds and exactly their stretch (00:01:29 to 00:01:50), one span across the checkpoints in between
      expect(tasksStore.afterMidnight).toEqual({
        taskId: 'a', day: '2026-10-22', seconds: 21, spans: [[new Date(2026, 9, 22, 0, 1, 29).getTime(), new Date(2026, 9, 22, 0, 1, 50).getTime()]],
      })
      expect(stored('a')).toBe(5 + 30 + 59 + 21)
    })

    it('midnight (#356): a write held at the crossing (a batch move) is tried again before the count starts', () => {
      vi.setSystemTime(new Date(2026, 9, 21, 23, 59, 57))
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress }), makeTask('b')])
      driver.start()
      vi.advanceTimersByTime(2000)
      tasksStore.batchUpdateTaskStatus(['b'], TaskStatus.Waiting) // holds every update for two seconds
      vi.advanceTimersByTime(1000) // 00:00:00: the write is refused, the count must not start
      expect(tasksStore.afterMidnight).toBeNull()
      expect(stored('a')).toBe(0)
      vi.advanceTimersByTime(4000) // the hold ends; the next tick writes everything collected so far, then the count starts
      stopTaskTimer('a')
      const counted = tasksStore.afterMidnight!
      expect(counted).toMatchObject({ taskId: 'a', day: '2026-10-22' })
      expect(stored('a')).toBe(7)
      // every second up to the first write that went through counts as before midnight: at least the three until the crossing
      expect(counted.seconds).toBeLessThanOrEqual(3)
      expect(stored('a') - counted.seconds).toBeGreaterThanOrEqual(4)
    })

    it('midnight (#356): a timer that starts after midnight notes nothing, and a task entering Jetzt drops an older note of its own', () => {
      vi.setSystemTime(new Date(2026, 9, 22, 0, 10))
      tasksStore.setTasks([makeTask('a')])
      driver.start()
      tasksStore.afterMidnight = { taskId: 'a', day: '2026-10-22', seconds: 300, spans: [] }
      tasksStore.updateTask('a', { status: TaskStatus.Progress })
      vi.advanceTimersByTime(20 * 1000)
      expect(tasksStore.afterMidnight).toBeNull()
    })

    it('midnight (#356, #405): a resume of the Now window\'s pause keeps the note, the next entry is a fresh one again', () => {
      vi.setSystemTime(new Date(2026, 9, 22, 0, 10))
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Waiting })])
      driver.start()
      const note = { taskId: 'a', day: '2026-10-22', seconds: 300, spans: [] }
      tasksStore.afterMidnight = { ...note }
      withResumeEntry('a', () => tasksStore.updateTask('a', { status: TaskStatus.Progress }))
      expect(tasksStore.afterMidnight).toEqual(note)
      expect(armedTaskTimerIds()).toEqual(['a'])
      expect(isResumeEntry('a')).toBe(false)

      // leaves Jetzt and comes back by the user's hand (a drag, the menu): fresh entry, the note goes
      tasksStore.updateTask('a', { status: TaskStatus.Waiting })
      tasksStore.updateTask('a', { status: TaskStatus.Progress })
      expect(tasksStore.afterMidnight).toBeNull()
    })

    it('a task removed with open seconds drops them: no write, no leftover', () => {
      tasksStore.setTasks([makeTask('a', { status: TaskStatus.Progress })])
      driver.start()
      vi.advanceTimersByTime(3000)
      const snapshot = { ...tasksStore.task('a')!, timerId: null }
      tasksStore.removeTask('a')
      tasksStore.addTask(snapshot)
      vi.advanceTimersByTime(2000)

      expect(spent('a')).toBe(2) // the removed task's open seconds are gone with it
    })
  })
})
