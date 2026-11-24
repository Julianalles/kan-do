/**
 * #770: field edits outside the sheet (the card menu's time box, priority and "ungeplante Arbeit" toggle, the Jetzt
 * nudge's time box; the palette's are covered in `tests/e2e/command-palette.spec.ts`) take the one edit path, `useTaskSync().editTask`, so a
 * Notion task's edit reaches Notion. Before, they wrote the store only: no push, no `pendingSync` marker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { setTestLocale } from '../helpers/i18n'

vi.mock('nuxt/app', () => ({ navigateTo: vi.fn() }))
vi.mock('#imports', async importOriginal => ({ ...(await importOriginal<object>()), useToast: () => ({ add: vi.fn() }) }))
vi.mock('~/composables/useTaskOperations', () => ({
  useTaskOperations: () => ({ moveOrSwapToStatus: vi.fn(), canMoveOrSwapToStatus: () => ({ allowed: true }) }),
}))
vi.mock('~/composables/useTaskDeletion', () => ({ useTaskDeletion: () => ({ deleteTaskWithUndo: vi.fn() }) }))
vi.mock('~/composables/useTaskMove', () => ({ useTaskMove: () => ({ moveTaskToSource: vi.fn() }) }))
vi.mock('~/composables/useErrorHandler', () => ({
  useErrorHandler: () => ({ handleError: vi.fn(), handleSuccess: vi.fn() }),
}))
vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({
    recordTaskCompletion: vi.fn(), removeTaskRecord: vi.fn(), updateTaskRecord: vi.fn(), syncExistingDoneTasks: vi.fn(),
  }),
}))
vi.mock('~/composables/useNotionDataSource', () => ({
  useNotionDataSource: () => ({ ensureDataSourceConfigured: vi.fn().mockResolvedValue(true) }),
}))
const spotlightTaskId = ref<string | null>(null)
vi.mock('~/composables/useSheetSpotlight', () => ({ useSheetSpotlight: () => ({ spotlightTaskId }) }))

const notion = {
  fetchActiveBoardTasks: vi.fn<() => Promise<Task[]>>(),
  updateTask: vi.fn<(task: Task) => Promise<Task>>(),
  createTask: vi.fn<(draft: Partial<Task>) => Promise<Task>>(),
  findLandedPage: vi.fn(),
  archiveTask: vi.fn(),
}
const notionConfig = { isConfigured: true, hasDataSourceSelected: true, config: { token: 't', statusMapping: { archive: null as string | null } } }
vi.mock('~/composables/useNotionIntegration', () => ({
  useNotionIntegration: () => ({ isConfigured: { value: true }, createInstance: () => notion }),
}))
vi.mock('~/store/notionConfig', () => ({ useNotionConfigStore: () => notionConfig }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useTaskContextMenu } from '~/composables/useTaskContextMenu'
import TaskTimeboxNudge from '~/components/task/TaskTimeboxNudge.vue'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { useIntegrationHealthStore } from '~/store/integrationHealth'
/* eslint-enable import/first */

const notionTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'n1', source: 'notion', externalId: 'page-1', title: 'Angebot prüfen', status: TaskStatus.Open, activity: null,
  topic: null, topicColorCode: null, priority: 1, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null,
  ...overrides,
})

/** The last task Notion was asked to write */
const lastPushed = (): Task => notion.updateTask.mock.calls.at(-1)![0]

type MenuItem = { label?: string, children?: MenuItem[], onSelect?: (e?: Event) => void, onUpdateChecked?: (v: boolean) => void }

describe('field edits outside the sheet push to the source (#770)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    setTestLocale('de')
    spotlightTaskId.value = null
    Object.values(notion).forEach(fn => fn.mockReset())
    notion.updateTask.mockImplementation(async task => task)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    useBoardStore().setSources({ connected: ['notion'], default: 'notion' })
    useIntegrationHealthStore().recordSuccessfulSync('notion')
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('card menu', () => {
    const menuItems = (task: Task): MenuItem[] => {
      useTasksStore().setTasks([task])
      return (useTaskContextMenu(ref(useTasksStore().task(task.id)!)).menuItems.value as MenuItem[][]).flat()
    }

    it('a time box preset is pushed to Notion', async () => {
      const timebox = menuItems(notionTask()).find(i => i.label === 'Timebox setzen')!
      timebox.children!.find(i => i.label === '15 Minuten' || i.label === '15 min')!.onSelect!()
      await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalledTimes(1))
      expect(lastPushed().timeBoxSeconds).toBe(900)
    })

    it('removing the time box is pushed to Notion', async () => {
      const timebox = menuItems(notionTask({ timeBoxSeconds: 900 })).find(i => i.label === 'Timebox setzen')!
      timebox.children!.find(i => i.label === 'Timebox entfernen')!.onSelect!()
      await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalledTimes(1))
      expect(lastPushed().timeBoxSeconds).toBeNull()
    })

    it('a priority is pushed to Notion', async () => {
      const priority = menuItems(notionTask()).find(i => i.label === 'Priorität ändern')!
      priority.children![2]!.onSelect!()
      await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalledTimes(1))
      expect(lastPushed().priority).toBe(3)
    })

    it('a refused write leaves the task marked pending', async () => {
      notion.updateTask.mockRejectedValue(new Error('offline'))
      const priority = menuItems(notionTask()).find(i => i.label === 'Priorität ändern')!
      priority.children![2]!.onSelect!()
      await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalled())
      await vi.waitFor(() => expect(useTasksStore().task('n1')!.pendingSync).toBeTruthy())
    })
  })

  it('the Jetzt nudge pushes the picked time box to Notion', async () => {
    vi.useFakeTimers()
    const tasks = useTasksStore()
    tasks.setTasks([notionTask({ status: TaskStatus.Progress })])
    useBoardStore().startTimeboxNudge('n1')
    const w = mount(TaskTimeboxNudge, {
      props: { task: tasks.task('n1')! },
      attachTo: document.body,
      global: { stubs: { UIcon: true, Transition: false } },
    })
    await w.findAll('button')[0]!.trigger('click')
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    expect(tasks.task('n1')!.timeBoxSeconds).toBe(900)
    await vi.waitFor(() => expect(notion.updateTask).toHaveBeenCalledTimes(1))
    expect(lastPushed().timeBoxSeconds).toBe(900)
    w.unmount()
  })
})
