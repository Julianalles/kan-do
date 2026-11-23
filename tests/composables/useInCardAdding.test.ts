/**
 * #758: the task an open in-card flow has stored is left out of the board's lists (Offen, "Alle Aufgaben" and the
 * DnD mapping read the same helper) until the flow ends; a flow that ends late never clears another flow's task.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { inCardTask, setInCardTask, withoutInCardTask } from '~/composables/useInCardAdding'

const list = [{ id: 'a' }, { id: 'new' }, { id: 'b' }]

describe('useInCardAdding: the stored task of an open in-card flow (#758)', () => {
  afterEach(() => setInCardTask(null))

  it('passes every task through while no flow holds one', () => {
    expect(inCardTask.value).toBeNull()
    expect(withoutInCardTask(list).map((task) => task.id)).toEqual(['a', 'new', 'b'])
  })

  it('leaves out the task the flow stored, keeping the order of the rest', () => {
    setInCardTask('new')
    expect(inCardTask.value).toBe('new')
    expect(withoutInCardTask(list).map((task) => task.id)).toEqual(['a', 'b'])
  })

  it('a flow ending clears only its own task', () => {
    setInCardTask('new')
    setInCardTask(null, 'other')
    expect(inCardTask.value).toBe('new')
    setInCardTask(null, 'new')
    expect(inCardTask.value).toBeNull()
    expect(withoutInCardTask(list)).toHaveLength(3)
  })
})
