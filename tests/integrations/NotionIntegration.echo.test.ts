/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #770: an update does not write a cleared time box or an unset value-mode "unplanned" flag, so the page read after
 * the PATCH still holds the old value. That echo must not undo the user's edit (card menu "Timebox entfernen",
 * "Als geplant markieren"): the local value stays, a value the write did send is taken from the page as before.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn() }),
}))

// eslint-disable-next-line import/first -- order-sensitive: the mock comes first
import { NotionIntegration, resetStatusTypeCache } from '~/integrations/NotionIntegration'
// eslint-disable-next-line import/first -- order-sensitive: the mock comes first
import { TaskStatus } from '~/types/taskStatus'

const statusMapping = { today: 'Heute', doing: 'Jetzt', waiting: 'Wartet', done: 'Erledigt' }
const propertyMapping = {
  title: 'Name',
  status: 'Status',
  timeBox: 'Timebox',
  unplanned: { mode: 'value', valuePropertyName: 'Art', propertyType: 'select', matchValue: 'Ungeplant' },
}

/** A page holding a 15 min time box and the "Ungeplant" select; a written property replaces what it holds */
function stubPage() {
  const held: Record<string, unknown> = {
    Name: { title: [{ plain_text: 'T' }] },
    Status: { select: { name: statusMapping.today } },
    Timebox: { type: 'select', select: { name: '15' } },
    Art: { type: 'select', select: { name: 'Ungeplant' } },
  }
  const state = { patch: undefined as any }
  vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
    if (url.startsWith('/api/notion/database')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'db1', title: [{ plain_text: 'DB' }], properties: {} }) })
    if (url === '/api/notion/update-task') {
      state.patch = JSON.parse(init.body)
      Object.assign(held, state.patch.properties)
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'n1' }) })
    }
    if (url.startsWith('/api/notion/pages')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'n1', properties: held }) })
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  }))
  return state
}

const update = (fields: Record<string, unknown>) =>
  new NotionIntegration('tkn', 'db1', propertyMapping as any, statusMapping as any, undefined, 'ds-1')
    .updateTask({ id: 'n1', source: 'notion', externalId: 'n1', title: 'T', status: TaskStatus.Open, priority: 2, timerId: null, ...fields } as any)

beforeEach(() => resetStatusTypeCache())
afterEach(() => vi.unstubAllGlobals())

describe('NotionIntegration update echo (#770)', () => {
  it('a cleared time box stays cleared after the re-read', async () => {
    const state = stubPage()
    const synced = await update({ timeBoxSeconds: null, isUnplanned: true })
    expect(state.patch.properties.Timebox).toBeUndefined()
    expect(synced.timeBoxSeconds).toBeNull()
  })

  it('a time box the write sent is read back from the page', async () => {
    const state = stubPage()
    const synced = await update({ timeBoxSeconds: 1800, isUnplanned: true })
    expect(state.patch.properties.Timebox).toEqual({ select: { name: '30' } })
    expect(synced.timeBoxSeconds).toBe(1800)
  })

  it('an unset value-mode "unplanned" flag stays unset after the re-read', async () => {
    const state = stubPage()
    const synced = await update({ timeBoxSeconds: 900, isUnplanned: false })
    expect(state.patch.properties.Art).toBeUndefined()
    expect(synced.isUnplanned).toBe(false)
  })

  it('a set flag is read back from the page', async () => {
    stubPage()
    expect((await update({ timeBoxSeconds: 900, isUnplanned: true })).isUnplanned).toBe(true)
  })
})
