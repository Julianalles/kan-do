/**
 * #552: how the welcome flow's endings set the sources when Reminders may already be connected: Notion joins Reminders
 * (mixed board, Notion the default, the Reminders tasks stay), the old single-source switch without it, and the Local
 * ending that keeps a Reminders connection beside Local.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFirstRunSources } from '~/composables/useFirstRunSources'
import { useBoardStore } from '~/store/board'
import { useTasksStore } from '~/store/tasks'
import type { Task } from '~/types/task'
import { TaskStatus } from '~/types/taskStatus'

vi.mock('~/store/taskStatistics', () => ({
  useTaskStatisticsStore: () => ({ syncExistingDoneTasks: vi.fn(), updateTaskRecord: vi.fn() }),
}))

const task = (id: string, source: Task['source']): Task => ({
  id, source, externalId: source === 'local' ? null : id, title: id, status: TaskStatus.Open, activity: null, topic: null,
  topicColorCode: null, priority: 2, notes: null, timeBoxSeconds: null, timeSpentSeconds: 0, timerId: null, isUnplanned: false,
})

describe('useFirstRunSources (#552)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('Notion after Reminders: both connected, Notion the default, the Reminders tasks stay and the switch waits for Notion\'s first fetch', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSources({ connected: ['reminders'], default: 'local' })
    tasks.mergeTasks('reminders', [task('r1', 'reminders')], { holdsOnlyOpenDone: true, keepsKanDoFields: true })

    useFirstRunSources().beginNotionAsDefault()

    expect(board.boardConfig.sources).toEqual({ connected: ['reminders', 'notion'], default: 'notion' })
    expect(board.isSourceSwitchPending).toBe(true)
    expect(tasks.tasks.map(t => [t.id, t.source])).toEqual([['r1', 'reminders']])
  })

  it('Notion without Reminders is the single-source switch as before: Notion alone, other tasks become Local', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSingleSource('local')
    tasks.mergeTasks('local', [task('l1', 'local')])

    useFirstRunSources().beginNotionAsDefault()

    expect(board.boardConfig.sources).toEqual({ connected: ['notion'], default: 'notion' })
    expect(board.isSourceSwitchPending).toBe(true)
  })

  it('the Local ending leaves a connected Reminders beside Local, with its tasks', () => {
    const board = useBoardStore()
    const tasks = useTasksStore()
    board.setSources({ connected: ['reminders'], default: 'local' })
    tasks.mergeTasks('reminders', [task('r1', 'reminders')], { holdsOnlyOpenDone: true, keepsKanDoFields: true })

    useFirstRunSources().beginLocalDefault()

    expect(board.boardConfig.sources).toEqual({ connected: ['reminders'], default: 'local' })
    expect(tasks.tasks.map(t => [t.id, t.source])).toEqual([['r1', 'reminders']])
  })

  it('the Local ending without Reminders is Local alone', () => {
    const board = useBoardStore()
    useFirstRunSources().beginLocalDefault()
    expect(board.boardConfig.sources).toEqual({ connected: [], default: 'local' })
  })
})
