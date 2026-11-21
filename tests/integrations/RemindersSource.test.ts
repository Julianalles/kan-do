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
  setDue: vi.fn(),
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
    remindersSetDue: bridge.setDue,
    remindersAvailable: bridge.available,
  }
})

/* eslint-disable import/first -- the mock must be registered before the adapter is imported */
import { RemindersError } from '~/lib/reminders'
import { RemindersReadOnlyError, RemindersSource, type RemindersSourceDeps } from '~/integrations/sources/RemindersSource'
import { SourceNotConfiguredError, type TaskSourceAdapter } from '~/integrations/sources/types'
import { classifySyncFailure, pushFailureScope } from '~/lib/integrationHealth'
import { reminderExternalId, splitExternalId, wroteOf, startOfLocalDay, type DoneOccurrence, type ReminderListRole } from '~/lib/remindersSource'
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
  const roles = opts.roles ?? { 'L-home': 'topic', 'L-work': 'topic', 'L-off': 'off' }
  const state = { ledger: { ...(opts.ledger ?? {}) }, access: null as string | null, changed: 0, begun: true }
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
    today: () => '2026-11-19',
    dayHasBegun: () => state.begun,
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
  it('maps the reminders of every list that is not Off: the list title is the topic (Thema), never an activity (#575)', async () => {
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
    expect(tasks[1]).toMatchObject({ topic: 'Arbeit', activity: null })
    expect(tasks[1]!.reminders?.recurrence).toBe('FREQ=WEEKLY')
    expect(tasks[2]).toMatchObject({ status: TaskStatus.Done })
    expect(tasks[2]!.completedAt).toEqual(new Date(NOON - 1000))
    // The date is the plan (#553): only the reminder dated today is delivered without a planning state; the marker is never a fetch's
    expect(tasks.map(t => t.sourceNotPlanned)).toEqual(['not-today', undefined, 'not-today'])
    expect(tasks.every(t => t.notPlanned === undefined)).toBe(true)
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

  it('writes nothing for a push of a Done task that was already Done, or whose previous status is unknown', async () => {
    const { source, state } = setup({ ledger: { 'ABC@2026-11-19': { completedAt: NOON } } })
    const done = heldTask('ABC@2026-11-19', { status: TaskStatus.Done })
    // A priority or time-box edit of a Done card, the "Gesehen" archive loop: no status change, no tick
    expect(await source.update(done, { previousStatus: TaskStatus.Done })).toBeNull()
    expect(await source.update(done)).toBeNull()
    expect(bridge.setCompleted).not.toHaveBeenCalled()
    expect(state.changed).toBe(0)
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

  it('a held legacy `activity` occurrence comes back with the list title as Thema and no activity (#575)', async () => {
    bridge.fetch.mockResolvedValue({
      reminders: [reminder({ id: 'ABC', listId: 'L-home', recurrence: { rule: 'FREQ=DAILY' }, due: { date: '2026-11-20', time: null } })],
      missingListIds: [],
    })
    const legacy = { ...ticked, topic: null, activity: 'Zuhause' } as Task
    const { source } = setup({ held: [legacy], ledger: { 'ABC@2026-11-19': { completedAt: NOON - 5000 } } })
    const kept = (await source.fetchActive()).find(t => t.externalId === 'ABC@2026-11-19')
    expect(kept).toMatchObject({ topic: 'Zuhause', activity: null, status: TaskStatus.Done, timeBoxSeconds: 1500 })
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

describe('the date is the plan (#553)', () => {
  const dated = (id: string, date: string | null, over: Partial<Reminder> = {}) =>
    reminder({ id, listId: 'L-home', due: date ? { date, time: null } : null, ...over })

  it('delivers no planning state for a reminder dated today once the day has begun, not-today for every other date', async () => {
    bridge.fetch.mockResolvedValue({ reminders: [dated('today', '2026-11-19'), dated('past', '2026-11-18'), dated('future', '2026-11-20'), dated('none', null)], missingListIds: [] })
    const { source } = setup()
    const tasks = await source.fetchActive()
    expect(Object.fromEntries(tasks.map(t => [t.externalId, t.sourceNotPlanned]))).toEqual({ today: undefined, past: 'not-today', future: 'not-today', none: 'not-today' })
    expect(source.planningByDate).toBe(true)
  })

  it('a reminder dated today waits for the day: before it has begun it is delivered as not-today', async () => {
    bridge.fetch.mockResolvedValue({ reminders: [dated('today', '2026-11-19')], missingListIds: [] })
    const { source, state } = setup()
    state.begun = false
    expect((await source.fetchActive())[0]!.sourceNotPlanned).toBe('not-today')
    state.begun = true
    expect((await source.fetchActive())[0]!.sourceNotPlanned).toBeUndefined()
  })

  it('a put-back held as "today" stays out of the board before the day has begun and after it (the day starting never undoes a put-back)', async () => {
    // The user put it back while Reminders said today (planningHeld: nothing held, notPlanned set)
    const held = heldTask('a', {
      notPlanned: true,
      reminders: { due: { date: '2026-11-19', time: null }, recurrence: null, listId: 'L-home' },
    })
    bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-11-19')], missingListIds: [] })
    const { source, state } = setup({ held: [held] })
    state.begun = false
    // Same answer as last time (no planning state held): the merge leaves the put-back alone, and the next fetch after the day began says the same
    expect((await source.fetchActive())[0]!.sourceNotPlanned).toBeUndefined()
    state.begun = true
    expect((await source.fetchActive())[0]!.sourceNotPlanned).toBeUndefined()
    // A task that is not held as put back still waits for the day, and one held as not-today stays that
    const { source: other, state: otherState } = setup({ held: [{ ...held, sourceNotPlanned: 'not-today' }] })
    otherState.begun = false
    expect((await other.fetchActive())[0]!.sourceNotPlanned).toBe('not-today')
  })

  it('planWrite: the day to write, only when the date is not today and the reminder does not repeat', () => {
    const { source } = setup()
    const base = heldTask('a', { reminders: { due: { date: '2026-11-25', time: null }, recurrence: null, listId: 'L-home' } })
    expect(source.planWrite(base)).toBe('2026-11-19')
    expect(source.planWrite({ ...base, reminders: { ...base.reminders!, due: null } })).toBe('2026-11-19')
    expect(source.planWrite({ ...base, reminders: { ...base.reminders!, due: { date: '2026-11-19', time: null } } })).toBeNull()
    expect(source.planWrite({ ...base, reminders: { ...base.reminders!, recurrence: 'FREQ=DAILY' } })).toBeNull()
  })

  it('planningHeld: not-today unless dated today, whether or not the day has begun (a put-back is never undone by the day starting)', () => {
    const { source, state } = setup()
    state.begun = false
    const at = (date: string | null) => heldTask('a', { reminders: { due: date ? { date, time: null } : null, recurrence: null, listId: 'L-home' } })
    expect(source.planningHeld(at('2026-11-19'))).toBeNull()
    expect(source.planningHeld(at('2026-11-20'))).toBe('not-today')
    expect(source.planningHeld(at(null))).toBe('not-today')
  })

  describe('update writes the date', () => {
    const planned = (over: Partial<Task> = {}, due: { date: string; time: string | null } | null = { date: '2026-11-25', time: '09:00' }): Task => heldTask('a', {
      pendingSync: { since: 1, attempts: 0, lastError: null, dateWrite: '2026-11-19' },
      reminders: { due, recurrence: null, listId: 'L-home' }, ...over,
    })

    it('today\'s date against the date kan-do holds; time stays; the result carries what was written', async () => {
      bridge.setDue.mockResolvedValue({ date: '2026-11-19', time: '09:00' })
      const { source } = setup()
      const result = await source.update(planned())
      expect(bridge.setDue).toHaveBeenCalledWith({ id: 'a', expectedDate: '2026-11-25', date: '2026-11-19', allowedListIds: ['L-home'] })
      expect(result?.reminders).toEqual({ due: { date: '2026-11-19', time: '09:00' }, recurrence: null, listId: 'L-home', wrote: { from: '2026-11-25', to: '2026-11-19', at: NOON } })
    })

    it('no date becomes today without a time: expectedDate null, wrote.from null', async () => {
      bridge.setDue.mockResolvedValue({ date: '2026-11-19', time: null })
      const result = await setup().source.update(planned({}, null))
      expect(bridge.setDue).toHaveBeenCalledWith(expect.objectContaining({ expectedDate: null, date: '2026-11-19' }))
      expect(result?.reminders?.wrote).toEqual({ from: null, to: '2026-11-19', at: NOON })
    })

    it('a past date is replaced too', async () => {
      bridge.setDue.mockResolvedValue({ date: '2026-11-19', time: null })
      const result = await setup().source.update(planned({}, { date: '2026-11-01', time: null }))
      expect(result?.reminders?.wrote?.from).toBe('2026-11-01')
    })

    it('writes nothing without the dateWrite flag: a push for another reason never writes a date', async () => {
      const { source } = setup()
      expect(await source.update(planned({ pendingSync: { since: 1, attempts: 0, lastError: null } }))).toBeNull()
      expect(bridge.setDue).not.toHaveBeenCalled()
    })

    it('writes nothing for a recurring reminder, a reminder already dated today, a task put back or not Open', async () => {
      const { source } = setup()
      expect(await source.update(planned({ reminders: { due: { date: '2026-11-25', time: null }, recurrence: 'FREQ=WEEKLY', listId: 'L-home' } }))).toBeNull()
      expect(await source.update(planned({}, { date: '2026-11-19', time: null }))).toBeNull()
      expect(await source.update(planned({ notPlanned: true }))).toBeNull()
      expect(await source.update(planned({ status: TaskStatus.Progress }))).toBeNull()
      expect(bridge.setDue).not.toHaveBeenCalled()
    })

    it('a write that failed on an earlier day is dropped, never replayed with today\'s date (the plan was made for that day)', async () => {
      const { source } = setup()
      const yesterday = { since: 1, attempts: 2, lastError: 'reminders: save-failed', dateWrite: '2026-11-18' as const }
      expect(await source.update(planned({ pendingSync: yesterday }))).toBeNull()
      // A marker written before the day was kept (`true`) never writes either
      expect(await source.update(planned({ pendingSync: { ...yesterday, dateWrite: true as never } }))).toBeNull()
      expect(bridge.setDue).not.toHaveBeenCalled()
    })

    it('a list switched to Off passes no list: the bridge refuses, the task stays as it is', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('not-read'))
      const { source } = setup({ roles: { 'L-home': 'off' } })
      expect(await source.update(planned())).toBeNull()
      expect(bridge.setDue).toHaveBeenCalledWith(expect.objectContaining({ allowedListIds: [] }))
    })

    it('changed: reads the reminder once; dated today now means no write at all', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('changed'))
      bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-11-19', { due: { date: '2026-11-19', time: '10:00' } })], missingListIds: [] })
      const result = await setup().source.update(planned())
      expect(bridge.setDue).toHaveBeenCalledTimes(1)
      expect(result?.reminders?.due).toEqual({ date: '2026-11-19', time: '10:00' })
      expect(result?.reminders?.wrote).toBeUndefined()
    })

    it('a reminder the user dated today in Reminders after the fetch records no wrote: nothing is written, so nothing is undone later', async () => {
      // The bridge answers `changed` (not a silent success) when the stored date is already the target and not the expected one
      bridge.setDue.mockRejectedValue(new RemindersError('changed'))
      bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-11-19', { due: { date: '2026-11-19', time: '07:00' } })], missingListIds: [] })
      const result = await setup().source.update(planned())
      expect(result?.reminders?.wrote).toBeUndefined()
      expect(result?.reminders?.due).toEqual({ date: '2026-11-19', time: '07:00' })
    })

    it('changed to another date: one more write against the fresh date, never a blind overwrite', async () => {
      bridge.setDue.mockRejectedValueOnce(new RemindersError('changed')).mockResolvedValueOnce({ date: '2026-11-19', time: null })
      bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-12-24')], missingListIds: [] })
      const result = await setup().source.update(planned())
      expect(bridge.setDue).toHaveBeenNthCalledWith(2, expect.objectContaining({ expectedDate: '2026-12-24', date: '2026-11-19' }))
      expect(result?.reminders?.wrote).toMatchObject({ from: '2026-12-24', to: '2026-11-19' })
    })

    it('changed twice: not chased, the task stays pending with the error', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('changed'))
      bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-12-24')], missingListIds: [] })
      await expect(setup().source.update(planned())).rejects.toMatchObject({ kind: 'changed' })
      expect(bridge.setDue).toHaveBeenCalledTimes(2)
    })

    it('a bridge failure rejects (the push marks the task and reports it)', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('save-failed'))
      await expect(setup().source.update(planned())).rejects.toMatchObject({ kind: 'save-failed' })
    })

    it('a reminder gone in Reminders is refused quietly', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('not-found'))
      expect(await setup().source.update(planned())).toBeNull()
    })
  })

  describe('restoreDueDate', () => {
    const wrote = (from: string | null) => heldTask('a', { reminders: { due: { date: '2026-11-19', time: '09:00' }, recurrence: null, listId: 'L-home', wrote: { from, to: '2026-11-19', at: NOON } } })

    it('compare-and-set against today, writing the old date; the result drops wrote', async () => {
      bridge.setDue.mockResolvedValue({ date: '2026-11-25', time: '09:00' })
      const result = await setup().source.restoreDueDate(wrote('2026-11-25'))
      expect(bridge.setDue).toHaveBeenCalledWith({ id: 'a', expectedDate: '2026-11-19', date: '2026-11-25', allowedListIds: ['L-home'] })
      expect(result?.reminders?.due).toEqual({ date: '2026-11-25', time: '09:00' })
      expect(result && wroteOf(result)).toBeNull()
    })

    it('a reminder that had no date gets it cleared (date null)', async () => {
      bridge.setDue.mockResolvedValue(null)
      const result = await setup().source.restoreDueDate(wrote(null))
      expect(bridge.setDue).toHaveBeenCalledWith(expect.objectContaining({ date: null }))
      expect(result?.reminders?.due).toBeNull()
    })

    it('without wrote it is a no-op success (an undo twice)', async () => {
      expect(await setup().source.restoreDueDate(heldTask('a'))).toBeNull()
      expect(bridge.setDue).not.toHaveBeenCalled()
    })

    it('Reminders moved on: the compare-and-set refuses and the error rejects', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('changed'))
      bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-12-24')], missingListIds: [] })
      await expect(setup().source.restoreDueDate(wrote('2026-11-25'))).rejects.toMatchObject({ kind: 'changed' })
    })

    it('Reminders already holds the old date (the user set it back there): that is restored, nothing to report', async () => {
      bridge.setDue.mockRejectedValue(new RemindersError('changed'))
      bridge.fetch.mockResolvedValue({ reminders: [dated('a', '2026-11-25', { due: { date: '2026-11-25', time: '09:00' } })], missingListIds: [] })
      const result = await setup().source.restoreDueDate(wrote('2026-11-25'))
      expect(result?.reminders?.due).toEqual({ date: '2026-11-25', time: '09:00' })
      expect(result && wroteOf(result)).toBeNull()
    })
  })

  it('wroteOf reads older data and malformed values as none', () => {
    expect(wroteOf({ reminders: undefined })).toBeNull()
    expect(wroteOf({ reminders: { due: null, recurrence: null, listId: 'L' } })).toBeNull()
    const bad = (wrote: unknown) => wroteOf({ reminders: { due: null, recurrence: null, listId: 'L', wrote: wrote as never } })
    expect(bad('x')).toBeNull()
    expect(bad({ from: 5, to: '2026-11-19', at: 1 })).toBeNull()
    expect(bad({ from: null, to: 3, at: 1 })).toBeNull()
    expect(bad({ from: null, to: '2026-11-19', at: Number.NaN })).toBeNull()
    expect(bad({ from: null, to: '2026-11-19', at: 5 })).toEqual({ from: null, to: '2026-11-19', at: 5 })
  })
})
