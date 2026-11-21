/**
 * #551: `remindersConfig` (the per-list answers and the done-occurrence ledger) is additive and tolerant: nothing stored
 * means no lists, a malformed role reads as Thema, a malformed ledger entry is dropped, hydrating writes nothing (#273).
 * #575: the role `activity` of an older app version still loads, as Thema.
 */
import { describe, it, expect } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { createApp } from 'vue'
import { useRemindersConfigStore } from '~/store/remindersConfig'
import { PERSISTED_KEYS } from '~/lib/dataStorage'
import { startOfLocalDay } from '~/lib/remindersSource'

function hydrate(stored: unknown) {
  const writes: string[] = []
  const storage = {
    getItem: (key: string) => (key === 'remindersConfig' && stored !== undefined ? JSON.stringify(stored) : null),
    setItem: (key: string) => { writes.push(key) },
    removeItem: () => {},
  }
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return { store: useRemindersConfigStore(), writes }
}

describe('remindersConfig hydration (#551)', () => {
  it('is a persisted key', () => {
    expect(PERSISTED_KEYS).toContain('remindersConfig')
  })

  it('nothing stored: no lists, an empty ledger, and nothing is written', () => {
    const { store, writes } = hydrate(undefined)
    expect(store.lists).toEqual({})
    expect(store.doneOccurrences).toEqual({})
    expect(store.roleOf('any-list')).toBe('topic')
    expect(writes).toEqual([])
  })

  it('keeps stored roles and ledger entries', () => {
    const { store, writes } = hydrate({
      lists: { a: { role: 'topic', title: 'Arbeit' }, b: { role: 'off', title: 'Privat' } },
      doneOccurrences: { 'x@2026-11-19': { completedAt: 1000 } },
    })
    expect(store.roleOf('a')).toBe('topic')
    expect(store.roleOf('b')).toBe('off')
    expect(store.doneOccurrences).toEqual({ 'x@2026-11-19': { completedAt: 1000 } })
    expect(writes).toEqual([])
  })

  it('a list an older version stored as Aktivität reads as Thema (still read, title kept), and hydrating writes nothing (#575)', () => {
    const { store, writes } = hydrate({
      lists: { a: { role: 'activity', title: 'Arbeit' }, b: { role: 'off', title: 'Privat' } },
    })
    expect(store.roleOf('a')).toBe('topic')
    expect(store.lists['a']).toEqual({ role: 'topic', title: 'Arbeit' })
    expect(store.roleOf('b')).toBe('off')
    expect(writes).toEqual([])
  })

  it('a malformed role reads as topic in memory, a malformed entry is dropped, nothing is written', () => {
    const { store, writes } = hydrate({
      lists: { a: { role: 'banana', title: 'A' }, b: null, c: 'x', d: { title: 'No role' } },
      doneOccurrences: { ok: { completedAt: 5 }, bad: { completedAt: 'soon' }, worse: null, nan: { completedAt: null } },
    })
    expect(store.roleOf('a')).toBe('topic')
    expect(store.roleOf('d')).toBe('topic')
    expect(Object.keys(store.lists).sort()).toEqual(['a', 'd'])
    expect(store.doneOccurrences).toEqual({ ok: { completedAt: 5 } })
    expect(writes).toEqual([])
  })

  it.each([null, 'x', 7, [1, 2]])('a wrongly shaped lists / doneOccurrences (%j) falls back to empty', (shape) => {
    const { store, writes } = hydrate({ lists: shape, doneOccurrences: shape })
    expect(store.lists).toEqual({})
    expect(store.doneOccurrences).toEqual({})
    expect(writes).toEqual([])
  })
})

describe('remindersConfig actions', () => {
  it('prunes the ledger at local midnight and never stores the permission', () => {
    const { store } = hydrate(undefined)
    const now = new Date(2026, 10, 19, 12).getTime()
    store.recordDoneOccurrence('today', now - 1000)
    store.recordDoneOccurrence('yesterday', startOfLocalDay(now) - 1)
    store.pruneDoneOccurrences(now)
    expect(Object.keys(store.doneOccurrences)).toEqual(['today'])
    store.dropDoneOccurrence('today')
    store.dropDoneOccurrence('never-there')
    expect(store.doneOccurrences).toEqual({})
    store.setAccessStatus('granted')
    expect(store.accessStatus).toBe('granted')
  })
})
