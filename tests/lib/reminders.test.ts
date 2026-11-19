import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

const reminders = await import('~/lib/reminders')

const setDesktop = (on: boolean) => {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
}

beforeEach(() => {
  invoke.mockReset()
  setDesktop(true)
})
afterEach(() => setDesktop(false))

describe('reminders wrapper on the web', () => {
  it('answers unsupported for every call without touching Tauri', async () => {
    setDesktop(false)
    const calls = [
      reminders.remindersAccessStatus(),
      reminders.remindersRequestAccess(),
      reminders.remindersLists(),
      reminders.remindersFetch(['l'], 0),
      reminders.remindersSetDue({ id: 'r', expectedDate: null, date: '2026-11-20', allowedListIds: ['l'] }),
      reminders.remindersSetCompleted({ id: 'r', completed: true, allowedListIds: ['l'] }),
      reminders.remindersOpenSettings(),
    ]
    for (const call of calls) await expect(call).rejects.toMatchObject({ name: 'RemindersError', kind: 'unsupported' })
    expect(invoke).not.toHaveBeenCalled()
    expect(reminders.remindersAvailable()).toBe(false)
  })
})

describe('reminders wrapper on the desktop', () => {
  it('passes each call to its command with the contract arguments', async () => {
    invoke.mockResolvedValue(null)
    await reminders.remindersAccessStatus()
    await reminders.remindersRequestAccess()
    await reminders.remindersLists()
    await reminders.remindersFetch(['a', 'b'], 1_700_000_000_000)
    await reminders.remindersSetDue({ id: 'r', expectedDate: '2026-11-20', date: '2026-11-21', allowedListIds: ['a'] })
    await reminders.remindersSetDue({ id: 'r', expectedDate: '2026-11-21', date: null, allowedListIds: ['a'] })
    await reminders.remindersSetCompleted({ id: 'r', completed: true, occurrenceDate: '2026-11-20', allowedListIds: ['a'] })
    await reminders.remindersSetCompleted({ id: 'r', completed: false, allowedListIds: ['a'] })
    await reminders.remindersOpenSettings()
    expect(invoke.mock.calls).toEqual([
      ['reminders_access_status', undefined],
      ['reminders_request_access', undefined],
      ['reminders_lists', undefined],
      ['reminders_fetch', { listIds: ['a', 'b'], completedSince: 1_700_000_000_000 }],
      ['reminders_set_due', { id: 'r', expectedDate: '2026-11-20', date: '2026-11-21', allowedListIds: ['a'] }],
      ['reminders_set_due', { id: 'r', expectedDate: '2026-11-21', date: null, allowedListIds: ['a'] }],
      ['reminders_set_completed', { id: 'r', completed: true, occurrenceDate: '2026-11-20', allowedListIds: ['a'] }],
      ['reminders_set_completed', { id: 'r', completed: false, occurrenceDate: null, allowedListIds: ['a'] }],
      ['reminders_open_settings', undefined],
    ])
    expect(reminders.remindersAvailable()).toBe(true)
  })

  it('returns what Rust answers', async () => {
    invoke.mockResolvedValueOnce('denied')
    expect(await reminders.remindersAccessStatus()).toBe('denied')
    invoke.mockResolvedValueOnce({ completed: false, due: { date: '2026-11-27', time: '09:00' } })
    expect(await reminders.remindersSetCompleted({ id: 'r', completed: true, allowedListIds: ['a'] }))
      .toEqual({ completed: false, due: { date: '2026-11-27', time: '09:00' } })
  })

  it.each(reminders.REMINDERS_ERROR_NAMES)('maps the Rust error "%s" to a typed error', async (name) => {
    invoke.mockRejectedValueOnce(name)
    await expect(reminders.remindersLists()).rejects.toMatchObject({ name: 'RemindersError', kind: name })
  })

  it('maps anything else to failed, never forwarding platform text', async () => {
    for (const rejected of ['EKErrorDomain 3 secret text', { kind: 'nope' }, new Error('boom'), null, undefined]) {
      invoke.mockRejectedValueOnce(rejected)
      const error = await reminders.remindersLists().catch(e => e)
      expect(error).toBeInstanceOf(reminders.RemindersError)
      expect(error.kind).toBe('failed')
      expect(error.message).toBe('reminders: failed')
    }
  })

  it('reads a { kind } object too', () => {
    expect(reminders.toRemindersError({ kind: 'changed' }).kind).toBe('changed')
  })
})
