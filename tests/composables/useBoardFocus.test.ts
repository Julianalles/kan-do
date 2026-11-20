/**
 * The read side of the topic focus (#161): what stays visible, what the chips count and what the pill says.
 * Real Pinia stores.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'
import { useTasksStore } from '~/store/tasks'
import { useBoardStore } from '~/store/board'
import { applyTopicFocus, useBoardFocus } from '~/composables/useBoardFocus'
import { sourceOf } from '../helpers/taskSource'
import { setCurrentBoardPath } from '~/lib/boardPlace'

const makeTask = (id: string, status: TaskStatus, topic: string | null, extra: Partial<Task> = {}): Task => ({
  id, ...sourceOf(id),
  title: id,
  status,
  activity: null,
  topic,
  topicColorCode: null,
  priority: 0,
  notes: null,
  timeSpentSeconds: 0,
  timeBoxSeconds: null,
  timerId: null,
  ...extra,
})

describe('applyTopicFocus', () => {
  const tasks = [
    makeTask('a', TaskStatus.Open, 'A'),
    makeTask('b', TaskStatus.Open, 'B'),
    makeTask('n', TaskStatus.Waiting, null),
    makeTask('run', TaskStatus.Progress, 'B'),
  ]

  it('without a focus everything stays', () => {
    expect(applyTopicFocus(tasks, null).map(t => t.id)).toEqual(['a', 'b', 'n', 'run'])
  })

  it('with a focus only the topic and the Jetzt card stay; cards without a topic are hidden', () => {
    expect(applyTopicFocus(tasks, 'A').map(t => t.id)).toEqual(['a', 'run'])
  })

  it('a Jetzt card of another topic stays', () => {
    expect(applyTopicFocus([makeTask('run', TaskStatus.Progress, 'Z')], 'A')).toHaveLength(1)
  })
})

describe('useBoardFocus', () => {
  let tasksStore: ReturnType<typeof useTasksStore>
  let boardStore: ReturnType<typeof useBoardStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    tasksStore = useTasksStore()
    boardStore = useBoardStore()
    const now = new Date()
    ;[
      makeTask('o1', TaskStatus.Open, 'Baustelle'),
      makeTask('o2', TaskStatus.Open, 'Baustelle'),
      makeTask('o3', TaskStatus.Open, 'Büro'),
      makeTask('o4', TaskStatus.Open, null),
      makeTask('w1', TaskStatus.Waiting, 'Büro'),
      makeTask('d1', TaskStatus.Done, 'Baustelle', { completedAt: now }),
      makeTask('run', TaskStatus.Progress, 'Garten'),
    ].forEach(task => tasksStore.addTask(task))
    boardStore.reconcileColumnsWithTasks(tasksStore.tasks)
  })

  afterEach(() => setCurrentBoardPath('/tasks'))

  it('on "Alle" it counts and hides what that place shows: "Alle Aufgaben" and Offen, not Wartet or Erledigt (#354)', () => {
    tasksStore.addTask(makeTask('n1', TaskStatus.Open, 'Garten', { notPlanned: true }))
    tasksStore.addTask(makeTask('n2', TaskStatus.Open, 'Büro', { notPlanned: true }))
    setCurrentBoardPath('/all')
    const focus = useBoardFocus()
    expect(focus.topicChoices.value).toEqual([
      { topic: 'Baustelle', count: 2 },
      { topic: 'Büro', count: 2 },
      { topic: 'Garten', count: 1 },
    ])
    focus.setFocus('Büro')
    // o1, o2, o4 and n1 are hidden; the same state filters both lists
    expect(focus.hiddenCount.value).toBe(4)
    expect(focus.applyFocus(tasksStore.tasksNotPlanned).map(task => task.id)).toEqual(['n2'])
    expect(focus.applyFocus(tasksStore.tasksOpen).map(task => task.id)).toEqual(['o3'])
    // Back on Heute the focus is the same one, counted over Heute's columns
    setCurrentBoardPath('/tasks')
    expect(focus.focusTopic.value).toBe('Büro')
    expect(focus.hiddenCount.value).toBe(4) // o1, o2, o4, d1
  })

  it('counts the topics of Offen, Wartet and Erledigt, Jetzt left out, most cards first', () => {
    expect(useBoardFocus().topicChoices.value).toEqual([
      { topic: 'Baustelle', count: 3 },
      { topic: 'Büro', count: 2 },
    ])
  })

  it('hidden counts the other cards (no topic included), never the Jetzt card', () => {
    const focus = useBoardFocus()
    expect(focus.hiddenCount.value).toBe(0)
    focus.setFocus('Baustelle')
    expect(focus.hiddenCount.value).toBe(3) // o3, o4, w1
    expect(focus.applyFocus(tasksStore.tasksProgress).map(t => t.id)).toEqual(['run'])
  })

  it('a card added while a focus is on follows it and is counted as hidden', () => {
    const focus = useBoardFocus()
    focus.setFocus('Baustelle')
    tasksStore.addTask(makeTask('new', TaskStatus.Open, null))
    expect(focus.applyFocus(tasksStore.tasksOpen).map(t => t.id)).not.toContain('new')
    expect(focus.hiddenCount.value).toBe(4)
  })

  it('a focus on a topic nobody carries any more keeps the funnel and shows empty columns', () => {
    const focus = useBoardFocus()
    focus.setFocus('Weg')
    expect(focus.hasFocusJob.value).toBe(true)
    expect(focus.applyFocus(tasksStore.tasksOpen)).toEqual([])
  })

  it('the funnel has no job while no card has a topic and no focus is on', () => {
    tasksStore.tasks.forEach(task => tasksStore.updateTask(task.id, { topic: null }))
    expect(useBoardFocus().hasFocusJob.value).toBe(false)
  })

  it('picking a topic closes the chip row, clearing too', () => {
    const focus = useBoardFocus()
    focus.chipsOpen.value = true
    focus.setFocus('Büro')
    expect(focus.chipsOpen.value).toBe(false)
    focus.chipsOpen.value = true
    focus.clearFocus()
    expect(focus.chipsOpen.value).toBe(false)
    expect(focus.focusTopic.value).toBeNull()
  })
})
