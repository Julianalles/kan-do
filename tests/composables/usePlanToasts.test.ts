/**
 * #553: the toasts of a task that is planned by its date (Apple Reminders). The plan toast comes after the write answered and
 * names the old date; "Rückgängig" restores it and puts the task back; a recurring plan says the date stays; the put-back
 * toast says Reminders still holds today and offers the old date once, only when kan-do wrote it and Reminders still says
 * today. The adapter is a fake with compare-and-set semantics on the date.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { TaskSourceAdapter } from '~/integrations/sources/types'
import { toastAddMock, toastRemoveMock } from '../mocks/nuxt-imports'

const handleErrorMock = vi.fn()
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: handleErrorMock, handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(), removeDiscardedTime: vi.fn() }),
}))

const TODAY = '2026-11-19'
const bridge = { date: null as string | null, time: null as string | null }
const adapter = {
  id: 'reminders', syncsTime: false, planningByDate: true, isConfigured: () => true, fetchActive: async () => [] as Task[],
  planWrite: (task: Task) => (!task.reminders?.recurrence && task.reminders?.due?.date !== TODAY ? TODAY : null),
  planningHeld: (task: Task) => (task.reminders?.due?.date === TODAY ? null : 'not-today'),
  update: vi.fn(async (task: Task): Promise<Task | null> => {
    if (task.pendingSync?.dateWrite !== TODAY || task.notPlanned === true || task.reminders?.due?.date === TODAY) return null
    const from = bridge.date
    bridge.date = TODAY
    return { ...task, reminders: { ...task.reminders!, due: { date: TODAY, time: bridge.time }, wrote: { from, to: TODAY, at: 1 } } }
  }),
  restoreDueDate: vi.fn(async (task: Task): Promise<Task | null> => {
    const wrote = task.reminders?.wrote
    if (!wrote) return null
    if (bridge.date !== wrote.to) throw new Error('reminders: changed')
    bridge.date = wrote.from
    const { wrote: _gone, ...rest } = task.reminders!
    return { ...task, reminders: { ...rest, due: wrote.from ? { date: wrote.from, time: bridge.time } : null } }
  }),
  create: async () => { throw new Error('read-only') }, remove: async () => {}, restore: async (task: Task) => task,
  archivesAsStatus: () => false, health: () => 'healthy' as const,
} as unknown as TaskSourceAdapter
vi.mock('~/composables/useTaskSources', () => ({ useTaskSources: () => ({ adapterFor: () => adapter }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { usePlanToasts, PLAN_TOAST_MS } from '~/composables/usePlanToasts'
import { useTaskSync } from '~/composables/useTaskSync'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { resetUndoWindows } from '~/composables/useUndoWindow'
import { isNotPlanned } from '~/lib/taskPlanning'
import { setTestLocale } from '../helpers/i18n'
/* eslint-enable import/first */

const reminder = (id: string, due: string | null, time: string | null, over: Partial<Task> = {}): Task => ({
  id, source: 'reminders', externalId: id, title: `Reminder ${id}`, status: TaskStatus.Open, activity: null, topic: null, topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, notPlanned: true, sourceNotPlanned: 'not-today',
  reminders: { due: due ? { date: due, time } : null, recurrence: null, listId: 'L1' }, ...over,
})

type ToastArgs = { id: string; title: string; actions?: Array<{ label: string; onClick: () => void; closeOnClick?: boolean }> }
const lastToast = (): ToastArgs => toastAddMock.mock.calls.at(-1)![0] as ToastArgs

describe('usePlanToasts (#553)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 19, 10, 0))
    localStorage.clear()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    resetUndoWindows()
    setTestLocale('de')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['reminders'], default: 'local' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const plan = async (task: Task, from: string | null = task.reminders?.due?.date ?? null, time: string | null = task.reminders?.due?.time ?? null) => {
    bridge.date = from
    bridge.time = time
    const store = useTasksStore()
    store.setTasks([task])
    const sync = useTaskSync()
    const toasts = usePlanToasts()
    sync.planTask(task.id)
    await toasts.afterPlan(task.id)
    return { store, sync, toasts }
  }

  it('after the write answered the toast names the old date and offers Rückgängig', async () => {
    await plan(reminder('a', '2026-11-25', '09:00'))
    expect(lastToast().title).toBe('Reminder a ist für heute geplant. In Erinnerungen jetzt heute statt 25.11.2026.')
    expect(lastToast().actions?.[0]?.label).toBe('Rückgängig')
    expect(lastToast().actions?.[0]?.closeOnClick).toBe(false)
  })

  it('no old date: "In Erinnerungen jetzt heute, ohne Uhrzeit."; a date without a time: "…, ohne Uhrzeit"', async () => {
    await plan(reminder('a', null, null))
    expect(lastToast().title).toBe('Reminder a ist für heute geplant. In Erinnerungen jetzt heute, ohne Uhrzeit.')
    await plan(reminder('b', '2026-11-25', null))
    expect(lastToast().title).toBe('Reminder b ist für heute geplant. In Erinnerungen jetzt heute statt 25.11.2026, ohne Uhrzeit.')
  })

  it('the English copy reads from the same keys', async () => {
    setTestLocale('en')
    await plan(reminder('a', '2026-11-25', '09:00'))
    expect(lastToast().title).toContain('is planned for today. In Reminders now today instead of')
    expect(lastToast().actions?.[0]?.label).toBe('Undo')
  })

  it('Rückgängig restores the old date and puts the task back', async () => {
    const { store } = await plan(reminder('a', '2026-11-25', '09:00'))
    lastToast().actions![0]!.onClick()
    await vi.waitFor(() => expect(isNotPlanned(store.task('a')!)).toBe(true))
    expect(bridge.date).toBe('2026-11-25')
    expect(store.task('a')!.reminders?.wrote).toBeUndefined()
    expect(toastRemoveMock).toHaveBeenCalledWith('plan-a')
  })

  it('Rückgängig pressed twice restores once', async () => {
    await plan(reminder('a', '2026-11-25', '09:00'))
    const undo = lastToast().actions![0]!.onClick
    undo()
    undo()
    await vi.waitFor(() => expect(adapter.restoreDueDate).toHaveBeenCalledTimes(1))
  })

  it('Reminders moved on before Rückgängig: the refusal is reported and the task stays planned', async () => {
    const { store } = await plan(reminder('a', '2026-11-25', '09:00'))
    bridge.date = '2026-12-24'
    lastToast().actions![0]!.onClick()
    await vi.waitFor(() => expect(handleErrorMock).toHaveBeenCalledWith('reminders: changed', 'reminders_write'))
    expect(isNotPlanned(store.task('a')!)).toBe(false)
    expect(bridge.date).toBe('2026-12-24')
  })

  it('a recurring reminder planned on another day: the toast says the date stays, no action, nothing written', async () => {
    await plan(reminder('a@2026-11-25', '2026-11-25', null, { reminders: { due: { date: '2026-11-25', time: null }, recurrence: 'FREQ=WEEKLY', listId: 'L1' } }))
    expect(lastToast().title).toBe('Reminder a@2026-11-25 ist für heute geplant. Das Datum bleibt, die Aufgabe wiederholt sich.')
    expect(lastToast().actions).toBeUndefined()
    expect(adapter.update).not.toHaveBeenCalled()
  })

  it('a reminder already dated today is planned without a toast', async () => {
    await plan(reminder('a', TODAY, '09:00'))
    expect(toastAddMock).not.toHaveBeenCalled()
  })

  it('after the plan toast closed, wrote stays: the put-back toast can still offer the old date', async () => {
    const { store } = await plan(reminder('a', '2026-11-25', '09:00'))
    const toast = lastToast() as ToastArgs & { 'onUpdate:open': (open: boolean) => void }
    toast['onUpdate:open'](false)
    await vi.advanceTimersByTimeAsync(PLAN_TOAST_MS + 1000)
    expect(store.task('a')!.reminders?.wrote).toBeDefined()
  })

  describe('put-back', () => {
    const planned = async (from: string | null) => {
      const ctx = await plan(reminder('a', from, '09:00'))
      toastAddMock.mockClear()
      return ctx
    }

    it('writes nothing; the toast says Reminders still holds today and offers the old date', async () => {
      const { sync, toasts } = await planned('2026-11-25')
      const writes = vi.mocked(adapter.update).mock.calls.length
      expect(sync.unplanTask('a')).toBe(true)
      await toasts.afterPutBack('a')
      expect(lastToast().title).toBe('Reminder a ist nicht mehr für heute geplant. In Erinnerungen steht sie weiter auf heute.')
      expect(lastToast().actions?.[0]?.label).toBe('Altes Datum zurück: 25.11.2026')
      expect(bridge.date).toBe(TODAY)
      expect(vi.mocked(adapter.update).mock.calls.length).toBe(writes)
    })

    it('a put-back while the plan\'s date write is in flight waits for it: Reminders ends up today, so the toast offers the old date', async () => {
      bridge.date = '2026-11-25'
      bridge.time = '09:00'
      const store = useTasksStore()
      store.setTasks([reminder('a', '2026-11-25', '09:00')])
      const sync = useTaskSync()
      const toasts = usePlanToasts()
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const real = vi.mocked(adapter.update).getMockImplementation()!
      // The adapter decided before its first await (the task was still planned), the bridge answers later
      vi.mocked(adapter.update).mockImplementationOnce(async (task: Task) => {
        const written = await real(task)
        await gate
        return written
      })
      sync.planTask('a')
      void toasts.afterPlan('a')
      expect(sync.unplanTask('a')).toBe(true)
      const done = toasts.afterPutBack('a')
      release()
      await done
      expect(bridge.date).toBe(TODAY)
      expect(lastToast().title).toBe('Reminder a ist nicht mehr für heute geplant. In Erinnerungen steht sie weiter auf heute.')
      expect(lastToast().actions?.[0]?.label).toBe('Altes Datum zurück: 25.11.2026')
      expect(toastAddMock.mock.calls.filter(call => (call[0] as ToastArgs).id === 'plan-a')).toEqual([])
    })

    it('tapping the offer writes the old date and leaves the task in "Meine Aufgaben"', async () => {
      const { store, sync, toasts } = await planned('2026-11-25')
      sync.unplanTask('a')
      await toasts.afterPutBack('a')
      lastToast().actions![0]!.onClick()
      await vi.waitFor(() => expect(bridge.date).toBe('2026-11-25'))
      expect(isNotPlanned(store.task('a')!)).toBe(true)
      expect(store.task('a')!.reminders?.wrote).toBeUndefined()
    })

    it('not tapped: the date stays today and the task stays put back', async () => {
      const { store, sync, toasts } = await planned('2026-11-25')
      sync.unplanTask('a')
      await toasts.afterPutBack('a')
      await vi.advanceTimersByTimeAsync(PLAN_TOAST_MS + 1000)
      expect(bridge.date).toBe(TODAY)
      expect(isNotPlanned(store.task('a')!)).toBe(true)
    })

    it('a reminder that had no date has nothing to restore: the toast has no action', async () => {
      const { sync, toasts } = await planned(null)
      sync.unplanTask('a')
      await toasts.afterPutBack('a')
      expect(lastToast().title).toContain('nicht mehr für heute geplant')
      expect(lastToast().actions).toBeUndefined()
    })

    it('no offer once Reminders holds another date than the one written; no toast when it does not say today', async () => {
      const { store, sync, toasts } = await planned('2026-11-25')
      sync.unplanTask('a')
      store.updateTask('a', { reminders: { ...store.task('a')!.reminders!, due: { date: '2026-12-24', time: null } } })
      await toasts.afterPutBack('a')
      expect(toastAddMock).not.toHaveBeenCalled()
    })

    it('a put-back of a task Kan-Do never wrote: the message without an offer', async () => {
      const store = useTasksStore()
      store.setTasks([reminder('b', TODAY, '09:00', { notPlanned: undefined, sourceNotPlanned: undefined })])
      const toasts = usePlanToasts()
      useTaskSync().unplanTask('b')
      await toasts.afterPutBack('b')
      expect(lastToast().title).toContain('In Erinnerungen steht sie weiter auf heute.')
      expect(lastToast().actions).toBeUndefined()
    })
  })
})
