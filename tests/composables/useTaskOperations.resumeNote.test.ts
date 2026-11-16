import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTaskOperations } from '~/composables/useTaskOperations'
import { useTaskTimerDriver } from '~/composables/useTaskTimerDriver'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { disarmAllTaskTimers, isResumeEntry } from '~/lib/taskTimers'
import { clearAllLiveSeconds } from '~/lib/liveTime'
import { switchSource } from '../helpers/taskSource'

// Only the upstream source and the error toast are mocked: the move path is the real one end to end
// (useTaskOperations.moveTaskToStatus -> board store -> useTaskSync.updateTaskStatus -> tasks store -> driver watcher).
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/integrations/NotionIntegration', () => ({
  NotionIntegration: vi.fn().mockImplementation(function () { return { updateTask: vi.fn() } }),
}))
vi.mock('~/integrations/TodoistIntegration', () => ({
  TodoistIntegration: vi.fn().mockImplementation(function () { return { completeTask: vi.fn(), reopenTask: vi.fn() } }),
}))

function makeTask(id: string, extra: Partial<Task> = {}): Task {
  return {
    id, source: 'local', externalId: null, title: `Task ${id}`, status: TaskStatus.Open, activity: null, topic: null,
    topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, ...extra,
  }
}

describe('Now window resume keeps the after-midnight note through the real move path (#405, #356)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>
  let driver: ReturnType<typeof useTaskTimerDriver>
  const note = { taskId: 'a', day: '2026-10-22', seconds: 300, spans: [] }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 22, 0, 10))
    switchSource('local')
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    tasksStore.setTasks([makeTask('a', { status: TaskStatus.Waiting })])
    driver = useTaskTimerDriver()
    driver.start()
    tasksStore.afterMidnight = { ...note }
  })

  afterEach(() => {
    driver.stop()
    disarmAllTaskTimers()
    clearAllLiveSeconds()
    vi.useRealTimers()
  })

  it('a resume from the pill keeps the note, asks no timebox question, and leaves no marker behind', async () => {
    const { moveTaskToStatus } = useTaskOperations()

    expect(await moveTaskToStatus('a', TaskStatus.Progress, { resume: true })).toBe(true)

    expect(tasksStore.task('a')!.status).toBe(TaskStatus.Progress)
    expect(tasksStore.afterMidnight).toEqual(note)
    expect(boardStore.timeboxNudgeTaskId).toBeNull()
    expect(isResumeEntry('a')).toBe(false)
  })

  it('a move into Jetzt by the user\'s hand (no resume option) is a fresh entry: the note goes', async () => {
    const { moveTaskToStatus } = useTaskOperations()

    expect(await moveTaskToStatus('a', TaskStatus.Progress)).toBe(true)

    expect(tasksStore.afterMidnight).toBeNull()
  })

  it('a pause and a resume again: the second entry after a plain drag out and back is fresh', async () => {
    const { moveTaskToStatus } = useTaskOperations()

    await moveTaskToStatus('a', TaskStatus.Progress, { resume: true })
    await moveTaskToStatus('a', TaskStatus.Waiting, { pause: true })
    await moveTaskToStatus('a', TaskStatus.Progress)

    expect(tasksStore.afterMidnight).toBeNull()
  })
})
