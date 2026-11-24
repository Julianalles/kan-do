/**
 * #800: the intro hints' record is an additive field of `settings-store`. Stored state from before it hydrates to
 * `null` (no hints for an existing install), a malformed value reads as `null`, hydrating writes nothing (#273), and
 * the actions persist and survive a reload.
 */
import { describe, it, expect, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { useSettingsStore } from '~/store/settings'

function hydrate(stored: unknown, backing: Record<string, string> = {}) {
  const writes: string[] = []
  if (stored !== undefined) backing['settings-store'] = JSON.stringify(stored)
  const storage = {
    getItem: (key: string) => backing[key] ?? null,
    setItem: (key: string, value: string) => { writes.push(key); backing[key] = value },
    removeItem: (key: string) => { Reflect.deleteProperty(backing, key) },
  }
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { store: useSettingsStore(), writes, backing }
}

const stored = (backing: Record<string, string>) => JSON.parse(backing['settings-store'] ?? '{}').introHints

describe('settings-store introHints (#800)', () => {
  it('is null when nothing is stored, and hydration writes nothing', async () => {
    const { store, writes } = hydrate(undefined)
    await nextTick()
    expect(store.introHints).toBeNull()
    expect(writes).toEqual([])
  })

  it('is null for stored state from before the field (every existing install), the other fields intact', async () => {
    const { store, writes } = hydrate({ focusEnabled: false, workingHoursMinutes: 240 })
    await nextTick()
    expect(store.introHints).toBeNull()
    expect(store.focusEnabled).toBe(false)
    expect(store.workingHoursMinutes).toBe(240)
    expect(writes).toEqual([])
  })

  it.each([['a string', 'on'], ['a number', 1], ['an array', []], ['a record without on', { hints: {} }]])(
    'reads %s as null without writing on hydrate',
    async (_name, bad) => {
      const { store, writes } = hydrate({ focusEnabled: true, introHints: bad })
      await nextTick()
      expect(store.introHints).toBeNull()
      expect(writes).toEqual([])
    },
  )

  it('drops a malformed hint entry in memory and keeps the rest, without a write', async () => {
    const { store, writes } = hydrate({ introHints: { on: true, quietDay: null, hints: { start: { answered: true, days: [] }, bad: 3 } } })
    await nextTick()
    expect(store.introHints).toEqual({ on: true, quietDay: null, hints: { start: { answered: true, days: [] } } })
    expect(writes).toEqual([])
  })

  it('does nothing before the hints started: no action creates the record', () => {
    const { store } = hydrate(undefined)
    store.markIntroHintShown('start', '2026-11-24')
    store.answerIntroHint('start')
    store.closeIntroHint('start', '2026-11-24')
    expect(store.introHints).toBeNull()
  })

  it('start -> shown -> reload -> shown again the same day writes the day once', async () => {
    const { store, backing } = hydrate(undefined)
    store.startIntroHints()
    store.markIntroHintShown('start', '2026-11-24')
    await vi.waitFor(() => expect(stored(backing)?.hints.start.days).toEqual(['2026-11-24']))
    const reloaded = hydrate(undefined, backing)
    const before = reloaded.store.introHints
    reloaded.store.markIntroHintShown('start', '2026-11-24')
    expect(reloaded.store.introHints).toBe(before)
    reloaded.store.markIntroHintShown('start', '2026-11-25')
    expect(reloaded.store.introHints?.hints.start?.days).toEqual(['2026-11-24', '2026-11-25'])
  })

  it('stores at most three days', () => {
    const { store } = hydrate(undefined)
    store.startIntroHints()
    for (const day of ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']) store.markIntroHintShown('start', day)
    expect(store.introHints?.hints.start?.days).toEqual(['2026-11-21', '2026-11-22', '2026-11-23'])
  })

  it('a second start keeps the record: an answered hint stays answered', () => {
    const { store } = hydrate(undefined)
    store.startIntroHints()
    store.answerIntroHint('start')
    store.startIntroHints()
    expect(store.introHints?.hints.start?.answered).toBe(true)
  })

  it('"Schließen" answers the hint and sets the quiet day; both survive a reload', async () => {
    const { store, backing } = hydrate(undefined)
    store.startIntroHints()
    store.closeIntroHint('start', '2026-11-24')
    await vi.waitFor(() => expect(stored(backing)?.quietDay).toBe('2026-11-24'))
    const reloaded = hydrate(undefined, backing)
    expect(reloaded.store.introHints).toEqual({ on: true, quietDay: '2026-11-24', hints: { start: { answered: true, days: [] } } })
  })

  it('answering an unshown hint ends it (the step was done while the hint was not on screen)', () => {
    const { store } = hydrate(undefined)
    store.startIntroHints()
    store.answerIntroHint('start')
    expect(store.introHints).toEqual({ on: true, quietDay: null, hints: { start: { answered: true, days: [] } } })
  })
})
