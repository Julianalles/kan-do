/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #780: the user's "Timebox entfernen" and "Als geplant markieren" reach Notion. `updateTask` writes the clear only for a
 * field the push carries in `clears` (the user emptied it), and only while the task still has it empty; any other push
 * leaves a value the task lacks alone (one kan-do could not read, or one set in Notion since the last fetch).
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

type Held = Record<string, unknown>

/**
 * A page and its data source schema; a written property replaces what the page holds. `schema` null: the schema read
 * fails, so the property's type is unknown.
 */
function stubNotion(held: Held, schema: Record<string, string> | null) {
  const state = { patch: undefined as any }
  vi.stubGlobal('fetch', vi.fn((url: string, init?: any) => {
    if (url.startsWith('/api/notion/data-sources?id=')) {
      if (!schema) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'down' }) })
      const properties = Object.fromEntries(Object.entries(schema).map(([name, type]) => [name, { type }]))
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'ds-1', properties }) })
    }
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

const basePage = (): Held => ({
  Name: { type: 'title', title: [{ plain_text: 'T' }] },
  Status: { type: 'select', select: { name: statusMapping.today } },
})

function integration(mapping: Record<string, unknown>) {
  return new NotionIntegration('tkn', 'db1', { title: 'Name', status: 'Status', ...mapping } as any, statusMapping as any, undefined, 'ds-1')
}

const task = (fields: Record<string, unknown>) =>
  ({ id: 'n1', source: 'notion', externalId: 'n1', title: 'T', status: TaskStatus.Open, priority: 2, timerId: null, timeBoxSeconds: null, isUnplanned: false, ...fields }) as any

beforeEach(() => resetStatusTypeCache())
afterEach(() => vi.unstubAllGlobals())

describe('NotionIntegration time box clear (#780)', () => {
  it('a formatted select time box the user removed is emptied, and reads back empty', async () => {
    const held = { ...basePage(), Timebox: { type: 'select', select: { name: '15' } } }
    const state = stubNotion(held, { Timebox: 'select' })
    const synced = await integration({ timeBox: 'Timebox' }).updateTask(task({}), { clears: ['timeBox'] })
    expect(state.patch.properties.Timebox).toEqual({ select: null })
    expect(synced.timeBoxSeconds).toBeNull()
  })

  it('a number time box is emptied with a null number', async () => {
    const held = { ...basePage(), Timebox: { type: 'number', number: 30 } }
    const state = stubNotion(held, { Timebox: 'number' })
    await integration({ timeBox: 'Timebox', timeBoxUnit: 'minutes' }).updateTask(task({}), { clears: ['timeBox'] })
    expect(state.patch.properties.Timebox).toEqual({ number: null })
  })

  it('a rich text time box is emptied with an empty text', async () => {
    const held = { ...basePage(), Timebox: { type: 'rich_text', rich_text: [{ plain_text: '15 min' }] } }
    const state = stubNotion(held, { Timebox: 'rich_text' })
    await integration({ timeBox: 'Timebox' }).updateTask(task({}), { clears: ['timeBox'] })
    expect(state.patch.properties.Timebox).toEqual({ rich_text: [] })
  })

  it('unknown property type: the shape the set path writes for the unit', async () => {
    const state = stubNotion({ ...basePage(), Timebox: { number: 2 } }, null)
    await integration({ timeBox: 'Timebox', timeBoxUnit: 'hours' }).updateTask(task({}), { clears: ['timeBox'] })
    expect(state.patch.properties.Timebox).toEqual({ number: null })
  })

  it('a type that cannot be emptied (formula) is left alone', async () => {
    const state = stubNotion({ ...basePage(), Timebox: { type: 'formula', formula: { number: 15 } } }, { Timebox: 'formula' })
    await integration({ timeBox: 'Timebox' }).updateTask(task({}), { clears: ['timeBox'] })
    expect(state.patch.properties).not.toHaveProperty('Timebox')
  })

  it('regression: a push without the clear never empties the time box, also one kan-do cannot read', async () => {
    const held = { ...basePage(), Timebox: { type: 'select', select: { name: 'irgendwann' } } }
    const state = stubNotion(held, { Timebox: 'select' })
    await integration({ timeBox: 'Timebox' }).updateTask(task({ status: TaskStatus.Progress }))
    expect(state.patch.properties).not.toHaveProperty('Timebox')
    expect(held.Timebox).toEqual({ type: 'select', select: { name: 'irgendwann' } })
  })

  it('a time box set again after the clear is written, never the clear', async () => {
    const state = stubNotion({ ...basePage(), Timebox: { type: 'select', select: { name: '15' } } }, { Timebox: 'select' })
    await integration({ timeBox: 'Timebox' }).updateTask(task({ timeBoxSeconds: 2700 }), { clears: ['timeBox'] })
    expect(state.patch.properties.Timebox).toEqual({ select: { name: '45' } })
  })
})

describe('NotionIntegration value-mode "unplanned" clear (#780)', () => {
  const mapping = (propertyType: string) => ({ unplanned: { mode: 'value', valuePropertyName: 'Art', propertyType, matchValue: 'Ungeplant' } })

  it('a select holding the match value is emptied and the task reads as planned', async () => {
    const held = { ...basePage(), Art: { type: 'select', select: { name: 'ungeplant' } } }
    const state = stubNotion(held, { Art: 'select' })
    const synced = await integration(mapping('select')).updateTask(task({}), { clears: ['unplanned'] })
    expect(state.patch.properties.Art).toEqual({ select: null })
    expect(synced.isUnplanned).toBe(false)
  })

  it('a select holding another value is left alone', async () => {
    const state = stubNotion({ ...basePage(), Art: { type: 'select', select: { name: 'Meeting' } } }, { Art: 'select' })
    await integration(mapping('select')).updateTask(task({}), { clears: ['unplanned'] })
    expect(state.patch.properties).not.toHaveProperty('Art')
  })

  it('a multi_select loses only the match value', async () => {
    const held = { ...basePage(), Art: { type: 'multi_select', multi_select: [{ name: 'Kunde' }, { name: 'UNGEPLANT' }, { name: 'Intern' }] } }
    const state = stubNotion(held, { Art: 'multi_select' })
    const synced = await integration(mapping('multi_select')).updateTask(task({}), { clears: ['unplanned'] })
    expect(state.patch.properties.Art).toEqual({ multi_select: [{ name: 'Kunde' }, { name: 'Intern' }] })
    expect(synced.isUnplanned).toBe(false)
  })

  it('a text that is exactly the match value is emptied', async () => {
    const held = { ...basePage(), Art: { type: 'rich_text', rich_text: [{ plain_text: ' Ungeplant ' }] } }
    const state = stubNotion(held, { Art: 'rich_text' })
    await integration(mapping('rich_text')).updateTask(task({}), { clears: ['unplanned'] })
    expect(state.patch.properties.Art).toEqual({ rich_text: [] })
  })

  it('accepted trade-off: a text holding more than the match value is not rewritten', async () => {
    const held = { ...basePage(), Art: { type: 'rich_text', rich_text: [{ plain_text: 'ungeplant, Anruf vom Chef' }] } }
    const state = stubNotion(held, { Art: 'rich_text' })
    await integration(mapping('rich_text')).updateTask(task({}), { clears: ['unplanned'] })
    expect(state.patch.properties).not.toHaveProperty('Art')
  })

  it('regression: a push without the clear never removes the match value', async () => {
    const held = { ...basePage(), Art: { type: 'multi_select', multi_select: [{ name: 'Ungeplant' }, { name: 'Kunde' }] } }
    const state = stubNotion(held, { Art: 'multi_select' })
    await integration(mapping('multi_select')).updateTask(task({ status: TaskStatus.Progress }))
    expect(state.patch.properties).not.toHaveProperty('Art')
    expect((held.Art as any).multi_select).toHaveLength(2)
  })

  it('a flag set again after the clear writes the match value, never the clear', async () => {
    const state = stubNotion({ ...basePage(), Art: { type: 'select', select: null } }, { Art: 'select' })
    await integration(mapping('select')).updateTask(task({ isUnplanned: true }), { clears: ['unplanned'] })
    expect(state.patch.properties.Art).toEqual({ select: { name: 'Ungeplant' } })
  })

  it('boolean mode writes the checkbox as before', async () => {
    const state = stubNotion({ ...basePage(), Ad: { type: 'checkbox', checkbox: true } }, { Ad: 'checkbox' })
    await integration({ unplanned: { mode: 'boolean', propertyName: 'Ad' } }).updateTask(task({}), { clears: ['unplanned'] })
    expect(state.patch.properties.Ad).toEqual({ checkbox: false })
  })
})
