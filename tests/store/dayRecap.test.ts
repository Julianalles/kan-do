import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { useDayRecapStore } from '~/store/dayRecap'

function freshPinia() {
  const pinia = createPinia()
  pinia.use(createPersistedState({ storage: localStorage }))
  createApp({}).use(pinia)
  setActivePinia(pinia)
}

describe('day recap store', () => {
  beforeEach(() => {
    localStorage.clear()
    freshPinia()
  })

  it('starts with no marker and the switch on, and writes nothing at hydration', async () => {
    const store = useDayRecapStore()
    await nextTick()
    expect(store.lastShownDay).toBeNull()
    expect(store.archiveDone).toBe(true)
    expect(localStorage.getItem('day-recap-store')).toBeNull()
  })

  it('markShown only moves forward', () => {
    const store = useDayRecapStore()
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
    store.markShown('2026-10-20')
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
    store.markShown('2026-10-23')
    expect(store.lastShownDay).toBe('2026-10-23')
  })

  describe('the new day\'s pass (#356)', () => {
    it('starts without a pass, a group or a note', () => {
      const store = useDayRecapStore()
      expect(store.validLastNewDay).toBeNull()
      expect(store.validSentBack).toBeNull()
      expect(store.validFirstBackDay).toBeNull()
      expect(store.backNoteClosed).toBe(false)
    })

    it('markNewDay only moves forward and replaces the group', () => {
      const store = useDayRecapStore()
      expect(store.markNewDay('2026-10-22', ['a', 'b'])).toBe(true)
      expect(store.markNewDay('2026-10-22', ['c'])).toBe(false)
      expect(store.markNewDay('2026-10-21', ['c'])).toBe(false)
      expect(store.markNewDay('garbage', ['c'])).toBe(false)
      expect(store.sentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
      expect(store.markNewDay('2026-10-23', [])).toBe(true)
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: [] })
    })

    it('remembers the first day cards were sent back, once: a baseline or an empty pass does not count', () => {
      const store = useDayRecapStore()
      store.markNewDay('2026-10-21', [])
      expect(store.firstBackDay).toBeNull()
      store.markNewDay('2026-10-22', ['a'])
      store.closeBackNote()
      store.markNewDay('2026-10-23', ['a'])
      expect(store.firstBackDay).toBe('2026-10-22')
      expect(store.backNoteClosed).toBe(true)
    })

    it('data stored before #356 loads as "no pass yet, no group" and keeps its recap marker; nothing is written at hydration', async () => {
      localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', archiveDone: false, closedTaskIds: ['x'] }))
      const before = localStorage.getItem('day-recap-store')
      freshPinia()
      const store = useDayRecapStore()
      await nextTick()
      expect(store.validLastShownDay).toBe('2026-10-21')
      expect(store.archiveDone).toBe(false)
      expect(store.validLastNewDay).toBeNull()
      expect(store.validSentBack).toBeNull()
      expect(store.validFirstBackDay).toBeNull()
      expect(localStorage.getItem('day-recap-store')).toBe(before)
    })

    it('malformed stored values read as "no pass yet, no group" and are not written back', async () => {
      for (const bad of [
        { lastNewDay: 42, sentBack: 'yes', firstBackDay: {} },
        { lastNewDay: '22.10.2026', sentBack: { day: 'x', ids: ['a'] }, firstBackDay: 'soon' },
        { lastNewDay: null, sentBack: { day: '2026-10-22', ids: 'a' }, firstBackDay: null },
        { lastNewDay: [], sentBack: ['a'], firstBackDay: 1 },
      ]) {
        localStorage.setItem('day-recap-store', JSON.stringify(bad))
        const before = localStorage.getItem('day-recap-store')
        freshPinia()
        const store = useDayRecapStore()
        await nextTick()
        expect(store.validLastNewDay).toBeNull()
        expect(store.validSentBack).toBeNull()
        expect(store.validFirstBackDay).toBeNull()
        expect(localStorage.getItem('day-recap-store')).toBe(before)
      }
    })

    it('drops ids that are not strings from a stored group', () => {
      const store = useDayRecapStore()
      store.sentBack = { day: '2026-10-22', ids: ['a', 3, null, 'b'] as never }
      expect(store.validSentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
    })

    it('persists the pass, the group and the note across a restart', async () => {
      const store = useDayRecapStore()
      store.markNewDay('2026-10-22', ['a', 'b'])
      store.closeBackNote()
      await nextTick()
      freshPinia()
      const again = useDayRecapStore()
      expect(again.validLastNewDay).toBe('2026-10-22')
      expect(again.validSentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
      expect(again.validFirstBackDay).toBe('2026-10-22')
      expect(again.backNoteClosed).toBe(true)
    })
  })

  it('ignores a malformed key', () => {
    const store = useDayRecapStore()
    store.markShown('yesterday')
    expect(store.lastShownDay).toBeNull()
  })

  it('reads a malformed stored marker as null and replaces it on the next markShown', () => {
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: 'garbage', archiveDone: false }))
    freshPinia()
    const store = useDayRecapStore()
    expect(store.archiveDone).toBe(false)
    expect(store.validLastShownDay).toBeNull()
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
  })

  it('persists the marker and the switch under day-recap-store', async () => {
    const store = useDayRecapStore()
    store.markShown('2026-10-22')
    store.setArchiveDone(false)
    await nextTick()
    expect(JSON.parse(localStorage.getItem('day-recap-store') as string)).toMatchObject({ lastShownDay: '2026-10-22', archiveDone: false, closedTaskIds: [] })
  })

  it('restores both after a reload', () => {
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', archiveDone: false }))
    freshPinia()
    const store = useDayRecapStore()
    expect(store.lastShownDay).toBe('2026-10-21')
    expect(store.archiveDone).toBe(false)
  })

  it('hydrates closedTaskIds as an empty list without the field and ignores a wrongly shaped one', () => {
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', archiveDone: true }))
    freshPinia()
    expect(useDayRecapStore().closedTaskIds).toEqual([])
    expect(useDayRecapStore().validClosedTaskIds).toEqual([])

    for (const bad of [null, 'abc', { a: 1 }, 7]) {
      localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', closedTaskIds: bad }))
      freshPinia()
      const store = useDayRecapStore()
      expect(store.validClosedTaskIds).toEqual([])
      store.rememberClosed(['a'])
      expect(store.closedTaskIds).toEqual(['a'])
    }
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', closedTaskIds: ['a', 5, null, 'b'] }))
    freshPinia()
    expect(useDayRecapStore().validClosedTaskIds).toEqual(['a', 'b'])
  })
})
