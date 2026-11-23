/**
 * #746: the automatic update check setting is an additive field of `settings-store`. Stored state from before it hydrates
 * to on, a malformed value reads as on, hydrating writes nothing (#273), the setter persists and survives a reload.
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

describe('settings-store autoUpdateCheck (#746)', () => {
  it('is on when nothing is stored, and hydration writes nothing', async () => {
    const { store, writes } = hydrate(undefined)
    await nextTick()
    expect(store.autoUpdateCheck).toBe(true)
    expect(writes).toEqual([])
  })

  it('is on for stored state from before the field (every existing install), the other fields intact', async () => {
    const { store, writes } = hydrate({ focusEnabled: false, workingHoursMinutes: 240 })
    await nextTick()
    expect(store.autoUpdateCheck).toBe(true)
    expect(store.focusEnabled).toBe(false)
    expect(store.workingHoursMinutes).toBe(240)
    expect(writes).toEqual([])
  })

  it('keeps a stored off', async () => {
    const { store, writes } = hydrate({ autoUpdateCheck: false })
    await nextTick()
    expect(store.autoUpdateCheck).toBe(false)
    expect(writes).toEqual([])
  })

  it.each([['a string', 'false'], ['zero', 0], ['null', null], ['an object', {}], ['an array', [false]]])(
    'reads %s as on without writing on hydrate',
    async (_name, bad) => {
      const { store, writes } = hydrate({ focusEnabled: true, autoUpdateCheck: bad })
      await nextTick()
      expect(store.autoUpdateCheck).toBe(true)
      expect(writes).toEqual([])
    },
  )

  it('persists the setter and survives a reload (on -> off -> reload -> on)', async () => {
    const { store, backing } = hydrate(undefined)
    store.setAutoUpdateCheck(false)
    await vi.waitFor(() => expect(JSON.parse(backing['settings-store'] ?? '{}').autoUpdateCheck).toBe(false))
    const reloaded = hydrate(undefined, backing)
    expect(reloaded.store.autoUpdateCheck).toBe(false)
    reloaded.store.setAutoUpdateCheck(true)
    await vi.waitFor(() => expect(JSON.parse(backing['settings-store'] ?? '{}').autoUpdateCheck).toBe(true))
    expect(hydrate(undefined, backing).store.autoUpdateCheck).toBe(true)
  })
})
