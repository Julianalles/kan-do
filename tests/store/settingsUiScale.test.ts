/**
 * #845: the size of the interface is an additive field of `settings-store`. Stored state from before it hydrates to
 * 100, a value that is no step reads as 100, hydrating writes nothing (#273), the setter persists and ignores non-steps.
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

const stored = (backing: Record<string, string>) => JSON.parse(backing['settings-store'] ?? '{}') as { uiScale?: unknown }

describe('settings-store uiScale (#845)', () => {
  it('is 100 when nothing is stored, and hydration writes nothing', async () => {
    const { store, writes } = hydrate(undefined)
    await nextTick()
    expect(store.uiScale).toBe(100)
    expect(writes).toEqual([])
  })

  it('is 100 for stored state from before the field, and the other settings load', async () => {
    const { store, writes } = hydrate({ focusEnabled: false, workingHoursMinutes: 240 })
    await nextTick()
    expect(store.uiScale).toBe(100)
    expect(store.focusEnabled).toBe(false)
    expect(store.workingHoursMinutes).toBe(240)
    expect(writes).toEqual([])
  })

  it.each([80, 90, 100, 110, 125])('keeps the valid stored step %i', (scale) => {
    expect(hydrate({ uiScale: scale }).store.uiScale).toBe(scale)
  })

  it.each([['a string', '110'], ['zero', 0], ['negative', -100], ['a step that does not exist', 150], ['fractional', 1.1], ['null', null], ['an object', {}], ['an array', [110]], ['a boolean', true]])(
    'reads %s as 100 without writing on hydrate',
    async (_name, bad) => {
      const { store, writes } = hydrate({ focusEnabled: true, uiScale: bad })
      await nextTick()
      expect(store.uiScale).toBe(100)
      expect(writes).toEqual([])
    },
  )

  it('persists the setter and survives a reload (A -> B -> A)', async () => {
    const { store, backing } = hydrate(undefined)
    store.setUiScale(125)
    await vi.waitFor(() => expect(stored(backing).uiScale).toBe(125))

    const reloaded = hydrate(undefined, backing).store
    expect(reloaded.uiScale).toBe(125)

    reloaded.setUiScale(100)
    await vi.waitFor(() => expect(stored(backing).uiScale).toBe(100))
    expect(hydrate(undefined, backing).store.uiScale).toBe(100)
  })

  it('ignores a value that is no step in the setter', () => {
    const { store } = hydrate(undefined)
    store.setUiScale(110)
    store.setUiScale(150)
    store.setUiScale(Number.NaN)
    expect(store.uiScale).toBe(110)
  })
})
