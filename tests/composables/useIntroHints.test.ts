/**
 * #800: which intro hint shows on the board. One at a time, only on "Heute" without a task sheet, never while a
 * notice about the board is up; "Start" is due with cards in Offen and an empty Jetzt, and a card in Jetzt ends it
 * whether the hint was on screen or not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import type { Task } from '~/types/task'

const noticeShown = ref(false)
const timeOffer = ref<{ taskId: string } | null>(null)
const recapOpen = ref(false)
const dayCloseOpen = ref(false)
vi.mock('~/composables/useNewDay', () => ({ useNewDay: () => ({ noticeShown, timeOffer }) }))
vi.mock('~/composables/useNewDayRecap', () => ({ useNewDayRecap: () => ({ isOpen: recapOpen }) }))
vi.mock('~/composables/useDayClose', () => ({ useDayClose: () => ({ isOpen: dayCloseOpen }) }))

/* eslint-disable import/first -- order-sensitive: mocks must be registered before the SUT is imported */
import { useIntroHints, useIntroHintSteps } from '~/composables/useIntroHints'
import { useSettingsStore } from '~/store/settings'
import { useTasksStore } from '~/store/tasks'
import { setCurrentBoardPath } from '~/lib/boardPlace'
import { dayKey } from '~/utils/recapDay'
/* eslint-enable import/first */

const task = (id: string, status: TaskStatus): Task => ({ id, title: id, status, source: 'local', externalId: null } as Task)

function setup(tasks: Task[], started = true) {
  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  tasksStore.setTasks(tasks)
  if (started) settings.startIntroHints()
  return { settings, tasksStore, hints: useIntroHints() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  noticeShown.value = false
  timeOffer.value = null
  recapOpen.value = false
  dayCloseOpen.value = false
  setCurrentBoardPath('/tasks')
})

describe('useIntroHints: the hint "Start"', () => {
  it('shows with cards in Offen and an empty Jetzt', () => {
    expect(setup([task('a', TaskStatus.Open)]).hints.current.value).toBe('start')
  })

  it('does not show on an empty board or with a card in Jetzt', () => {
    expect(setup([]).hints.current.value).toBeNull()
    setActivePinia(createPinia())
    expect(setup([task('a', TaskStatus.Open), task('b', TaskStatus.Progress)]).hints.current.value).toBeNull()
  })

  it('never shows for a user whose hints never started (an install from before #800)', () => {
    expect(setup([task('a', TaskStatus.Open)], false).hints.current.value).toBeNull()
  })

  it('shows on "Heute" only: not on "Alle", not under a task sheet, and is back afterwards', () => {
    const { hints } = setup([task('a', TaskStatus.Open)])
    for (const path of ['/all', '/all/a', '/tasks/a', '/tasks/add']) {
      setCurrentBoardPath(path)
      expect(hints.current.value, path).toBeNull()
    }
    setCurrentBoardPath('/tasks')
    expect(hints.current.value).toBe('start')
  })

  it.each([
    ['the fresh-start notice', () => { noticeShown.value = true }],
    ['the question about time after midnight', () => { timeOffer.value = { taskId: 'a' } }],
    ['the recap', () => { recapOpen.value = true }],
    ['the day close', () => { dayCloseOpen.value = true }],
  ])('waits while %s is up, and shows once it is gone', (_name, raise) => {
    const { hints } = setup([task('a', TaskStatus.Open)])
    raise()
    expect(hints.current.value).toBeNull()
    noticeShown.value = false
    timeOffer.value = null
    recapOpen.value = false
    dayCloseOpen.value = false
    expect(hints.current.value).toBe('start')
  })

  it('"Schließen" ends it and keeps the day quiet', () => {
    const { hints, settings } = setup([task('a', TaskStatus.Open)])
    hints.close()
    expect(hints.current.value).toBeNull()
    expect(settings.introHints).toEqual({ on: true, quietDay: dayKey(new Date()), hints: { start: { answered: true, days: [] } } })
  })

  it('markShown stores today once', () => {
    const { hints, settings } = setup([task('a', TaskStatus.Open)])
    hints.markShown('start')
    const stored = settings.introHints
    hints.markShown('start')
    expect(settings.introHints).toBe(stored)
    expect(stored?.hints.start?.days).toEqual([dayKey(new Date())])
  })
})

describe('useIntroHintSteps: doing the step ends the hint', () => {
  it('a card in Jetzt answers "Start", also while a notice hides the hint; it does not return when Jetzt is empty again', async () => {
    const { hints, settings, tasksStore } = setup([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(settings.introHints?.hints.start).toBeUndefined()
    noticeShown.value = true
    tasksStore.setTasks([task('a', TaskStatus.Progress), task('b', TaskStatus.Open)])
    await nextTick()
    expect(settings.introHints?.hints.start?.answered).toBe(true)
    noticeShown.value = false
    tasksStore.setTasks([task('a', TaskStatus.Done), task('b', TaskStatus.Open)])
    await nextTick()
    expect(hints.current.value).toBeNull()
    scope.stop()
  })

  it('a board that starts with a card in Jetzt (a first sync) answers "Start" at once', () => {
    const { settings } = setup([task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(settings.introHints?.hints.start?.answered).toBe(true)
    scope.stop()
  })

  it('writes nothing for a user whose hints never started', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Open)], false)
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([task('a', TaskStatus.Progress)])
    await nextTick()
    expect(settings.introHints).toBeNull()
    scope.stop()
  })
})
