/**
 * The drag between "Alle Aufgaben" and Offen (#355): a card of the side dropped on Offen is planned in the previewed
 * slot, an Offen card or stack dropped on the side is taken off the board, everything else puts the card back.
 * Real Pinia stores and real useTaskSync; only the integrations and UI are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useBoardDndKit } from '~/composables/useBoardDndKit'
import { useBoardDragState } from '~/composables/useBoardDragState'
import { NOT_PLANNED_GROUP } from '~/utils/planDrop'
import { sourceOf } from '../helpers/taskSource'

vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('@dnd-kit/vue/sortable', () => ({
  isSortable: (source: unknown) => source !== null && typeof source === 'object' && 'initialGroup' in source,
}))

const makeTask = (overrides: Partial<Task>): Task => ({
  id: 'task-1', ...sourceOf(overrides.id ?? 'task-1'),
  title: 'Test',
  status: TaskStatus.Open,
  activity: null,
  topic: null,
  topicColorCode: null,
  priority: 0,
  notes: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  timerId: null,
  ...overrides,
})

const zone = { id: 'not-planned-zone', data: { notPlannedZone: true } }
const openZone = { id: 'column-drop-zone-0', data: { taskStatus: TaskStatus.Open } }

describe('useBoardDndKit: between "Alle Aufgaben" and Offen (#355)', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let side: HTMLElement
  let openList: HTMLElement
  const { dragState } = useBoardDragState()

  /** The side's list and Offen's list as the components render them */
  const mount = () => {
    side = document.createElement('ul')
    openList = document.createElement('div')
    openList.setAttribute('data-task-status', String(TaskStatus.Open))
    for (const task of tasksStore.tasksNotPlanned) {
      const li = document.createElement('li')
      li.className = 'not-planned__item'
      li.setAttribute('data-not-planned-id', task.id)
      side.append(li)
    }
    for (const task of tasksStore.tasksOpen) {
      const wrapper = document.createElement('div')
      wrapper.className = 'task-wrapper'
      wrapper.setAttribute('data-task-id', task.id)
      openList.append(wrapper)
    }
    document.body.append(side, openList)
  }
  const seed = (held: string[], open: string[]) => {
    held.forEach(id => tasksStore.addTask(makeTask({ id, notPlanned: true })))
    open.forEach(id => tasksStore.addTask(makeTask({ id })))
    useBoardStore().reconcileColumnsWithTasks(tasksStore.tasks)
    mount()
  }
  const sideItem = (id: string) => side.querySelector(`[data-not-planned-id="${id}"]`)!
  const openCard = (id: string) => openList.querySelector(`[data-task-id="${id}"]`)!
  const sideIds = () => [...side.children].map(el => el.getAttribute('data-not-planned-id'))
  const openIds = () => tasksStore.tasksOpen.map(t => t.id)
  const heldIds = () => tasksStore.tasksNotPlanned.map(t => t.id)

  const pickUpHeld = (id: string) => {
    const kit = useBoardDndKit()
    const element = sideItem(id)
    const source = { id, initialIndex: 0, index: 0, initialGroup: NOT_PLANNED_GROUP as unknown, group: NOT_PLANNED_GROUP as unknown, element }
    kit.onDragStart({ operation: { source } })
    return { kit, source, element }
  }
  /** What dnd-kit's optimistic sorting does over an Offen card: the node moves in front of it, the group follows */
  const sortInto = (source: { group: unknown; element: Element }, beforeId: string | null) => {
    openList.insertBefore(source.element, beforeId ? openCard(beforeId) : null)
    source.group = TaskStatus.Open
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    tasksStore = useTasksStore()
  })
  afterEach(() => {
    side.remove()
    openList.remove()
  })

  it.each([
    ['first', 'o1', ['h2', 'o1', 'o2']],
    ['between two cards', 'o2', ['o1', 'h2', 'o2']],
    ['last', null, ['o1', 'o2', 'h2']],
  ])('plans a card dropped in Offen as the %s card', (_label, beforeId, expected) => {
    seed(['h1', 'h2', 'h3'], ['o1', 'o2'])
    const { kit, source, element } = pickUpHeld('h2')
    expect(dragState.value.fromNotPlanned).toBe(true)
    expect(dragState.value.sourceStatus).toBeNull()
    sortInto(source, beforeId)

    kit.onDragEnd({ canceled: false, operation: { source, target: source } })

    expect(openIds()).toEqual(expected)
    expect(heldIds()).toEqual(['h1', 'h3'])
    expect(tasksStore.task('h2')?.status).toBe(TaskStatus.Open)
    expect(tasksStore.task('h2')?.pendingSync).toBeFalsy()
    // The node is back in its own list before Vue patches it, between its neighbours (#146)
    expect(element.parentElement).toBe(side)
    expect(sideIds()).toEqual(['h1', 'h2', 'h3'])
    expect(dragState.value.fromNotPlanned).toBe(false)
  })

  it('a waiting card off today dropped in Offen is planned and keeps Wartet: no slot in Offen\'s order (#793)', () => {
    tasksStore.addTask(makeTask({ id: 'w1', status: TaskStatus.Waiting, notPlanned: true }))
    tasksStore.addTask(makeTask({ id: 'w0', status: TaskStatus.Waiting }))
    seed([], ['o1', 'o2'])
    const board = useBoardStore()
    const { kit, source } = pickUpHeld('w1')
    sortInto(source, 'o1')

    kit.onDragEnd({ canceled: false, operation: { source, target: source } })

    expect(heldIds()).toEqual([])
    expect(tasksStore.task('w1')?.status).toBe(TaskStatus.Waiting)
    expect(openIds()).toEqual(['o1', 'o2'])
    expect(board.columnByTaskStatus(TaskStatus.Open)?.taskOrder).toEqual(['o1', 'o2'])
    expect(board.columnByTaskStatus(TaskStatus.Waiting)?.taskOrder).toEqual(['w0', 'w1'])
  })

  it('a drop on the drop zone of Offen plans the card at the end', () => {
    seed(['h1'], ['o1', 'o2'])
    const { kit, source } = pickUpHeld('h1')
    kit.onDragEnd({ canceled: false, operation: { source, target: openZone } })
    expect(openIds()).toEqual(['o1', 'o2', 'h1'])
  })

  it.each([
    ['back over its own side', true],
    ['with nothing under the pointer after it never left', false],
  ])('puts the card back when dropped %s', (_label, overSide) => {
    seed(['h1', 'h2'], ['o1'])
    const { kit, source, element } = pickUpHeld('h1')
    if (overSide) sortInto(source, 'o1')

    kit.onDragEnd({ canceled: false, operation: { source, target: overSide ? zone : null } })

    expect(heldIds()).toEqual(['h1', 'h2'])
    expect(openIds()).toEqual(['o1'])
    expect(element.parentElement).toBe(side)
    expect(sideIds()).toEqual(['h1', 'h2'])
  })

  it('a canceled drag restores the node and stores nothing', () => {
    seed(['h1', 'h2'], ['o1'])
    const { kit, source, element } = pickUpHeld('h2')
    sortInto(source, 'o1')
    kit.onDragEnd({ canceled: true, operation: { source, target: source } })
    expect(heldIds()).toEqual(['h1', 'h2'])
    expect(openIds()).toEqual(['o1'])
    expect(sideIds()).toEqual(['h1', 'h2'])
    expect(element.parentElement).toBe(side)
  })

  it('the sole card of the side goes back into its empty list', () => {
    seed(['h1'], ['o1'])
    const { kit, source, element } = pickUpHeld('h1')
    sortInto(source, 'o1')
    kit.onDragEnd({ canceled: true, operation: { source, target: null } })
    expect(element.parentElement).toBe(side)
  })

  it('never lets a "Alle Aufgaben" card into another column, and marks the side only while it is the target', () => {
    seed(['h1'], ['o1'])
    tasksStore.addTask(makeTask({ id: 'w1', status: TaskStatus.Waiting }))
    const { kit, source } = pickUpHeld('h1')

    const intoWaiting = vi.fn()
    kit.onDragOver({ operation: { source, target: { id: 'w1', initialGroup: TaskStatus.Waiting, group: TaskStatus.Waiting } }, preventDefault: intoWaiting })
    expect(intoWaiting).toHaveBeenCalledTimes(1)

    const intoOpen = vi.fn()
    kit.onDragOver({ operation: { source, target: { id: 'o1', initialGroup: TaskStatus.Open, group: TaskStatus.Open } }, preventDefault: intoOpen })
    expect(intoOpen).not.toHaveBeenCalled()
    expect(dragState.value.hoverTargetStatus).toBe(TaskStatus.Open)
    expect(dragState.value.overNotPlanned).toBe(false)

    kit.onDragOver({ operation: { source, target: zone }, preventDefault: vi.fn() })
    expect(dragState.value.overNotPlanned).toBe(true)
    expect(dragState.value.hoverTargetStatus).toBeNull()

    kit.onDragOver({ operation: { source, target: null }, preventDefault: vi.fn() })
    expect(dragState.value.overNotPlanned).toBe(false)
  })

  it('an Offen card dropped on the side is taken off the board and lies on top there', () => {
    seed(['h1'], ['o1', 'o2'])
    const kit = useBoardDndKit()
    const source = { id: 'o2', initialIndex: 1, index: 1, initialGroup: TaskStatus.Open, group: TaskStatus.Open, element: openCard('o2') }
    kit.onDragStart({ operation: { source } })
    kit.onDragOver({ operation: { source, target: zone }, preventDefault: vi.fn() })
    expect(dragState.value.overNotPlanned).toBe(true)
    expect(dragState.value.fromNotPlanned).toBe(false)

    kit.onDragEnd({ canceled: false, operation: { source, target: zone } })

    expect(heldIds()).toEqual(['o2', 'h1'])
    expect(openIds()).toEqual(['o1'])
    expect(tasksStore.task('o2')?.status).toBe(TaskStatus.Open)
    expect(dragState.value.overNotPlanned).toBe(false)
  })

  it('a stack dropped on the side takes all its members off, in their order', () => {
    seed(['h1'], ['o1', 'o2', 'o3'])
    const kit = useBoardDndKit()
    const stack = { key: 'prio', label: 'Hoch', taskIds: ['o1', 'o3'] }
    const source = { id: 'o1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Open, group: TaskStatus.Open, element: openCard('o1'), data: { stack } }
    kit.onDragStart({ operation: { source } })
    kit.onDragEnd({ canceled: false, operation: { source, target: zone } })
    expect(heldIds()).toEqual(['o1', 'o3', 'h1'])
    expect(openIds()).toEqual(['o2'])
  })

  it('a card of another column dropped on the side changes nothing', () => {
    seed(['h1'], ['o1'])
    tasksStore.addTask(makeTask({ id: 'w1', status: TaskStatus.Waiting }))
    useBoardStore().reconcileColumnsWithTasks(tasksStore.tasks)
    const kit = useBoardDndKit()
    const source = { id: 'w1', initialIndex: 0, index: 0, initialGroup: TaskStatus.Waiting, group: TaskStatus.Waiting, element: document.createElement('div') }
    kit.onDragStart({ operation: { source } })
    kit.onDragEnd({ canceled: false, operation: { source, target: zone } })
    expect(tasksStore.task('w1')?.status).toBe(TaskStatus.Waiting)
    expect(heldIds()).toEqual(['h1'])
  })
})
