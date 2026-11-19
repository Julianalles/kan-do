/**
 * #552: the state of the Apple Reminders setup over the native bridge (`lib/reminders.ts`, mocked here): the access step
 * (never prompting by itself, granted, denied, a prompt that ends denied), the answers per list (Thema by default, all
 * Aus blocks the way on), Back writing nothing, and the connect at the last button: roles written and the source
 * connected beside Local, or everything put back (permission revoked between the steps, a first fetch that fails).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Reminder, ReminderList, RemindersAccessStatus } from '~/lib/reminders'

const bridge = vi.hoisted(() => ({
  status: vi.fn(),
  request: vi.fn(),
  lists: vi.fn(),
  fetch: vi.fn(),
  openSettings: vi.fn(),
}))

vi.mock('~/lib/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/reminders')>()
  return {
    ...actual,
    remindersAvailable: () => true,
    remindersAccessStatus: bridge.status,
    remindersRequestAccess: bridge.request,
    remindersLists: bridge.lists,
    remindersFetch: bridge.fetch,
    remindersOpenSettings: bridge.openSettings,
  }
})
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ recordTaskCompletion: vi.fn(), syncExistingDoneTasks: vi.fn(), openWorkSession: vi.fn(() => 0), extendWorkSession: vi.fn() }),
}))

/* eslint-disable import/first -- the mock must be registered before the composable is imported */
import { RemindersError } from '~/lib/reminders'
import { useRemindersSetup } from '~/composables/useRemindersSetup'
import { useBoardStore } from '~/store/board'
import { useRemindersConfigStore } from '~/store/remindersConfig'
import { useTasksStore } from '~/store/tasks'
/* eslint-enable import/first */

const LISTS: ReminderList[] = [
  { id: 'L-home', title: 'Zuhause', color: '#1c7ed6', openCount: 3, allowsWrites: true },
  { id: 'L-work', title: 'Arbeit', color: null, openCount: 8, allowsWrites: true },
]

const reminder = (over: Partial<Reminder> & Pick<Reminder, 'id' | 'listId'>): Reminder => ({
  title: `Reminder ${over.id}`, notes: '', completed: false, completedAt: null, due: null, recurrence: null, ...over,
})

/** A Mac that answers like macOS: `status` is the permission, the prompt answers `answer` */
function mac(status: RemindersAccessStatus, answer: RemindersAccessStatus = 'granted') {
  const state = { status }
  bridge.status.mockImplementation(async () => state.status)
  bridge.request.mockImplementation(async () => { state.status = answer; return state.status })
  bridge.lists.mockResolvedValue(LISTS)
  bridge.fetch.mockResolvedValue({ reminders: [reminder({ id: 'r1', listId: 'L-home' })], missingListIds: [] })
  return state
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('useRemindersSetup (#552)', () => {
  it('reading the permission never prompts; only "Zugriff erlauben" does, and a granted answer loads the lists', async () => {
    mac('notDetermined')
    const setup = useRemindersSetup({ firstRun: true })

    await setup.refreshAccess()
    expect(setup.access.value).toBe('idle')
    expect(bridge.request).not.toHaveBeenCalled()
    expect(setup.canProceed.value).toBe(false)

    await setup.requestAccess()
    expect(bridge.request).toHaveBeenCalledTimes(1)
    expect(setup.access.value).toBe('granted')
    expect(setup.listCount.value).toBe(2)
    expect(setup.canProceed.value).toBe(true)
  })

  it('a prompt answered "denied" shows the way out; "Erneut prüfen" reads the permission without asking again', async () => {
    const state = mac('notDetermined', 'denied')
    const setup = useRemindersSetup({ firstRun: true })

    await setup.requestAccess()
    expect(setup.access.value).toBe('denied')
    expect(setup.canProceed.value).toBe(false)

    state.status = 'granted' // allowed in System Settings meanwhile
    await setup.recheck()
    expect(bridge.request).toHaveBeenCalledTimes(1)
    expect(setup.access.value).toBe('granted')
    expect(setup.lists.value).toHaveLength(2)
  })

  it('restricted and write-only access read as denied (full access is needed)', async () => {
    for (const status of ['restricted', 'writeOnly'] as const) {
      mac(status)
      const setup = useRemindersSetup({ firstRun: true })
      await setup.refreshAccess()
      expect(setup.access.value).toBe('denied')
    }
  })

  it('every list reads Thema until answered; all Aus blocks "Weiter" and the connect; one list on is enough', async () => {
    mac('granted')
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    setup.next()
    expect(setup.step.value).toBe(1)
    expect(setup.roleOf('L-home')).toBe('topic')
    expect(setup.canProceed.value).toBe(true)

    setup.setRole('L-home', 'off')
    setup.setRole('L-work', 'off')
    expect(setup.allOff.value).toBe(true)
    expect(setup.canProceed.value).toBe(false)

    setup.setRole('L-work', 'activity')
    expect(setup.allOff.value).toBe(false)
    expect(setup.canProceed.value).toBe(true)
  })

  it('an account without lists blocks the way on with its own state, not the "all off" one', async () => {
    mac('granted')
    bridge.lists.mockResolvedValue([])
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    expect(setup.noLists.value).toBe(true)
    expect(setup.allOff.value).toBe(false)
    expect(setup.step.value).toBe(0)
    setup.next()
    expect(setup.step.value).toBe(1)
    expect(setup.canProceed.value).toBe(false)
  })

  it('Back at every step writes nothing: no roles, no connection, the board stays un-onboarded', async () => {
    mac('granted')
    const board = useBoardStore()
    const config = useRemindersConfigStore()
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    setup.next()
    setup.setRole('L-work', 'off')
    setup.next()
    expect(setup.step.value).toBe(2)

    expect(setup.back()).toBe(true)
    expect(setup.back()).toBe(true)
    expect(setup.back()).toBe(false) // the first step: the host leaves the flow

    expect(config.lists).toEqual({})
    expect(board.isOnboarded).toBe(false)
    expect(board.connectedIntegrations).toEqual([])
    expect(bridge.fetch).not.toHaveBeenCalled()
  })

  it('"Verbinden" (first run) writes the answered roles, onboards Local and connects Reminders beside it, never as the default', async () => {
    mac('granted')
    const board = useBoardStore()
    const config = useRemindersConfigStore()
    const tasks = useTasksStore()
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    setup.setRole('L-work', 'activity')

    expect(await setup.connect()).toBe('connected')

    expect(board.boardConfig.sources).toEqual({ connected: ['reminders'], default: 'local' })
    // The untouched list is written too: it reads Thema
    expect(config.lists).toEqual({ 'L-home': { role: 'topic', title: 'Zuhause' }, 'L-work': { role: 'activity', title: 'Arbeit' } })
    expect(bridge.fetch).toHaveBeenCalledTimes(1)
    expect(tasks.tasks.map((task) => [task.source, task.externalId])).toEqual([['reminders', 'r1']])
  })

  it('a list answered Aus is written as Aus and never passed to the fetch', async () => {
    mac('granted')
    const config = useRemindersConfigStore()
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    setup.setRole('L-work', 'off')

    expect(await setup.connect()).toBe('connected')

    expect(config.lists['L-work']).toEqual({ role: 'off', title: 'Arbeit' })
    expect(bridge.fetch.mock.calls[0]![0]).toEqual(['L-home'])
  })

  it('the permission revoked between the steps: nothing is written or connected, the flow returns to the access step as denied', async () => {
    const state = mac('granted')
    const board = useBoardStore()
    const config = useRemindersConfigStore()
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    setup.next()
    setup.next()

    state.status = 'denied'
    expect(await setup.connect()).toBe('denied')

    expect(setup.step.value).toBe(0)
    expect(setup.access.value).toBe('denied')
    expect(config.lists).toEqual({})
    expect(board.isOnboarded).toBe(false)
    expect(board.connectedIntegrations).toEqual([])
  })

  it('a first fetch that fails puts everything back: earlier answers, the connection and the never-onboarded state', async () => {
    mac('granted')
    const board = useBoardStore()
    const config = useRemindersConfigStore()
    config.setList('L-old', { role: 'activity', title: 'Alt' })
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    bridge.fetch.mockRejectedValue(new RemindersError('failed'))

    expect(await setup.connect()).toBe('failed')

    expect(setup.connectFailed.value).toBe(true)
    expect(board.connectedIntegrations).toEqual([])
    expect(board.isOnboarded).toBe(false)
    expect(config.lists).toEqual({ 'L-old': { role: 'activity', title: 'Alt' } })

    // And a retry after the cause is gone connects
    bridge.fetch.mockResolvedValue({ reminders: [], missingListIds: [] })
    expect(await setup.connect()).toBe('connected')
    expect(setup.connectFailed.value).toBe(false)
    expect(board.connectedIntegrations).toEqual(['reminders'])
  })

  it('from the settings page (not a first run) the board keeps its sources: Reminders joins them, a failure leaves them as they were', async () => {
    mac('granted')
    const board = useBoardStore()
    board.setSources({ connected: [], default: 'local' })
    const setup = useRemindersSetup({ firstRun: false })
    await setup.refreshAccess()

    bridge.fetch.mockRejectedValueOnce(new RemindersError('failed'))
    expect(await setup.connect()).toBe('failed')
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })

    expect(await setup.connect()).toBe('connected')
    expect(board.boardConfig.sources).toEqual({ connected: ['reminders'], default: 'local' })
  })

  it('lists that cannot be read after access is granted: the step says so and "Erneut versuchen" reads them again (#552 review)', async () => {
    mac('granted')
    bridge.lists.mockRejectedValueOnce(new RemindersError('failed'))
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()

    expect(setup.access.value).toBe('granted')
    expect(setup.listsFailed.value).toBe(true)
    expect(setup.lists.value).toBeNull()
    expect(setup.canProceed.value).toBe(false)

    await setup.loadLists()
    expect(setup.listsFailed.value).toBe(false)
    expect(setup.listCount.value).toBe(2)
    expect(setup.canProceed.value).toBe(true)
  })

  describe('run again while Reminders is already connected (#552 review)', () => {
    const connected = async () => {
      mac('granted')
      const board = useBoardStore()
      board.setSources({ connected: ['reminders'], default: 'local' })
      const config = useRemindersConfigStore()
      config.setLists({ 'L-home': { role: 'off', title: 'Zuhause' }, 'L-work': { role: 'activity', title: 'Arbeit' } })
      const setup = useRemindersSetup({ firstRun: false })
      await setup.refreshAccess()
      return { setup, config, tasks: useTasksStore() }
    }

    it('a list reads the answer the board already has, not Thema', async () => {
      const { setup } = await connected()
      expect(setup.roleOf('L-home')).toBe('off')
      expect(setup.roleOf('L-work')).toBe('activity')
      expect(setup.roleOf('L-new')).toBe('topic')
    })

    it('untouched answers survive the run; a list now Aus loses its tasks (archived ones too) and the source is fetched once', async () => {
      const { setup, config, tasks } = await connected()
      bridge.fetch.mockResolvedValue({ reminders: [reminder({ id: 'r1', listId: 'L-work' })], missingListIds: [] })
      tasks.mergeTasks('reminders', [
        { id: 'r-old', title: 'Alt', source: 'reminders', externalId: 'r-old', reminders: { listId: 'L-work' } } as never,
      ])
      setup.setRole('L-work', 'off')
      setup.setRole('L-home', 'topic')

      expect(await setup.connect()).toBe('connected')

      expect(config.lists).toEqual({ 'L-home': { role: 'topic', title: 'Zuhause' }, 'L-work': { role: 'off', title: 'Arbeit' } })
      expect(tasks.tasks.some((task) => task.reminders?.listId === 'L-work')).toBe(false)
      expect(bridge.fetch).toHaveBeenCalledTimes(1)
      expect(bridge.fetch.mock.calls[0]![0]).toEqual(['L-home'])
    })
  })

  it('a second "Verbinden" while the first runs does nothing', async () => {
    mac('granted')
    const setup = useRemindersSetup({ firstRun: true })
    await setup.refreshAccess()
    const first = setup.connect()
    expect(await setup.connect()).toBe('failed')
    expect(await first).toBe('connected')
    expect(bridge.fetch).toHaveBeenCalledTimes(1)
  })
})
