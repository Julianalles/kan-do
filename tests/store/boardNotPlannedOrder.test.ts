/**
 * The order of "Meine Aufgaben" (#354): `board-store.notPlannedOrder`, an additive persisted field. Data stored
 * before it loads unchanged, a malformed value reads as empty, and hydration never writes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { createPersistedState } from 'pinia-plugin-persistedstate'
import { sanitizeNotPlannedOrder, useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

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

/**
 * The category of the tasks a fresh start took out of Wartet (#387): `board-store.notPlannedFromWaiting`, an additive
 * persisted list of ids beside `notPlannedOrder`, pruned by the same reconcile.
 */
describe('board store: notPlannedFromWaiting (#387)', () => {
  const task = (id: string, status: TaskStatus, notPlanned = false): Task => ({
    id, source: 'local', externalId: null, title: id, notes: null, status, priority: 1, timeBoxSeconds: null, timeSpentSeconds: 0,
    topic: null, topicColorCode: null, activity: null, timerId: null, ...(notPlanned ? { notPlanned: true as const } : {}),
  })

  beforeEach(() => localStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('data stored before #387 hydrates to an empty list and keeps its order of "Meine Aufgaben"', () => {
    const store = hydrate({ ...sources, notPlannedOrder: ['a', 'b'] })
    expect(store.notPlannedFromWaiting).toEqual([])
    expect(store.notPlannedOrder).toEqual(['a', 'b'])
  })

  it.each([
    ['null', null],
    ['a string', 'a,b'],
    ['an object', { a: 1 }],
    ['a number', 3],
  ])('%s hydrates to an empty list without throwing', (_label, notPlannedFromWaiting) => {
    expect(hydrate({ ...sources, notPlannedFromWaiting }).notPlannedFromWaiting).toEqual([])
  })

  it('hydration alone writes nothing back, also for a malformed list', () => {
    localStorage.setItem('board-store', JSON.stringify({ ...sources, notPlannedFromWaiting: 'broken' }))
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    hydrate(undefined)
    expect(setItem.mock.calls.filter(([key]) => key === 'board-store')).toEqual([])
  })

  it('a noted list survives a reload, in the order given, without repeats', async () => {
    const first = hydrate(sources)
    first.noteFromWaiting(['w1', 'w2'])
    first.noteFromWaiting(['w2', 'w3'])
    await nextTick()
    expect(JSON.parse(localStorage.getItem('board-store') ?? '{}').notPlannedFromWaiting).toEqual(['w1', 'w2', 'w3'])
    expect(hydrate(undefined).notPlannedFromWaiting).toEqual(['w1', 'w2', 'w3'])
  })

  it('the reconcile drops a task that is planned again, moved on or gone, and keeps the ones still held', () => {
    const store = hydrate(sources)
    store.noteFromWaiting(['held', 'planned', 'moved', 'gone'])
    store.reconcileColumnsWithTasks([
      task('held', TaskStatus.Open, true), task('planned', TaskStatus.Open), task('moved', TaskStatus.Waiting, true),
    ])
    expect(store.notPlannedFromWaiting).toEqual(['held'])
  })

  it('a task put back by hand later is no longer "from Wartet": it comes from Offen now', () => {
    const store = hydrate(sources)
    store.noteFromWaiting(['w1', 'w2'])
    store.noteNotPlanned('w1')
    expect(store.notPlannedFromWaiting).toEqual(['w2'])
    expect(store.notPlannedOrder).toEqual(['w1'])
  })
})
