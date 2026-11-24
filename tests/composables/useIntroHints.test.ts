/**
 * #800: which intro hint shows on the board. One at a time, only on "Heute" without a task sheet, never while a
 * notice about the board is up; "Start" is due with cards in Offen and an empty Jetzt, and a card in Jetzt ends it
 * whether the hint was on screen or not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { TaskStatus } from '~/types/taskStatus'
import { INTRO_AUSWAHL_MIN_OPEN } from '~/lib/introHints'
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
import { useBoardStore } from '~/store/board'
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
    // a card in Jetzt is not the moment of "Start" ("Weiter" is)
    expect(setup([task('a', TaskStatus.Open), task('b', TaskStatus.Progress)]).hints.current.value).not.toBe('start')
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
    tasksStore.setTasks([task('a', TaskStatus.Open), task('b', TaskStatus.Open)])
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

const done = (id: string, completedAt = new Date()): Task => ({ ...task(id, TaskStatus.Done), completedAt } as Task)
const openCards = (n: number) => Array.from({ length: n }, (_, i) => task(`o${i}`, TaskStatus.Open))
const answered = (settings: ReturnType<typeof useSettingsStore>, id: string) => settings.introHints?.hints[id]?.answered

describe('the hint "Weiter" (#801)', () => {
  it('shows with a card in Jetzt, once "Start" has ended', () => {
    const { hints, settings } = setup([task('a', TaskStatus.Progress)])
    settings.answerIntroHint('start')
    expect(hints.current.value).toBe('weiter')
  })

  it('ends when a card that was in Jetzt goes to Erledigt, on screen or not', async () => {
    const { hints, settings, tasksStore } = setup([task('a', TaskStatus.Progress), task('b', TaskStatus.Open)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    noticeShown.value = true
    tasksStore.setTasks([done('a'), task('b', TaskStatus.Open)])
    await nextTick()
    expect(answered(settings, 'weiter')).toBe(true)
    noticeShown.value = false
    expect(hints.current.value).not.toBe('weiter')
    scope.stop()
  })

  it('ends when a card that was in Jetzt goes to Wartet', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([task('a', TaskStatus.Waiting)])
    await nextTick()
    expect(answered(settings, 'weiter')).toBe(true)
    scope.stop()
  })

  it('a card back in Offen ends nothing: the hint is there again with the next card in Jetzt', async () => {
    const { hints, settings, tasksStore } = setup([task('a', TaskStatus.Progress)])
    settings.answerIntroHint('start')
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([task('a', TaskStatus.Open)])
    await nextTick()
    expect(answered(settings, 'weiter')).toBeUndefined()
    tasksStore.setTasks([task('a', TaskStatus.Progress)])
    await nextTick()
    expect(hints.current.value).toBe('weiter')
    scope.stop()
  })

  it('a Wartet or Erledigt card the board starts with ends nothing: the user never ran the timer (a Notion board)', () => {
    const { hints, settings } = setup([task('w', TaskStatus.Waiting), done('d'), task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(answered(settings, 'weiter')).toBeUndefined()
    expect(answered(settings, 'start')).toBe(true) // the card in Jetzt answered "Start"
    expect(hints.current.value).toBe('weiter')
    scope.stop()
  })

  it('a card deleted from Jetzt ends nothing', async () => {
    const { settings, tasksStore } = setup([task('a', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    tasksStore.setTasks([])
    await nextTick()
    expect(answered(settings, 'weiter')).toBeUndefined()
    scope.stop()
  })
})

describe('the hint "Auswahl" (#801)', () => {
  const ended = (settings: ReturnType<typeof useSettingsStore>, ...ids: string[]) => ids.forEach((id) => settings.answerIntroHint(id))

  it(`shows with ${INTRO_AUSWAHL_MIN_OPEN} cards in Offen and an empty Jetzt, not with fewer, not with a card in Jetzt`, () => {
    const { hints, settings, tasksStore } = setup(openCards(INTRO_AUSWAHL_MIN_OPEN - 1))
    ended(settings, 'start', 'weiter')
    expect(hints.current.value).toBeNull()
    tasksStore.setTasks(openCards(INTRO_AUSWAHL_MIN_OPEN))
    expect(hints.current.value).toBe('auswahl')
    tasksStore.setTasks([...openCards(INTRO_AUSWAHL_MIN_OPEN), task('j', TaskStatus.Progress)])
    expect(hints.current.value).toBeNull()
  })

  it('ends once cards are stacked, on screen or not, and stays ended when stacking is switched off again', async () => {
    const { hints, settings } = setup(openCards(INTRO_AUSWAHL_MIN_OPEN))
    ended(settings, 'start', 'weiter')
    const board = useBoardStore()
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(hints.current.value).toBe('auswahl')
    board.setGroupingEnabled(true)
    await nextTick()
    expect(answered(settings, 'auswahl')).toBe(true)
    board.setGroupingEnabled(false)
    await nextTick()
    expect(hints.current.value).toBeNull()
    scope.stop()
  })
})

describe('"Erneut zeigen" while a step is already done (#804)', () => {
  const ended = (settings: ReturnType<typeof useSettingsStore>, ...ids: string[]) => ids.forEach((id) => settings.answerIntroHint(id))

  it('answers "Auswahl" again when stacking is already on, so the hint does not show with a button that changes nothing', async () => {
    const { hints, settings } = setup(openCards(INTRO_AUSWAHL_MIN_OPEN))
    const board = useBoardStore()
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    board.setGroupingEnabled(true)
    await nextTick()
    expect(answered(settings, 'auswahl')).toBe(true)
    settings.restartIntroHints()
    ended(settings, 'start', 'weiter')
    await nextTick()
    expect(answered(settings, 'auswahl')).toBe(true)
    expect(hints.current.value).toBeNull()
    scope.stop()
  })

  it('answers "Start" again when a card is in Jetzt, so a restart does not bring "Start" back after the card leaves', async () => {
    const { settings, tasksStore } = setup([task('j', TaskStatus.Progress)])
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    await nextTick()
    expect(answered(settings, 'start')).toBe(true)
    settings.restartIntroHints()
    await nextTick()
    expect(answered(settings, 'start')).toBe(true)
    tasksStore.setTasks(openCards(2))
    expect(useIntroHints().current.value).not.toBe('start')
    scope.stop()
  })
})

describe('the hint "Abschluss" (#801)', () => {
  const ended = (settings: ReturnType<typeof useSettingsStore>) => ['start', 'weiter', 'auswahl'].forEach((id) => settings.answerIntroHint(id))

  it('shows when something is done today and Jetzt is empty', () => {
    const { hints, settings } = setup([done('d')])
    ended(settings)
    expect(hints.current.value).toBe('abschluss')
  })

  it('does not show with nothing done today, nor with a card in Jetzt, nor for a card done on an earlier day', () => {
    const none = setup([task('a', TaskStatus.Open)])
    ended(none.settings)
    expect(none.hints.current.value).toBeNull()
    none.tasksStore.setTasks([done('d'), task('j', TaskStatus.Progress)])
    expect(none.hints.current.value).toBeNull() // a card in Jetzt: not the moment of "Abschluss"
    none.tasksStore.setTasks([done('old', new Date(Date.now() - 3 * 86_400_000))])
    expect(none.hints.current.value).toBeNull()
  })

  it('ends when "Tag abschließen" is opened, by any way in, and does not return', async () => {
    const { hints, settings } = setup([done('d')])
    ended(settings)
    const scope = effectScope()
    scope.run(() => useIntroHintSteps())
    expect(hints.current.value).toBe('abschluss')
    dayCloseOpen.value = true
    await nextTick()
    expect(answered(settings, 'abschluss')).toBe(true)
    dayCloseOpen.value = false
    await nextTick()
    expect(hints.current.value).toBeNull()
    scope.stop()
  })
})

describe('several hints are due together (#801)', () => {
  it('"Auswahl" comes before "Abschluss", and "Abschluss" follows on the next day after "Schließen"', () => {
    const { hints, settings } = setup([done('d'), ...openCards(INTRO_AUSWAHL_MIN_OPEN)])
    settings.answerIntroHint('start')
    settings.answerIntroHint('weiter')
    expect(hints.current.value).toBe('auswahl')
    hints.close()
    expect(hints.current.value).toBeNull() // quiet for the rest of the day
    const day = settings.introHints?.quietDay
    expect(day).toBeTruthy()
    settings.introHints!.quietDay = '2000-01-01' // the next day: no longer quiet
    expect(hints.current.value).toBe('abschluss')
  })
})
