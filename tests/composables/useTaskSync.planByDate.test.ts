/**
 * #553: a source that plans by date (Apple Reminders) writes on the user's plan only: `planWrite` decides, the task is
 * marked `pendingSync.dateWrite` and pushed, the result (`Task.reminders.wrote`) is applied and the marker cleared. A put-back
 * and every batch take-off (fresh start, day close: `unplanTasks`) write nothing. `restorePlannedDate` gives the old date back
 * and reports a refusal through `useErrorHandler` (context `reminders_write`).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TaskSourceAdapter } from '~/integrations/sources/types'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }),
}))

const TODAY = '2026-11-19'
/** A fake of the date side of the adapter: the date Reminders holds, compare-and-set like the bridge. */
const reminders = { date: null as string | null }
const update = vi.fn()
const restoreDueDate = vi.fn()
const adapter = {
  id: 'reminders',
  syncsTime: false,
  planningByDate: true,
  isConfigured: () => true,
  fetchActive: async () => [] as Task[],
  planWrite: (task: Task) => (!task.reminders?.recurrence && task.reminders?.due?.date !== TODAY ? TODAY : null),
  planningHeld: (task: Task) => (task.reminders?.due?.date === TODAY ? null : 'not-today'),
  update,
  restoreDueDate,
  create: async () => { throw new Error('read-only') },
  remove: async () => {},
  restore: async (task: Task) => task,
  archivesAsStatus: () => false,
  health: () => 'healthy' as const,
} as unknown as TaskSourceAdapter
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: () => adapter }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { isNotPlanned } from '~/lib/taskPlanning'
import { wroteOf } from '~/lib/remindersSource'
/* eslint-enable import/first */

const reminder = (id: string, due: string | null, over: Partial<Task> = {}): Task => ({
  id, source: 'reminders', externalId: id, title: `Reminder ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, notPlanned: true, sourceNotPlanned: 'not-today',
  reminders: { due: due ? { date: due, time: '09:00' } : null, recurrence: null, listId: 'L1' }, ...over,
})

/** The adapter's update as it behaves: writes today when the task asks for it and holds another date. */
const stubUpdate = () => update.mockImplementation(async (task: Task) => {
  if (task.pendingSync?.dateWrite !== TODAY || task.notPlanned === true || task.reminders?.due?.date === TODAY) return null
  const from = reminders.date
  reminders.date = TODAY
  return { ...task, reminders: { ...task.reminders!, due: { date: TODAY, time: '09:00' }, wrote: { from, to: TODAY, at: 1 } } }
})

describe('plan and put-back of a source that plans by date (#553)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    update.mockReset()
    restoreDueDate.mockReset()
    reminders.date = '2026-11-25'
    stubUpdate()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['reminders'], default: 'local' })
  })

  it('a plan whose date is not today marks the task pending with dateWrite, pushes it and applies what was written', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', '2026-11-25')])
    const sync = useTaskSync()
    expect(sync.planTask('a')).toBe(true)
    // Marked at once: a fetch that lands before the write keeps the local plan
    expect(store.task('a')!.pendingSync?.dateWrite).toBe(TODAY)
    await sync.whenPlanWritten('a')
    expect(update).toHaveBeenCalledTimes(1)
    expect(store.task('a')!.pendingSync).toBeUndefined()
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.reminders?.due?.date).toBe(TODAY)
    expect(wroteOf(store.task('a')!)).toEqual({ from: '2026-11-25', to: TODAY, at: 1 })
  })

  it('the held value follows the date: cleared once the plan wrote today, set again by a put-back while the date is not today', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', '2026-11-25')])
    const sync = useTaskSync()
    sync.planTask('a')
    await sync.whenPlanWritten('a')
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
    // Put back while Reminders says today: nothing held, so the next fetch (same answer) leaves the put-back alone
    sync.unplanTask('a')
    expect(store.task('a')!.sourceNotPlanned).toBeUndefined()
    expect(update).toHaveBeenCalledTimes(1)
    // …and while the date is not today the source holds it as not today
    store.updateTask('a', { reminders: { due: { date: '2026-12-24', time: null }, recurrence: null, listId: 'L1' } })
    store.planTask('a')
    sync.unplanTask('a')
    expect(store.task('a')!.sourceNotPlanned).toBe('not-today')
  })

  it('a plan of a reminder already dated today writes nothing and sets no marker; a recurring one neither', async () => {
    const store = useTasksStore()
    store.setTasks([
      reminder('today', TODAY),
      reminder('series', '2026-11-25', { reminders: { due: { date: '2026-11-25', time: null }, recurrence: 'FREQ=WEEKLY', listId: 'L1' } }),
    ])
    useTaskSync().planTasks(['today', 'series'])
    await useTaskSync().whenPlanWritten('today')
    expect(update).not.toHaveBeenCalled()
    expect(store.task('today')!.pendingSync).toBeUndefined()
    expect(store.task('series')!.pendingSync).toBeUndefined()
    expect(isNotPlanned(store.task('series')!)).toBe(false)
  })

  it('a put-back writes nothing, and neither does any batch take-off', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', TODAY, { notPlanned: undefined, sourceNotPlanned: undefined }), reminder('b', TODAY, { notPlanned: undefined, sourceNotPlanned: undefined })])
    const sync = useTaskSync()
    expect(sync.unplanTask('a')).toBe(true)
    expect(sync.unplanTasks(['b'])).toEqual(['b'])
    await sync.whenPlanWritten('a')
    expect(update).not.toHaveBeenCalled()
    expect(store.task('a')!.pendingSync).toBeUndefined()
    expect(store.task('b')!.pendingSync).toBeUndefined()
    expect(isNotPlanned(store.task('a')!)).toBe(true)
  })

  it('a waiting reminder planned for today gets no date write and no marker; taken off again, nothing either (#793)', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('w', '2026-11-25', { status: TaskStatus.Waiting })])
    const sync = useTaskSync()
    expect(sync.planTask('w')).toBe(true)
    await sync.whenPlanWritten('w')
    expect(update).not.toHaveBeenCalled()
    expect(store.task('w')).toMatchObject({ status: TaskStatus.Waiting, sourceNotPlanned: 'not-today' })
    expect(store.task('w')!.pendingSync).toBeUndefined()
    expect(isNotPlanned(store.task('w')!)).toBe(false)
    expect(sync.unplanTask('w')).toBe(true)
    expect(update).not.toHaveBeenCalled()
    expect(store.task('w')).toMatchObject({ status: TaskStatus.Waiting, notPlanned: true })
  })

  // Review of PR 809: what the date says is noted locally on a waiting reminder too (no write), so the next fetch compares
  // against the answer the user's choice was made under
  it('a waiting reminder\'s put-back and plan note what its date says now, write nothing and queue no date write (#793)', async () => {
    const store = useTasksStore()
    store.setTasks([
      reminder('tomorrow', '2026-11-25', { status: TaskStatus.Waiting, notPlanned: undefined, sourceNotPlanned: undefined }),
      reminder('today', TODAY, { status: TaskStatus.Waiting, notPlanned: undefined, sourceNotPlanned: 'not-today' }),
    ])
    const sync = useTaskSync()
    // Put back while the date is not today: held as not today, so the fetch on its due day plans it again
    expect(sync.unplanTask('tomorrow')).toBe(true)
    expect(store.task('tomorrow')).toMatchObject({ notPlanned: true, sourceNotPlanned: 'not-today' })
    // Put back while the date is today: a stale value goes, so the next fetch (today, the same answer) leaves the put-back alone
    expect(sync.unplanTask('today')).toBe(true)
    expect(store.task('today')!.sourceNotPlanned).toBeUndefined()
    store.mergeTasks('reminders', [{ ...store.task('today')!, notPlanned: undefined }], { planningByDate: true })
    expect(isNotPlanned(store.task('today')!)).toBe(true)
    // Planned again: no date write, the held value is what the date says
    expect(sync.planTask('today')).toBe(true)
    await sync.whenPlanWritten('today')
    expect(store.task('today')!.sourceNotPlanned).toBeUndefined()
    expect(store.task('today')!.pendingSync).toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  it('a date write the plan of an Offen reminder queued is taken back when the task, now waiting, is put back (#793)', () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', '2026-11-25')])
    const sync = useTaskSync()
    store.markDateWrite('a', TODAY)
    store.planTask('a')
    store.updateTask('a', { status: TaskStatus.Waiting })
    sync.unplanTask('a')
    expect(store.task('a')!.pendingSync?.dateWrite).toBeUndefined()
  })

  it('plan, put back, plan in quick succession: one write, later plans are no-op successes', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', '2026-11-25')])
    const sync = useTaskSync()
    sync.planTask('a')
    sync.unplanTask('a')
    sync.planTask('a')
    await sync.whenPlanWritten('a')
    await vi.waitFor(() => expect(store.task('a')!.pendingSync).toBeUndefined())
    const writes = update.mock.results.filter(r => r.value instanceof Promise).length
    expect(writes).toBeGreaterThanOrEqual(1)
    // The date was written exactly once: the adapter's compare-and-set saw today afterwards
    expect(reminders.date).toBe(TODAY)
    expect(wroteOf(store.task('a')!)).toMatchObject({ from: '2026-11-25', to: TODAY })
    expect(isNotPlanned(store.task('a')!)).toBe(false)
  })

  it('a failed write leaves the task planned and marked with the error; the next push retries', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', '2026-11-25')])
    update.mockRejectedValueOnce(new Error('reminders: save-failed'))
    const sync = useTaskSync()
    sync.planTask('a')
    await sync.whenPlanWritten('a')
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.pendingSync).toMatchObject({ dateWrite: TODAY, attempts: 1 })
    stubUpdate()
    await sync.syncPendingChanges('reminders')
    expect(store.task('a')!.pendingSync).toBeUndefined()
    expect(wroteOf(store.task('a')!)?.to).toBe(TODAY)
  })

  it('a push for another reason (a time box) never writes a date', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('a', '2026-12-01', { notPlanned: undefined, sourceNotPlanned: undefined })])
    await useTaskSync().syncTaskToIntegration(store.task('a')!)
    await expect(update.mock.results[0]!.value).resolves.toBeNull()
    expect(reminders.date).toBe('2026-11-25')
  })
})

describe('restorePlannedDate (#553)', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    handleErrorMock.mockReset()
    restoreDueDate.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['reminders'], default: 'local' })
  })
  const withWrote = (): Task => reminder('a', TODAY, {
    notPlanned: undefined, sourceNotPlanned: undefined,
    reminders: { due: { date: TODAY, time: '09:00' }, recurrence: null, listId: 'L1', wrote: { from: '2026-11-25', to: TODAY, at: 1 } },
  })

  it('applies the restored date and drops wrote', async () => {
    const store = useTasksStore()
    store.setTasks([withWrote()])
    restoreDueDate.mockImplementation(async (task: Task) => ({ ...task, reminders: { due: { date: '2026-11-25', time: '09:00' }, recurrence: null, listId: 'L1' } }))
    expect(await useTaskSync().restorePlannedDate('a')).toBe(true)
    expect(store.task('a')!.reminders?.due?.date).toBe('2026-11-25')
    expect(wroteOf(store.task('a')!)).toBeNull()
    expect(store.task('a')!.pendingSync).toBeUndefined()
  })

  it('an earlier unpushed change keeps its marker through a restore, on success and on failure', async () => {
    const store = useTasksStore()
    const stuck = { since: 5, attempts: 2, lastError: 'reminders: save-failed' }
    store.setTasks([{ ...withWrote(), pendingSync: { ...stuck } }])
    restoreDueDate.mockImplementationOnce(async (task: Task) => ({ ...task, reminders: { due: { date: '2026-11-25', time: '09:00' }, recurrence: null, listId: 'L1' } }))
    expect(await useTaskSync().restorePlannedDate('a')).toBe(true)
    expect(store.task('a')!.pendingSync).toMatchObject(stuck)
    store.updateTask('a', { reminders: { ...store.task('a')!.reminders!, wrote: { from: '2026-11-25', to: TODAY, at: 1 } } })
    restoreDueDate.mockRejectedValueOnce(new Error('reminders: save-failed'))
    expect(await useTaskSync().restorePlannedDate('a')).toBe(false)
    expect(store.task('a')!.pendingSync).toMatchObject(stuck)
  })

  it('the plan\'s marker names the day it was made for', async () => {
    const store = useTasksStore()
    store.setTasks([reminder('b', '2026-11-25')])
    update.mockReset()
    update.mockResolvedValue(null)
    useTaskSync().planTask('b')
    expect(store.task('b')!.pendingSync?.dateWrite).toBe(TODAY)
  })

  it('an undo of an already restored task is a no-op success', async () => {
    const store = useTasksStore()
    store.setTasks([withWrote()])
    restoreDueDate.mockResolvedValue(null)
    expect(await useTaskSync().restorePlannedDate('a')).toBe(true)
    expect(handleErrorMock).not.toHaveBeenCalled()
  })

  it('Reminders moved on: the refusal is reported (reminders_write) and the task keeps its state', async () => {
    const store = useTasksStore()
    store.setTasks([withWrote()])
    restoreDueDate.mockRejectedValue(new Error('reminders: changed'))
    expect(await useTaskSync().restorePlannedDate('a')).toBe(false)
    expect(handleErrorMock).toHaveBeenCalledWith('reminders: changed', 'reminders_write')
    expect(wroteOf(store.task('a')!)).not.toBeNull()
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(store.task('a')!.pendingSync).toBeUndefined()
  })
})
