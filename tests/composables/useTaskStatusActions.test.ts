import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTaskStatusActions, NOT_PLANNED_CHOICE } from '~/composables/useTaskStatusActions'
import { useTasksStore } from '~/store/tasks'

const updateTaskStatusMock = vi.fn()

vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({
    moveOrSwapToStatus: updateTaskStatusMock,
  }),
}))

const planForTodayMock = vi.fn()
const notTodayMock = vi.fn()
vi.mock('~/composables/usePlanMoves', () => ({
  usePlanMoves: () => ({ planForToday: planForTodayMock, notToday: notTodayMock }),
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

  describe('the fifth choice "Nicht geplant" (#359)', () => {
    /** The task as the store holds it; the mocked move sets the status at once, as the real one does before its write */
    function stored(overrides: Partial<Task>) {
      const store = useTasksStore()
      store.setTasks([makeTask({ id: 'abc', ...overrides })])
      updateTaskStatusMock.mockImplementation(async (id: string, status: TaskStatus) => {
        store.updateTask(id, { status })
      })
      planForTodayMock.mockReset().mockResolvedValue(true)
      notTodayMock.mockReset().mockResolvedValue(true)
      return useTaskStatusActions(computed(() => store.task('abc') ?? null))
    }

    it('reads "Nicht geplant" for a not-planned task and the column for every other', () => {
      expect(stored({ notPlanned: true }).statusChoice.value).toBe(NOT_PLANNED_CHOICE)
      expect(stored({}).statusChoice.value).toBe(TaskStatus.Open)
      // A stale marker outside Offen never hides the column
      expect(stored({ status: TaskStatus.Waiting, notPlanned: true }).statusChoice.value).toBe(TaskStatus.Waiting)
    })

    it('Offen → Nicht geplant is "Nicht für heute planen", without a status write', async () => {
      await stored({}).chooseStatus(NOT_PLANNED_CHOICE)
      expect(notTodayMock).toHaveBeenCalledWith('abc')
      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it.each([TaskStatus.Progress, TaskStatus.Waiting, TaskStatus.Done])('status %s → Nicht geplant: to Offen by the normal move, then "Nicht für heute planen"', async (status) => {
      await stored({ status }).chooseStatus(NOT_PLANNED_CHOICE)
      expect(updateTaskStatusMock).toHaveBeenCalledWith('abc', TaskStatus.Open)
      expect(notTodayMock).toHaveBeenCalledWith('abc')
      expect(updateTaskStatusMock.mock.invocationCallOrder[0]!).toBeLessThan(notTodayMock.mock.invocationCallOrder[0]!)
    })

    it('a refused move to Offen leaves the task where it is: no "Nicht für heute planen"', async () => {
      const actions = stored({ status: TaskStatus.Waiting })
      updateTaskStatusMock.mockImplementation(async () => false)
      await actions.chooseStatus(NOT_PLANNED_CHOICE)
      expect(notTodayMock).not.toHaveBeenCalled()
    })

    it('Nicht geplant → Nicht geplant does nothing', async () => {
      await stored({ notPlanned: true }).chooseStatus(NOT_PLANNED_CHOICE)
      expect(notTodayMock).not.toHaveBeenCalled()
      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it('Nicht geplant → Offen is "Für heute einplanen"', async () => {
      await stored({ notPlanned: true }).chooseStatus(TaskStatus.Open)
      expect(planForTodayMock).toHaveBeenCalledWith('abc')
      expect(updateTaskStatusMock).not.toHaveBeenCalled()
    })

    it.each([TaskStatus.Progress, TaskStatus.Waiting, TaskStatus.Done])('Nicht geplant → status %s is the normal move, which plans it', async (status) => {
      const store = useTasksStore()
      await stored({ notPlanned: true }).chooseStatus(status)
      expect(updateTaskStatusMock).toHaveBeenCalledWith('abc', status)
      expect(planForTodayMock).not.toHaveBeenCalled()
      expect(store.task('abc')).toMatchObject({ status })
      expect(store.task('abc')?.notPlanned).toBeUndefined()
    })

    it('a planned task picked into a column is the normal move', async () => {
      await stored({}).chooseStatus(TaskStatus.Waiting)
      expect(updateTaskStatusMock).toHaveBeenCalledWith('abc', TaskStatus.Waiting)
      expect(notTodayMock).not.toHaveBeenCalled()
    })
  })
})
