/**
 * #551: the Apple Reminders task source over the native bridge (`lib/reminders.ts`, mocked here): identity of one-off
 * and recurring reminders (E2), list roles, the done tick both ways with its `occurrenceDate`, the answers of the bridge
 * (`changed`, `not-read`, `access-denied`, `unsupported`) and the done-occurrence ledger.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import type { Reminder, ReminderList } from '~/lib/reminders'

const bridge = vi.hoisted(() => ({
  status: vi.fn(),
  lists: vi.fn(),
  fetch: vi.fn(),
  setCompleted: vi.fn(),
  available: vi.fn(() => true),
}))

vi.mock('~/lib/reminders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/lib/reminders')>()
  return {
    ...actual,
    remindersAccessStatus: bridge.status,
    remindersLists: bridge.lists,
    remindersFetch: bridge.fetch,
    remindersSetCompleted: bridge.setCompleted,
    remindersAvailable: bridge.available,
  }
})

/* eslint-disable import/first -- the mock must be registered before the adapter is imported */
import { RemindersError } from '~/lib/reminders'
import { RemindersReadOnlyError, RemindersSource, type RemindersSourceDeps } from '~/integrations/sources/RemindersSource'
import { SourceNotConfiguredError, type TaskSourceAdapter } from '~/integrations/sources/types'
import { classifySyncFailure, pushFailureScope } from '~/lib/integrationHealth'
import { reminderExternalId, splitExternalId, startOfLocalDay, type DoneOccurrence, type ReminderListRole } from '~/lib/remindersSource'
/* eslint-enable import/first */

const NOON = new Date(2026, 10, 19, 12, 0, 0).getTime()
const MIDNIGHT = startOfLocalDay(NOON)

const lists: ReminderList[] = [
  { id: 'L-home', title: 'Zuhause', color: null, openCount: 1, allowsWrites: true },
  { id: 'L-work', title: 'Arbeit', color: null, openCount: 1, allowsWrites: true },
  { id: 'L-off', title: 'Privat', color: null, openCount: 1, allowsWrites: true },
]

const reminder = (over: Partial<Reminder> & Pick<Reminder, 'id' | 'listId'>): Reminder => ({
  title: `Reminder ${over.id}`, notes: '', completed: false, completedAt: null, due: null, recurrence: null, ...over,
})

function setup(opts: { roles?: Record<string, ReminderListRole>; held?: Task[]; ledger?: Record<string, DoneOccurrence> } = {}) {
  const roles = opts.roles ?? { 'L-home': 'topic', 'L-work': 'activity', 'L-off': 'off' }
  const state = { ledger: { ...(opts.ledger ?? {}) }, access: null as string | null, changed: 0 }
  const deps: RemindersSourceDeps = {
    roleOf: id => roles[id] ?? 'topic',
    heldTasks: () => opts.held ?? [],
    accessStatus: () => state.access as never,
    setAccessStatus: (status) => { state.access = status },
    ledger: () => state.ledger,
    recordDone: (id, at) => { state.ledger = { ...state.ledger, [id]: { completedAt: at } } },
    dropDone: (id) => { const { [id]: _gone, ...rest } = state.ledger; state.ledger = rest },
    pruneLedger: (now) => {
      const start = startOfLocalDay(now)
      state.ledger = Object.fromEntries(Object.entries(state.ledger).filter(([, entry]) => entry.completedAt >= start))
    },
    health: () => 'healthy',
    now: () => NOON,
    onChanged: () => { state.changed++ },
  }
  return { source: new RemindersSource(deps), state }
}

const heldTask = (externalId: string, over: Partial<Task> = {}): Task => ({
  id: externalId, source: 'reminders', externalId, title: 'Held', status: TaskStatus.Open, activity: null, topic: 'Zuhause', topicColorCode: null,
  priority: 2, notes: null, timeBoxSeconds: 1500, timeSpentSeconds: 0, timerId: null,
  reminders: { due: { date: '2026-11-19', time: null }, recurrence: 'FREQ=DAILY', listId: 'L-home' }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  bridge.available.mockReturnValue(true)
  bridge.status.mockResolvedValue('granted')
  bridge.lists.mockResolvedValue(lists)
  bridge.fetch.mockResolvedValue({ reminders: [], missingListIds: [] })
  bridge.setCompleted.mockResolvedValue({ completed: true, due: null })
})

describe('identity (E2)', () => {
  it('a one-off reminder is its calendarItemIdentifier, a recurring one carries the date of its occurrence', () => {
    expect(reminderExternalId({ id: 'ABC', due: { date: '2026-11-19', time: null }, recurrence: null })).toBe('ABC')
    expect(reminderExternalId({ id: 'ABC', due: { date: '2026-11-19', time: '09:00' }, recurrence: { rule: 'FREQ=DAILY' } })).toBe('ABC@2026-11-19')
    expect(reminderExternalId({ id: 'ABC', due: null, recurrence: { rule: 'FREQ=DAILY' } })).toBe('ABC')
  })

  it('strips the suffix for a write and hands the occurrence date on', () => {
    expect(splitExternalId('ABC@2026-11-19')).toEqual({ id: 'ABC', occurrenceDate: '2026-11-19' })
    expect(splitExternalId('ABC')).toEqual({ id: 'ABC', occurrenceDate: null })
  })
})

describe('fetchActive', () => {
  it('maps the reminders of every list that is not Off: list title is the topic (Thema) or the activity (Aktivität)', async () => {
    bridge.fetch.mockResolvedValue({
      reminders: [
        reminder({ id: 'a', listId: 'L-home', title: 'Milch', notes: 'Hafer', due: { date: '2026-11-20', time: '08:30' } }),
        reminder({ id: 'b', listId: 'L-work', title: 'Bericht', recurrence: { rule: 'FREQ=WEEKLY' }, due: { date: '2026-11-19', time: null } }),
        reminder({ id: 'c', listId: 'L-home', title: 'Erledigt', completed: true, completedAt: NOON - 1000 }),
      ],
      missingListIds: [],
    })
    const { source, state } = setup()
    const tasks = await source.fetchActive()

    // Only the lists that are not Off reach the bridge, completed since the start of today
    expect(bridge.fetch).toHaveBeenCalledWith(['L-home', 'L-work'], MIDNIGHT)
    expect(state.access).toBe('granted')
    expect(tasks.map(t => t.externalId)).toEqual(['a', 'b@2026-11-19', 'c'])
    expect(tasks[0]).toMatchObject({ source: 'reminders', title: 'Milch', notes: 'Hafer', topic: 'Zuhause', activity: null, status: TaskStatus.Open })
    expect(tasks[0]!.reminders).toEqual({ due: { date: '2026-11-20', time: '08:30' }, recurrence: null, listId: 'L-home' })
    expect(tasks[1]).toMatchObject({ topic: null, activity: 'Arbeit' })
    expect(tasks[1]!.reminders?.recurrence).toBe('FREQ=WEEKLY')
    expect(tasks[2]).toMatchObject({ status: TaskStatus.Done })
    expect(tasks[2]!.completedAt).toEqual(new Date(NOON - 1000))
    // A fetched task starts without a planning state (slice 4 decides by date)
    expect(tasks.every(t => t.notPlanned === undefined && t.sourceNotPlanned === undefined)).toBe(true)
  })

  it('a list created in Reminders later reads as Thema; a list set to Off is never passed to the bridge', async () => {
    const { source } = setup({ roles: { 'L-off': 'off' } })
    await source.fetchActive()
    expect(bridge.fetch).toHaveBeenCalledWith(['L-home', 'L-work'], MIDNIGHT)
  })

  it('fetches nothing when every list is Off', async () => {
    const { source } = setup({ roles: { 'L-home': 'off', 'L-work': 'off', 'L-off': 'off' } })
    expect(await source.fetchActive()).toEqual([])
    expect(bridge.fetch).not.toHaveBeenCalled()
  })

  it.each(['denied', 'restricted', 'writeOnly', 'notDetermined'] as const)('access %s rejects as access-denied: the source is broken, not just failing', async (status) => {
    bridge.status.mockResolvedValue(status)
    const { source } = setup()
    const error = await source.fetchActive().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RemindersError)
    expect((error as RemindersError).kind).toBe('access-denied')
    expect(classifySyncFailure(error)).toBe('broken')
    expect(pushFailureScope(error)).toBe('source')
    expect(bridge.lists).not.toHaveBeenCalled()
  })

  it('on the web (unsupported) the source is not configured: broken until reconnected on a Mac', async () => {
    bridge.available.mockReturnValue(false)
    bridge.status.mockRejectedValue(new RemindersError('unsupported'))
    const { source } = setup()
    expect(source.isConfigured()).toBe(false)
    const error = await source.fetchActive().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SourceNotConfiguredError)
    expect(classifySyncFailure(error)).toBe('broken')
  })

  it('isConfigured follows the permission the last call saw (desktop only)', async () => {
    const { source } = setup()
    expect(source.isConfigured()).toBe(false)
    await source.fetchActive()
    expect(source.isConfigured()).toBe(true)
  })

  it('another bridge failure is a degraded source, not a broken one', async () => {
    bridge.lists.mockRejectedValue(new RemindersError('failed'))
    const { source } = setup()
    expect(classifySyncFailure(await source.fetchActive().catch((e: unknown) => e))).toBe('degraded')
  })
})

describe('update (the done tick)', () => {
  it('ticks a one-off reminder with the due date it holds', async () => {
    const { source } = setup()
    const task = heldTask('a', { status: TaskStatus.Done, reminders: { due: { date: '2026-11-19', time: null }, recurrence: null, listId: 'L-home' } })
    expect(await source.update(task, { previousStatus: TaskStatus.Open })).toBeNull()
    expect(bridge.setCompleted).toHaveBeenCalledWith({ id: 'a', completed: true, occurrenceDate: '2026-11-19', allowedListIds: ['L-home'] })
  })

  it('strips the suffix of a recurring occurrence and passes its date as occurrenceDate', async () => {
    const { source, state } = setup()
    await source.update(heldTask('ABC@2026-11-19', { status: TaskStatus.Done }), { previousStatus: TaskStatus.Open })
    expect(bridge.setCompleted).toHaveBeenCalledWith({ id: 'ABC', completed: true, occurrenceDate: '2026-11-19', allowedListIds: ['L-home'] })
    // The done occurrence stays visible for the rest of the day
    expect(state.ledger['ABC@2026-11-19']).toEqual({ completedAt: NOON })
  })

  it('reopens a task that was Done (and drops its ledger entry); a Jetzt or Wartet move writes nothing', async () => {
    const { source, state } = setup({ ledger: { 'ABC@2026-11-19': { completedAt: NOON } } })
    await source.update(heldTask('ABC@2026-11-19', { status: TaskStatus.Open }), { previousStatus: TaskStatus.Done })
    expect(bridge.setCompleted).toHaveBeenCalledWith(expect.objectContaining({ completed: false }))
    expect(state.ledger).toEqual({})

    bridge.setCompleted.mockClear()
    expect(await source.update(heldTask('x', { status: TaskStatus.Progress }), { previousStatus: TaskStatus.Open })).toBeNull()
    expect(await source.update(heldTask('x', { status: TaskStatus.Waiting }), { previousStatus: TaskStatus.Progress })).toBeNull()
    expect(bridge.setCompleted).not.toHaveBeenCalled()
  })

  it('`changed` is no failure: nothing is written, one quiet refetch is asked for', async () => {
    bridge.setCompleted.mockRejectedValue(new RemindersError('changed'))
    const { source, state } = setup()
    await expect(source.update(heldTask('ABC@2026-11-19', { status: TaskStatus.Done }), { previousStatus: TaskStatus.Open })).resolves.toBeNull()
    expect(state.changed).toBe(1)
    expect(state.ledger).toEqual({})
  })

  it('a list switched off while the tick was queued is refused by the bridge: the task stays, the source stays healthy', async () => {
    bridge.setCompleted.mockRejectedValue(new RemindersError('not-read'))
    const { source } = setup({ roles: { 'L-home': 'off' } })
    await expect(source.update(heldTask('a', { status: TaskStatus.Done }), { previousStatus: TaskStatus.Open })).resolves.toBeNull()
    // No list is passed for it, so the bridge answers not-read
    expect(bridge.setCompleted).toHaveBeenCalledWith(expect.objectContaining({ allowedListIds: [] }))
  })

  it('revoked access on a write is the source\'s fault; any other bridge failure stays the task\'s', async () => {
    const { source } = setup()
    bridge.setCompleted.mockRejectedValue(new RemindersError('access-denied'))
    const denied = await source.update(heldTask('a', { status: TaskStatus.Done }), { previousStatus: TaskStatus.Open }).catch((e: unknown) => e)
    expect(pushFailureScope(denied)).toBe('source')
    bridge.setCompleted.mockRejectedValue(new RemindersError('save-failed'))
    const failed = await source.update(heldTask('a', { status: TaskStatus.Done }), { previousStatus: TaskStatus.Open }).catch((e: unknown) => e)
    expect(pushFailureScope(failed)).toBe('task')
  })
})

describe('read-only', () => {
  it('create, remove and restore reject with the typed error; the adapter says what the UI must not offer', async () => {
    const { source } = setup()
    await expect(source.create()).rejects.toBeInstanceOf(RemindersReadOnlyError)
    await expect(source.remove()).rejects.toBeInstanceOf(RemindersReadOnlyError)
    await expect(source.restore()).rejects.toBeInstanceOf(RemindersReadOnlyError)
    expect(source.capabilities).toEqual({ create: false, remove: false, moveOut: false, editText: false })
    expect(source.holdsOnlyOpenDone).toBe(true)
    expect(source.syncsTime).toBe(false)
    expect(source.archivesAsStatus()).toBe(false)
    // The planning hooks stay absent until slice 4: a new Reminders task starts Offen on the board
    const adapter: TaskSourceAdapter = source
    expect(adapter.notPlannedHold).toBeUndefined()
    expect(adapter.startsNotPlanned).toBeUndefined()
  })
})

describe('done-occurrence ledger (E2)', () => {
  const ticked = heldTask('ABC@2026-11-19', { status: TaskStatus.Done, completedAt: new Date(NOON - 5000) })

  it('keeps the ticked occurrence as a Done card built from the held task while Reminders shows the next date', async () => {
    bridge.fetch.mockResolvedValue({
      reminders: [reminder({ id: 'ABC', listId: 'L-home', recurrence: { rule: 'FREQ=DAILY' }, due: { date: '2026-11-20', time: null } })],
      missingListIds: [],
    })
    const { source } = setup({ held: [ticked], ledger: { 'ABC@2026-11-19': { completedAt: NOON - 5000 } } })
    const tasks = await source.fetchActive()
    expect(tasks.map(t => [t.externalId, t.status])).toEqual([['ABC@2026-11-20', TaskStatus.Open], ['ABC@2026-11-19', TaskStatus.Done]])
    // Built from the held task: kan-do's own fields come along
    expect(tasks[1]).toMatchObject({ timeBoxSeconds: 1500, priority: 2 })
    expect(tasks[1]!.completedAt).toEqual(new Date(NOON - 5000))
  })

  it('is pruned at local midnight', async () => {
    const yesterday = MIDNIGHT - 60_000
    const { source, state } = setup({ held: [ticked], ledger: { 'ABC@2026-11-19': { completedAt: yesterday } } })
    expect(await source.fetchActive()).toEqual([])
    expect(state.ledger).toEqual({})
  })

  it('drops the entry when the fetch returns the completed occurrence itself (the fetched one wins)', async () => {
    bridge.fetch.mockResolvedValue({
      reminders: [reminder({ id: 'ABC', listId: 'L-home', recurrence: { rule: 'FREQ=DAILY' }, due: { date: '2026-11-19', time: null }, completed: true, completedAt: NOON - 3000 })],
      missingListIds: [],
    })
    const { source, state } = setup({ held: [ticked], ledger: { 'ABC@2026-11-19': { completedAt: NOON - 5000 } } })
    const tasks = await source.fetchActive()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ externalId: 'ABC@2026-11-19', status: TaskStatus.Done })
    expect(tasks[0]!.completedAt).toEqual(new Date(NOON - 3000))
    expect(state.ledger).toEqual({})
  })

  it('an occurrence done in Reminders itself (held, gone, the reminder shows a later date) joins the ledger', async () => {
    bridge.fetch.mockResolvedValue({
      reminders: [reminder({ id: 'ABC', listId: 'L-home', recurrence: { rule: 'FREQ=DAILY' }, due: { date: '2026-11-20', time: null } })],
      missingListIds: [],
    })
    const open = heldTask('ABC@2026-11-19')
    const { source, state } = setup({ held: [open] })
    const tasks = await source.fetchActive()
    expect(state.ledger['ABC@2026-11-19']).toEqual({ completedAt: NOON })
    expect(tasks.find(t => t.externalId === 'ABC@2026-11-19')).toMatchObject({ status: TaskStatus.Done })
  })

  it('an occurrence that is gone without a later date of its reminder is not kept (deleted in Reminders)', async () => {
    const { source, state } = setup({ held: [heldTask('ABC@2026-11-19')] })
    expect(await source.fetchActive()).toEqual([])
    expect(state.ledger).toEqual({})
  })

  it('does not keep an occurrence whose list was switched off since', async () => {
    const { source, state } = setup({ roles: { 'L-home': 'off' }, held: [ticked], ledger: { 'ABC@2026-11-19': { completedAt: NOON - 5000 } } })
    expect(await source.fetchActive()).toEqual([])
    expect(state.ledger).toEqual({})
  })
})
