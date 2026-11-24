/**
 * #375: the Offen column is headed "Heute" on the place "Alle" and "Offen" on "Heute". A drag announcement names
 * the column as its headline reads on the place that shows, so the spoken and the visible name never disagree.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { Accessibility } from '@dnd-kit/dom'
import { useBoardAnnouncements } from '~/composables/useBoardAnnouncements'
import { setCurrentBoardPath } from '~/lib/boardPlace'
import { TaskStatus } from '~/types/taskStatus'

type Announce = (event: { operation: { source: unknown, target?: unknown } }) => string | undefined

const dragover = (): Announce => {
  const configured = useBoardAnnouncements().plugins([Accessibility] as never) as unknown as Array<{
    options?: { announcements?: { dragover: Announce } }
  }>
  return configured[0]!.options!.announcements!.dragover
}

/** A card over the drop zone of an empty column: only the column is known, position 1 */
const over = (status: TaskStatus) => dragover()({
  operation: { source: { id: 'task-1', data: {} }, target: { id: `zone-${status}`, data: { taskStatus: status } } },
})

describe('useBoardAnnouncements: the column name follows the place (#375)', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => setCurrentBoardPath('/tasks'))

  it('names Offen "Offen" on the place "Heute"', () => {
    expect(over(TaskStatus.Open)).toBe('„task-1“ nach Spalte Offen, Position 1 verschoben.')
  })

  it('names the same column "Heute" on the place "Alle", also under a sheet path', () => {
    setCurrentBoardPath('/all')
    expect(over(TaskStatus.Open)).toBe('„task-1“ nach Spalte Heute, Position 1 verschoben.')
    setCurrentBoardPath('/all/task-1')
    expect(over(TaskStatus.Open)).toBe('„task-1“ nach Spalte Heute, Position 1 verschoben.')
  })

  it('on "Alle" the Jetzt and Wartet cards stand in "Heute" too (#797); on Heute every column keeps its name', () => {
    setCurrentBoardPath('/all')
    expect(over(TaskStatus.Waiting)).toBe('„task-1“ nach Spalte Heute, Position 1 verschoben.')
    expect(over(TaskStatus.Progress)).toBe('„task-1“ nach Spalte Heute, Position 1 verschoben.')
    setCurrentBoardPath('/tasks')
    expect(over(TaskStatus.Waiting)).toBe('„task-1“ nach Spalte Wartet, Position 1 verschoben.')
    expect(over(TaskStatus.Done)).toBe('„task-1“ nach Spalte Erledigt, Position 1 verschoben.')
  })
})
