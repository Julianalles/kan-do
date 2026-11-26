/**
 * ADR 023: the bridge store hydrates tolerantly and additively. Nothing stored reads as off with an empty ledger, a malformed
 * value reads the same, and hydration writes nothing (#273).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

async function desktopPinia(stores: Record<string, unknown>) {
  vi.resetModules()
  ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  const { createFakeDataBackend } = await import('../helpers/fakeDataBackend')
  const { CURRENT_SCHEMA_VERSION } = await import('~/utils/dataFile/envelope')
  const backend = createFakeDataBackend({
    needsInit: false,
    envelope: { schemaVersion: CURRENT_SCHEMA_VERSION, writtenAt: '2026-01-01T00:00:00.000Z', writtenBy: 'd', appVersion: '0.1.0', stores },
  })
  const { createPinia, setActivePinia } = await import('pinia')
  const { createPersistedState } = await import('pinia-plugin-persistedstate')
  const { appStorage, initDataStorage } = await import('~/lib/dataStorage')
  await initDataStorage({ backend, source: null })
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: appStorage }))
  const { createApp } = await import('vue')
  createApp({}).use(pinia)
  setActivePinia(pinia)
  const { useRemoteBridgeStore } = await import('~/store/remoteBridge')
  return { backend, store: useRemoteBridgeStore() }
}

const sets = (calls: string[]) => calls.filter(c => c.startsWith('set:'))

describe('remote-bridge-store hydration', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

  it('nothing stored reads as off with an empty ledger and writes nothing', async () => {
    const { backend, store } = await desktopPinia({})
    await nextTick()
    expect(store.enabled).toBe(false)
    expect(store.applied).toEqual({})
    expect(sets(backend.calls)).toEqual([])
  })

  it('a stored value is kept and not written back', async () => {
    const { backend, store } = await desktopPinia({ 'remote-bridge-store': { enabled: true, applied: { c1: 1_700_000_000_000 } } })
    await nextTick()
    expect(store.enabled).toBe(true)
    expect(store.wasApplied('c1')).toBe(true)
    expect(store.wasApplied('c2')).toBe(false)
    expect(sets(backend.calls)).toEqual([])
  })

  it('a malformed value reads as off and empty in memory', async () => {
    const { store } = await desktopPinia({ 'remote-bridge-store': { enabled: 'yes', applied: { a: 'x', b: 5 } } })
    await nextTick()
    expect(store.enabled).toBe(false)
    expect(store.applied).toEqual({ b: 5 })
    const { store: other } = await desktopPinia({ 'remote-bridge-store': { enabled: true, applied: 'garbage' } })
    expect(other.applied).toEqual({})
    expect(other.wasApplied('toString')).toBe(false)
  })

  it('marking an id writes the store and prunes old entries', async () => {
    const { backend, store } = await desktopPinia({ 'remote-bridge-store': { applied: { old: 1000 } } })
    const now = Date.now()
    store.markApplied('fresh', now)
    await nextTick()
    expect(store.wasApplied('fresh')).toBe(true)
    expect(store.wasApplied('old')).toBe(false)
    expect(sets(backend.calls)).toContain('set:remote-bridge-store')
  })
})
