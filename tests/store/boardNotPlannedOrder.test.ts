/**
 * The order of "Nicht geplant" (#354): `board-store.notPlannedOrder`, an additive persisted field. Data stored
 * before it loads unchanged, a malformed value reads as empty, and hydration never writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { sanitizeNotPlannedOrder, useBoardStore } from '~/store/board'

const sources = { boardConfig: { sources: { connected: [], default: 'local' } } }

function hydrate(stored: unknown) {
  if (stored !== undefined) localStorage.setItem('board-store', JSON.stringify(stored))
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
  return useBoardStore()
}

describe('board store: notPlannedOrder (#354)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('data stored before #354 hydrates to an empty order and keeps its columns', () => {
    const store = hydrate({ ...sources, focus: null })
    expect(store.notPlannedOrder).toEqual([])
    expect(store.columns).toHaveLength(4)
  })

  it('a stored order survives a reload', async () => {
    const first = hydrate(sources)
    first.noteNotPlanned('a')
    first.noteNotPlanned('b')
    await nextTick()
    expect(JSON.parse(localStorage.getItem('board-store') ?? '{}').notPlannedOrder).toEqual(['b', 'a'])
    expect(hydrate(undefined).notPlannedOrder).toEqual(['b', 'a'])
  })

  it.each([
    ['null', null],
    ['a string', 'a,b'],
    ['an object', { a: 1 }],
    ['a number', 3],
  ])('%s hydrates to an empty order without throwing', (_label, notPlannedOrder) => {
    expect(hydrate({ ...sources, notPlannedOrder }).notPlannedOrder).toEqual([])
  })

  it('leaves out entries that are not ids, and repeats', () => {
    expect(sanitizeNotPlannedOrder(['a', 1, null, '', 'b', 'a'])).toEqual(['a', 'b'])
  })

  it('hydration alone writes nothing back, also for a malformed order', () => {
    localStorage.setItem('board-store', JSON.stringify({ ...sources, notPlannedOrder: 'broken' }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    hydrate(undefined)
    expect(setItem).not.toHaveBeenCalled()
  })
})
