/**
 * #702 (review round 2): "Rückgängig" of a bulk plan on a source that plans by date waits for the plan's write loop, so a
 * date whose write had not started is not written after the undo: afterwards no task keeps a written date.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TaskSourceAdapter } from '~/integrations/sources/types'

vi.mock('~/composables/useErrorHandler', () => ({ useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }) }))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }),
}))
const toastAdd = vi.fn()
vi.mock('#imports', () => ({ useToast: () => ({ add: toastAdd, remove: vi.fn() }) }))
vi.mock('~/composables/useIsDesktop', () => ({ isPhoneNow: () => false }))
vi.mock('~/composables/usePlanToasts', () => ({ PLAN_TOAST_MS: 6000, usePlanToasts: () => ({ afterPlan: vi.fn(), afterPutBack: vi.fn() }) }))

const TODAY = '2026-11-19'
/** The date Reminders holds per task id; `gates` holds each write until the test lets it go. */
const held = new Map<string, string>()
const gates: Array<() => void> = []
let autoRelease = false
let restoreStarted = false
let writesStartedAfterRestore = 0
const restoreDueDate = vi.fn(async (task: Task) => { restoreStarted = true; held.set(task.id, '2026-11-25'); return task })
const adapter = {
  id: 'reminders', syncsTime: false, planningByDate: true, isConfigured: () => true,
  fetchActive: async () => [] as Task[],
  planWrite: (task: Task) => (task.reminders?.due?.date !== TODAY ? TODAY : null),
  planningHeld: (task: Task) => (task.reminders?.due?.date === TODAY ? null : 'not-today'),
  update: vi.fn(async (task: Task) => {
    if (task.pendingSync?.dateWrite !== TODAY || task.notPlanned === true) return null
    if (restoreStarted) writesStartedAfterRestore++
    await new Promise<void>((resolve) => { if (autoRelease) setTimeout(resolve, 5); else gates.push(resolve) })
    held.set(task.id, TODAY)
    return { ...task, reminders: { ...task.reminders!, due: { date: TODAY, time: null }, wrote: { from: '2026-11-25', to: TODAY, at: 1 } } }
  }),
  restoreDueDate,
  create: async () => { throw new Error('read-only') }, remove: async () => {}, restore: async (task: Task) => task,
  archivesAsStatus: () => false, health: () => 'healthy' as const,
} as unknown as TaskSourceAdapter
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: () => adapter }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { usePlanAll } from '~/composables/usePlanAll'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
/* eslint-enable import/first */

const reminder = (id: string): Task => ({
  id, source: 'reminders', externalId: id, title: `Reminder ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, notPlanned: true, sourceNotPlanned: 'not-today',
  reminders: { due: { date: '2026-11-25', time: null }, recurrence: null, listId: 'L1' },
})

describe('usePlanAll undo while the write loop runs (source that plans by date)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    toastAdd.mockReset(); held.clear(); gates.length = 0; autoRelease = false; restoreStarted = false; writesStartedAfterRestore = 0; restoreDueDate.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['reminders'], default: 'local' })
  })

  it('waits for the loop: no task keeps today after the undo', async () => {
    const store = useTasksStore()
    for (const id of ['a', 'b', 'c']) held.set(id, '2026-11-25')
    store.setTasks([reminder('a'), reminder('b'), reminder('c')])
    await usePlanAll().planAll(['a', 'b', 'c'])
    // the first write is out, b and c have not started
    await vi.waitFor(() => expect(gates).toHaveLength(1))
    const action = (toastAdd.mock.calls[0]![0] as { actions: Array<{ onClick: () => void }> }).actions[0]!
    action.onClick()
    // only the first write is let go; the later ones answer at once. Without the wait the undo walks past tasks whose
    // write has not started and the loop writes today after it
    autoRelease = true
    gates.splice(0).forEach(release => release())
    await vi.waitFor(() => expect(store.tasksNotPlanned).toHaveLength(3))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(store.tasksNotPlanned.map(t => t.id).sort()).toEqual(['a', 'b', 'c'])
    // no write of the plan starts once the undo has begun to restore: the undo waited for the loop
    expect(writesStartedAfterRestore).toBe(0)
    for (const id of ['a', 'b', 'c']) expect(held.get(id)).toBe('2026-11-25')
  })
})
