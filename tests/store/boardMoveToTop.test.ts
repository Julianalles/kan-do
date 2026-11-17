/**
 * #405: the Now window's pause sets a card first into Wartet's order. `moveToTopOfColumn` keeps the order the user
 * saw behind the card, keeps ids that are in the stored order but not visible, and switches a sorted column to manual
 * (the sort would otherwise decide: Wartet sorts by "longest wait" by default).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBoardStore } from '~/store/board'
import { TaskStatus } from '~/types/taskStatus'

describe('board store: moveToTopOfColumn (#405)', () => {
  let store: ReturnType<typeof useBoardStore>

  const waiting = () => store.columnByTaskStatus(TaskStatus.Waiting)!

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useBoardStore()
  })

  it('puts the card first and keeps the visible order behind it', () => {
    store.updateTaskPosition('w1', TaskStatus.Waiting)
    store.updateTaskPosition('w2', TaskStatus.Waiting)
    store.updateTaskPosition('p', TaskStatus.Waiting, TaskStatus.Progress)
    store.moveToTopOfColumn(TaskStatus.Waiting, 'p', ['w2', 'w1'])
    expect(waiting().taskOrder).toEqual(['p', 'w2', 'w1'])
  })

  it('keeps a stored id that was not visible behind the visible ones', () => {
    store.updateTaskPosition('w1', TaskStatus.Waiting)
    store.updateTaskPosition('hidden', TaskStatus.Waiting)
    store.updateTaskPosition('p', TaskStatus.Waiting, TaskStatus.Progress)
    store.moveToTopOfColumn(TaskStatus.Waiting, 'p', ['w1'])
    expect(waiting().taskOrder).toEqual(['p', 'w1', 'hidden'])
  })

  it('switches a sorted column to manual so the card stays on top, and leaves a manual one as it is', () => {
    expect(waiting().sorting).toEqual({ field: 'dateUpdated', direction: 'asc' })
    store.updateTaskPosition('p', TaskStatus.Waiting, TaskStatus.Progress)
    store.moveToTopOfColumn(TaskStatus.Waiting, 'p', [])
    expect(waiting().sorting).toEqual({ field: 'manual', direction: 'asc' })
    store.moveToTopOfColumn(TaskStatus.Waiting, 'p', [])
    expect(waiting().sorting).toEqual({ field: 'manual', direction: 'asc' })
  })

  it('does not duplicate the card when it is also in the visible list', () => {
    store.updateTaskPosition('p', TaskStatus.Waiting, TaskStatus.Progress)
    store.moveToTopOfColumn(TaskStatus.Waiting, 'p', ['x', 'p'])
    expect(waiting().taskOrder).toEqual(['p', 'x'])
  })
})
