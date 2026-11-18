import { beforeEach, describe, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { sanitizeSentBack, useDayRecapStore } from '~/store/dayRecap'

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

  it('starts with no marker and writes nothing at hydration', async () => {
    const store = useDayRecapStore()
    await nextTick()
    expect(store.lastShownDay).toBeNull()
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

  describe('the fresh start and its day (#356, #387)', () => {
    it('starts without a start, a group, a closed notice or a question', () => {
      const store = useDayRecapStore()
      expect(store.validLastNewDay).toBeNull()
      expect(store.validSentBack).toBeNull()
      expect(store.validNoticeClosedDay).toBeNull()
      expect(store.validTimeOffer).toBeNull()
    })

    it('markNewDay only moves forward and replaces the group: a second start the same day changes nothing', () => {
      const store = useDayRecapStore()
      expect(store.markNewDay('2026-10-22', ['a', 'b'])).toBe(true)
      expect(store.markNewDay('2026-10-22', ['c'])).toBe(false)
      expect(store.markNewDay('2026-10-21', ['c'])).toBe(false)
      expect(store.markNewDay('garbage', ['c'])).toBe(false)
      expect(store.sentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
      expect(store.markNewDay('2026-10-23', [])).toBe(true)
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: [] })
    })

    it('markDayClosed (#480) starts tomorrow: the marker and the group move to the next day, a second close the same evening adds its ids in front', () => {
      const store = useDayRecapStore()
      store.markNewDay('2026-10-22', [])
      expect(store.markDayClosed('2026-10-23', ['a', 'b'])).toBe(true)
      expect(store.validLastNewDay).toBe('2026-10-23')
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: ['a', 'b'] })
      // the same evening again, after planning one task from "Alle" and closing once more
      expect(store.markDayClosed('2026-10-23', ['c', 'a'])).toBe(true)
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: ['c', 'a', 'b'] })
      // a later day replaces the group, as any start does
      expect(store.markDayClosed('2026-10-24', ['d'])).toBe(true)
      expect(store.sentBack).toEqual({ day: '2026-10-24', ids: ['d'] })
    })

    it('markDayClosed keeps the Wartet ids the close took off apart from the group; a second close adds to them, none writes no field, a stored `waiting` is sanitized', () => {
      const store = useDayRecapStore()
      expect(store.markDayClosed('2026-10-23', ['a'], ['w1'])).toBe(true)
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: ['a'], waiting: ['w1'] })
      store.markDayClosed('2026-10-23', ['b'], ['w2', 'w1'])
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: ['b', 'a'], waiting: ['w2', 'w1'] })
      store.markDayClosed('2026-10-24', ['c'])
      expect(store.sentBack).toEqual({ day: '2026-10-24', ids: ['c'] })
      expect(store.sentBack).not.toHaveProperty('waiting')
      expect(sanitizeSentBack({ day: '2026-10-24', ids: [], waiting: ['x', 3, null] })).toEqual({ day: '2026-10-24', ids: [], waiting: ['x'] })
      expect(sanitizeSentBack({ day: '2026-10-24', ids: [], waiting: 'x' })).toEqual({ day: '2026-10-24', ids: [] })
    })

    it('markDayClosed writes nothing for a day before the stored marker (clock set back) or a malformed day', () => {
      const store = useDayRecapStore()
      store.markDayClosed('2026-10-23', ['a'])
      expect(store.markDayClosed('2026-10-22', ['b'])).toBe(false)
      expect(store.markDayClosed('soon', ['b'])).toBe(false)
      expect(store.validLastNewDay).toBe('2026-10-23')
      expect(store.sentBack).toEqual({ day: '2026-10-23', ids: ['a'] })
    })

    it('a stored marker one day ahead (after a close) loads as it is', async () => {
      localStorage.setItem('day-recap-store', JSON.stringify({ lastNewDay: '2026-10-23', sentBack: { day: '2026-10-23', ids: ['a'] } }))
      freshPinia()
      const store = useDayRecapStore()
      await nextTick()
      expect(store.validLastNewDay).toBe('2026-10-23')
      expect(store.validSentBack).toEqual({ day: '2026-10-23', ids: ['a'] })
    })

    it('the closed notice is remembered per day; a malformed day is ignored', async () => {
      const store = useDayRecapStore()
      store.closeNotice('soon')
      expect(store.validNoticeClosedDay).toBeNull()
      store.closeNotice('2026-10-22')
      expect(store.validNoticeClosedDay).toBe('2026-10-22')
      await nextTick()
      freshPinia()
      expect(useDayRecapStore().validNoticeClosedDay).toBe('2026-10-22')
    })

    it('data stored before #356 loads as "no start yet, no group" and keeps its recap marker; nothing is written at hydration', async () => {
      localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', archiveDone: false, closedTaskIds: ['x'] }))
      const before = localStorage.getItem('day-recap-store')
      freshPinia()
      const store = useDayRecapStore()
      await nextTick()
      expect(store.validLastShownDay).toBe('2026-10-21')
      expect(store.validLastNewDay).toBeNull()
      expect(store.validSentBack).toBeNull()
      expect(store.validNoticeClosedDay).toBeNull()
      expect(localStorage.getItem('day-recap-store')).toBe(before)
    })

    it('data stored by #356 (the automatic pass, its one-time note) loads: the day, the group and the question stay, the note\'s fields are ignored, nothing is written at hydration', async () => {
      const offer = { taskId: 'a', day: '2026-10-22', seconds: 900, spans: [] }
      localStorage.setItem('day-recap-store', JSON.stringify({
        lastShownDay: '2026-10-22', archiveDone: true, closedTaskIds: [], lastNewDay: '2026-10-22',
        sentBack: { day: '2026-10-22', ids: ['a', 'b'] }, firstBackDay: '2026-10-22', backNoteClosed: true, timeOffer: offer,
      }))
      const before = localStorage.getItem('day-recap-store')
      freshPinia()
      const store = useDayRecapStore()
      await nextTick()
      expect(store.validLastNewDay).toBe('2026-10-22')
      expect(store.validSentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
      expect(store.validTimeOffer).toEqual(offer)
      expect(store.validNoticeClosedDay).toBeNull()
      expect(localStorage.getItem('day-recap-store')).toBe(before)
      // the next write keeps what the store still owns and drops the two fields of the note
      store.closeNotice('2026-10-23')
      await nextTick()
      const written = JSON.parse(localStorage.getItem('day-recap-store') as string)
      expect(written).toMatchObject({ lastNewDay: '2026-10-22', sentBack: { day: '2026-10-22', ids: ['a', 'b'] }, noticeClosedDay: '2026-10-23' })
      expect(written).not.toHaveProperty('firstBackDay')
      expect(written).not.toHaveProperty('backNoteClosed')
    })

    it('malformed stored values read as "no start yet, no group, not closed" and are not written back', async () => {
      for (const bad of [
        { lastNewDay: 42, sentBack: 'yes', noticeClosedDay: {} },
        { lastNewDay: '22.10.2026', sentBack: { day: 'x', ids: ['a'] }, noticeClosedDay: 'soon' },
        { lastNewDay: null, sentBack: { day: '2026-10-22', ids: 'a' }, noticeClosedDay: null },
        { lastNewDay: [], sentBack: ['a'], noticeClosedDay: 1 },
      ]) {
        localStorage.setItem('day-recap-store', JSON.stringify(bad))
        const before = localStorage.getItem('day-recap-store')
        freshPinia()
        const store = useDayRecapStore()
        await nextTick()
        expect(store.validLastNewDay).toBeNull()
        expect(store.validSentBack).toBeNull()
        expect(store.validNoticeClosedDay).toBeNull()
        expect(localStorage.getItem('day-recap-store')).toBe(before)
      }
    })

    it('drops ids that are not strings from a stored group', () => {
      const store = useDayRecapStore()
      store.sentBack = { day: '2026-10-22', ids: ['a', 3, null, 'b'] as never }
      expect(store.validSentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
    })

    describe('the question about time after midnight (the user\'s decision of 2026-11-16)', () => {
      const offer = { taskId: 'a', day: '2026-10-22', seconds: 900, spans: [[new Date(2026, 9, 22, 0, 5).getTime(), new Date(2026, 9, 22, 0, 20).getTime()] as [number, number]] }

      it('is stored by the day check, replaced by a later one and cleared by the answer; a fresh start leaves it alone', () => {
        const store = useDayRecapStore()
        expect(store.validTimeOffer).toBeNull()
        store.offerTime(offer)
        expect(store.validTimeOffer).toEqual(offer)
        store.markNewDay('2026-10-22', ['a'])
        expect(store.validTimeOffer).toEqual(offer)
        store.resolveTimeOffer()
        expect(store.validTimeOffer).toBeNull()
        store.offerTime(offer)
        store.offerTime({ ...offer, day: '2026-10-23', seconds: 120 })
        expect(store.validTimeOffer).toMatchObject({ day: '2026-10-23', seconds: 120 })
      })

      it('a malformed or empty count is never stored as a question', () => {
        const store = useDayRecapStore()
        store.offerTime({ ...offer, seconds: 0 })
        store.offerTime({ ...offer, day: 'x' })
        store.offerTime('yes' as never)
        expect(store.timeOffer).toBeNull()
      })

      it('the stored question is a copy: the caller\'s spans are not shared', () => {
        const store = useDayRecapStore()
        store.offerTime(offer)
        expect(store.timeOffer!.spans).not.toBe(offer.spans)
        expect(store.timeOffer!.spans[0]).not.toBe(offer.spans[0])
      })

      it('resolving for a task ends only that task\'s question (the user typed its time)', () => {
        const store = useDayRecapStore()
        store.offerTime(offer)
        store.resolveTimeOffer('b')
        expect(store.validTimeOffer).toEqual(offer)
        store.resolveTimeOffer('a')
        expect(store.validTimeOffer).toBeNull()
      })

      it('reads a malformed stored question as none and does not write it back at hydration', async () => {
        for (const bad of ['yes', { taskId: 1, day: '2026-10-22', seconds: 5 }, { taskId: 'a', day: 'x', seconds: 5 }, { taskId: 'a', day: '2026-10-22', seconds: -1 }, { taskId: 'a', day: '2026-10-22', seconds: 0 }, ['a']]) {
          localStorage.setItem('day-recap-store', JSON.stringify({ timeOffer: bad }))
          const before = localStorage.getItem('day-recap-store')
          freshPinia()
          const store = useDayRecapStore()
          await nextTick()
          expect(store.validTimeOffer).toBeNull()
          expect(localStorage.getItem('day-recap-store')).toBe(before)
        }
      })

      it('data stored without the field loads with no question; spans are clipped to the midnight and a missing list reads as none', () => {
        const store = useDayRecapStore()
        store.timeOffer = { taskId: 'a', day: '2026-10-22', seconds: 60 } as never
        expect(store.validTimeOffer).toEqual({ taskId: 'a', day: '2026-10-22', seconds: 60, spans: [] })
        store.timeOffer = { taskId: 'a', day: '2026-10-22', seconds: 60, spans: [[new Date(2026, 9, 21, 23, 58).getTime(), new Date(2026, 9, 22, 0, 2).getTime()]] }
        expect(store.validTimeOffer?.spans).toEqual([[new Date(2026, 9, 22, 0, 0).getTime(), new Date(2026, 9, 22, 0, 2).getTime()]])
      })

      it('survives a restart', async () => {
        const store = useDayRecapStore()
        store.offerTime(offer)
        await nextTick()
        freshPinia()
        expect(useDayRecapStore().validTimeOffer).toEqual(offer)
      })
    })

    it('persists the start and the group across a restart', async () => {
      const store = useDayRecapStore()
      store.markNewDay('2026-10-22', ['a', 'b'])
      await nextTick()
      freshPinia()
      const again = useDayRecapStore()
      expect(again.validLastNewDay).toBe('2026-10-22')
      expect(again.validSentBack).toEqual({ day: '2026-10-22', ids: ['a', 'b'] })
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
    expect(store.validLastShownDay).toBeNull()
    store.markShown('2026-10-22')
    expect(store.lastShownDay).toBe('2026-10-22')
  })

  it('persists the marker under day-recap-store', async () => {
    const store = useDayRecapStore()
    store.markShown('2026-10-22')
    await nextTick()
    const stored = JSON.parse(localStorage.getItem('day-recap-store') as string)
    expect(stored).toMatchObject({ lastShownDay: '2026-10-22', closedTaskIds: [] })
    expect(stored).not.toHaveProperty('archiveDone')
  })

  it('restores the marker after a reload; the switch of before #428 (`archiveDone`) is ignored and not written back', async () => {
    localStorage.setItem('day-recap-store', JSON.stringify({ lastShownDay: '2026-10-21', archiveDone: false }))
    freshPinia()
    const store = useDayRecapStore()
    expect(store.lastShownDay).toBe('2026-10-21')
    store.markShown('2026-10-22')
    await nextTick()
    expect(JSON.parse(localStorage.getItem('day-recap-store') as string)).not.toHaveProperty('archiveDone')
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
