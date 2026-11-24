import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTaskStatusActions } from '~/composables/useTaskStatusActions'
import { useTasksStore } from '~/store/tasks'

const updateTaskStatusMock = vi.fn()

vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({
    moveOrSwapToStatus: updateTaskStatusMock,
  }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', source: 'local', externalId: null,
    title: 'Test',
    status: TaskStatus.Open,
    activity: null,
    topic: null,
    topicColorCode: null,
    priority: 1,
    notes: null,
    timeBoxSeconds: null,
    timeSpentSeconds: 0,
    timerId: null,
    ...overrides,
  }
}

describe('useTaskStatusActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    updateTaskStatusMock.mockReset()
    updateTaskStatusMock.mockResolvedValue(undefined)
  })

  describe('choosing Jetzt (#162, #241)', () => {
    it('goes through the shared swap-aware move, whatever the status (the swap decision lives there, not in the sheet)', async () => {
      const { changeStatus } = useTaskStatusActions(ref(makeTask({ id: 'abc' })))

      await changeStatus(TaskStatus.Progress)
      await changeStatus(TaskStatus.Waiting)

      expect(updateTaskStatusMock).toHaveBeenNthCalledWith(1, 'abc', TaskStatus.Progress)
      expect(updateTaskStatusMock).toHaveBeenNthCalledWith(2, 'abc', TaskStatus.Waiting)
    })
  })

  describe('changeStatus', () => {
    it('calls updateTaskStatus with the given taskId and status', async () => {
      const task = ref(makeTask({ id: 'abc', source: 'local', externalId: null, status: TaskStatus.Open }))
      const { changeStatus } = useTaskStatusActions(task)

      await changeStatus(TaskStatus.Done)

      expect(updateTaskStatusMock).toHaveBeenCalledWith('abc', TaskStatus.Done)
    })

    it('does nothing when task is null', async () => {
      const task = ref<Task | null>(null)
      const { changeStatus } = useTaskStatusActions(task)

      await changeStatus(TaskStatus.Done)

      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it('does nothing when task has no id', async () => {
      const task = ref<Task | null>(makeTask({ id: '' }))
      const { changeStatus } = useTaskStatusActions(task)

      await changeStatus(TaskStatus.Done)

      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })
  })

  describe('statusMenuItems', () => {
    it('returns exactly 4 items in a single section', () => {
      const task = ref(makeTask({ status: TaskStatus.Open }))
      const { statusMenuItems } = useTaskStatusActions(task)

      expect(statusMenuItems.value).toHaveLength(1)
      expect(statusMenuItems.value[0]).toHaveLength(4)
    })

    it('disables only the current status item', () => {
      const task = ref(makeTask({ status: TaskStatus.Progress }))
      const { statusMenuItems } = useTaskStatusActions(task)

      const items = statusMenuItems.value[0]!
      const disabledItems = items.filter(i => i.disabled)
      const enabledItems = items.filter(i => !i.disabled)

      expect(disabledItems).toHaveLength(1)
      expect(enabledItems).toHaveLength(3)
    })

    it('disables the Open item when task is Open', () => {
      const task = ref(makeTask({ status: TaskStatus.Open }))
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const openItem = items.find(i => i.label === 'Offen')
      expect(openItem?.disabled).toBe(true)
    })

    it('disables the Progress item when task is In Progress', () => {
      const task = ref(makeTask({ status: TaskStatus.Progress }))
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const progressItem = items.find(i => i.label === 'Jetzt')
      expect(progressItem?.disabled).toBe(true)
    })

    it('disables the Done item when task is Done', () => {
      const task = ref(makeTask({ status: TaskStatus.Done }))
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const doneItem = items.find(i => i.label === 'Erledigt')
      expect(doneItem?.disabled).toBe(true)
    })

    it('uses Open as default when task is null', () => {
      const task = ref<Task | null>(null)
      const { statusMenuItems } = useTaskStatusActions(task)
      const items = statusMenuItems.value[0]!

      const openItem = items.find(i => i.label === 'Offen')
      expect(openItem?.disabled).toBe(true)
    })

    it('updates reactively when task status changes', () => {
      const task = ref(makeTask({ status: TaskStatus.Open }))
      const { statusMenuItems } = useTaskStatusActions(task)

      expect(statusMenuItems.value[0]!.find(i => i.label === 'Offen')?.disabled).toBe(true)

      task.value = makeTask({ status: TaskStatus.Done })

      expect(statusMenuItems.value[0]!.find(i => i.label === 'Erledigt')?.disabled).toBe(true)
      expect(statusMenuItems.value[0]!.find(i => i.label === 'Offen')?.disabled).toBe(false)
    })
  })

  describe('the switch "Für heute eingeplant" (#795)', () => {
    /** The task as the store holds it, with the real `useTaskSync` moves behind the switch */
    function stored(overrides: Partial<Task>) {
      const store = useTasksStore()
      store.setTasks([makeTask({ id: 'abc', ...overrides })])
      return { store, actions: useTaskStatusActions(computed(() => store.task('abc') ?? null)) }
    }

    it('reads on for a planned task and off for an Offen or Wartet task off today', () => {
      expect(stored({}).actions.isPlannedToday.value).toBe(true)
      expect(stored({ notPlanned: true }).actions.isPlannedToday.value).toBe(false)
      expect(stored({ status: TaskStatus.Waiting, notPlanned: true }).actions.isPlannedToday.value).toBe(false)
    })

    it('a stale marker on a Jetzt or Erledigt task never reads as off today', () => {
      expect(stored({ status: TaskStatus.Progress, notPlanned: true }).actions.isPlannedToday.value).toBe(true)
      expect(stored({ status: TaskStatus.Done, notPlanned: true }).actions.isPlannedToday.value).toBe(true)
    })

    it.each([[TaskStatus.Open, true], [TaskStatus.Waiting, true], [TaskStatus.Progress, false], [TaskStatus.Done, false]])('status %s: the switch can be moved: %s', (status, movable) => {
      expect(stored({ status }).actions.canTogglePlanned.value).toBe(movable)
    })

    it.each([TaskStatus.Open, TaskStatus.Waiting])('switching off takes a task in status %s off today and leaves its status alone; switching on plans it again', (status) => {
      const { store, actions } = stored({ status })
      actions.togglePlanned(false)
      expect(store.task('abc')).toMatchObject({ status, notPlanned: true })
      expect(actions.isPlannedToday.value).toBe(false)
      actions.togglePlanned(true)
      expect(store.task('abc')?.status).toBe(status)
      expect(store.task('abc')?.notPlanned).toBeUndefined()
      expect(actions.isPlannedToday.value).toBe(true)
    })

    it.each([TaskStatus.Progress, TaskStatus.Done])('the switch of a task in status %s changes nothing', (status) => {
      const { store, actions } = stored({ status })
      actions.togglePlanned(false)
      expect(store.task('abc')?.notPlanned).toBeUndefined()
      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it('a status pick is only the normal move: no planning write', async () => {
      const { store, actions } = stored({ notPlanned: true, status: TaskStatus.Waiting })
      await actions.changeStatus(TaskStatus.Open)
      expect(updateTaskStatusMock).toHaveBeenCalledWith('abc', TaskStatus.Open)
      expect(store.task('abc')?.notPlanned).toBe(true)
    })
  })
})
