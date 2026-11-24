/**
 * @composable useIntroHints
 * @description The intro hints on the board (#725, base #800): which one hint shows now, and what ends it. The rules
 * are pure (`lib/introHints.ts`), the record lives in `settings-store.introHints`; this composable reads the board.
 * @responsibility
 * - `current`: the hint to show, or null. One at a time, in the order of `INTRO_HINT_ORDER`, only on "Heute" with no
 *   task sheet open, and never while a notice about the board is up (the fresh-start notice, the question about time
 *   after midnight, the recap, the day close)
 * - `close()`: "Schließen" ends the current hint and keeps the rest of the day quiet (D3 1A)
 * - `markShown()` / `shownKey`: the overlay calls it once the hint is on screen; a day is stored once per hint (three days end it)
 * - `useIntroHintSteps()`: the app-wide watcher (AppShell), so doing a hint's step ends the hint whether it was on
 *   screen or not, on any page. Never in the floating Now window: it must not write (ADR 020)
 * - A hint's moment (`INTRO_HINT_DUE`) and its step (`useIntroHintSteps`) read the board as it is: "Start" is due with cards
 *   in Offen and an empty Jetzt, "Weiter" with a card in Jetzt, "Auswahl" with four or more in Offen and an empty Jetzt,
 *   "Abschluss" with something done today and an empty Jetzt (#801). Their ends: a card in Jetzt, a card that was in
 *   Jetzt now in Erledigt or Wartet (a change, not a state: a Wartet card the board starts with ends nothing), cards
 *   stacked (`grouping.enabled`), the day-close stage opened
 * - `planDue` (#803): the hint "Planen", the planning note of "Alle" (BoardPlanNote), is due: the hints run, today is not the quiet
 *   day, it has not ended, the old note was not answered (`dayRecap.planNoteSeen`), no board notice is up and tasks wait under "Alle".
 *   The place and an empty "Heute" are BoardPlanNote's. Its step is a card planned into Offen or Jetzt (`useIntroHintSteps`)
 * - Nothing here touches a task or a connection
 */
import { computed, watch } from 'vue'
import { useDocumentVisibility, useWindowFocus } from '@vueuse/core'
import { useSettingsStore } from '~/store/settings'
import { useTasksStore } from '~/store/tasks'
import { useToday } from '~/composables/useToday'
import { useNewDay } from '~/composables/useNewDay'
import { useDayRecapStore } from '~/store/dayRecap'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { useDayClose } from '~/composables/useDayClose'
import { useBoardStore } from '~/store/board'
import { boardBaseOfPath, boardPlaceOfPath, currentBoardPath } from '~/lib/boardPlace'
import { currentIntroHint, INTRO_AUSWAHL_MIN_OPEN, INTRO_PLAN_HINT, isIntroHintLive, type IntroHintId } from '~/lib/introHints'
import { isOverlayWindow } from '~/lib/overlayWindow'
import { dayKey } from '~/utils/recapDay'
import { TaskStatus } from '~/types/taskStatus'

type TasksStore = ReturnType<typeof useTasksStore>

/** When a hint's moment has come. */
const INTRO_HINT_DUE: Record<IntroHintId, (tasks: TasksStore) => boolean> = {
  start: (tasks) => tasks.tasksOpen.length > 0 && tasks.tasksProgress.length === 0,
  weiter: (tasks) => tasks.tasksProgress.length > 0,
  auswahl: (tasks) => tasks.tasksOpen.length >= INTRO_AUSWAHL_MIN_OPEN && tasks.tasksProgress.length === 0,
  abschluss: (tasks) => tasks.tasksDoneToday.length > 0 && tasks.tasksProgress.length === 0,
}

/**
 * Started once in AppShell: a step done anywhere in the app ends its hint, whether it was on screen or not.
 * "Weiter" is the one step that is a change and not a state: it ends when a card that was in Jetzt is now in Erledigt
 * or Wartet. Read as a state, a Wartet card the board already starts with (a Notion or Erinnerungen board) would end
 * the hint unseen for a user who never ran the timer. A card that goes back to Offen ends nothing.
 */
export function useIntroHintSteps(): void {
  if (isOverlayWindow()) return
  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  const boardStore = useBoardStore()
  const { isOpen: dayCloseOpen } = useDayClose()

  const stateSteps: Record<Exclude<IntroHintId, 'weiter'> | typeof INTRO_PLAN_HINT, () => boolean> = {
    start: () => tasksStore.tasksProgress.length > 0,
    auswahl: () => boardStore.grouping.enabled,
    abschluss: () => dayCloseOpen.value,
    // "Planen" (#803): a card is planned into Offen or Jetzt. A Wartet card the board starts with ends nothing, like for "Weiter".
    [INTRO_PLAN_HINT]: () => tasksStore.tasksOpen.length + tasksStore.tasksProgress.length > 0,
  }
  for (const [id, step] of Object.entries(stateSteps) as Array<[keyof typeof stateSteps, () => boolean]>) {
    watch(
      // Unanswered and done: a restarted record (#804 "Erneut zeigen") flips this back to true while the step is
      // still done, so the new record is answered again and the hint does not show with a step that is over.
      () => settings.introHints !== null && settings.introHints.hints[id]?.answered !== true && step(),
      (done) => { if (done) settings.answerIntroHint(id) },
      { immediate: true },
    )
  }

  watch(
    () => tasksStore.tasksProgress.map((task) => task.id),
    (now, before) => {
      if (settings.introHints === null) return
      const left = before.filter((id) => !now.includes(id))
      const moved = left.some((id) => {
        const status = tasksStore.task(id)?.status
        return status === TaskStatus.Done || status === TaskStatus.Waiting
      })
      if (moved) settings.answerIntroHint('weiter')
    },
  )
}

/**
 * Somebody can see the page: it is visible and the window is focused. A hidden tab or a window left in the background keeps its
 * midnight timer running, and a weekend with the app open must not use up a hint's days; the day is stored when the page comes back.
 */
export function useHintOnScreen() {
  const visibility = useDocumentVisibility()
  const windowFocused = useWindowFocus()
  return computed(() => visibility.value === 'visible' && windowFocused.value)
}

export function useIntroHints() {
  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  const recapStore = useDayRecapStore()
  const { today } = useToday()
  const { noticeShown, timeOffer } = useNewDay()
  const { isOpen: recapOpen } = useNewDayRecap()
  const { isOpen: dayCloseOpen } = useDayClose()

  const todayKey = computed(() => dayKey(today.value))

  /** "Heute" itself: not "Alle", and no task sheet over the board. */
  const onToday = computed(() => {
    const path = currentBoardPath.value
    return boardPlaceOfPath(path) === 'today' && boardBaseOfPath(path) === path.replace(/\/$/, '')
  })

  /** A notice about the board's state comes first. */
  const noticeUp = computed(() => noticeShown.value || timeOffer.value !== null || recapOpen.value || dayCloseOpen.value)

  /** The user's hints are on (started by the welcome setup and not turned off). */
  const active = computed(() => settings.introHints?.on === true)

  const current = computed<IntroHintId | null>(() => {
    if (!onToday.value || noticeUp.value) return null
    return currentIntroHint(settings.introHints, todayKey.value, (id) => INTRO_HINT_DUE[id](tasksStore))
  })

  /** Changes whenever the hint on screen or its day changes: the overlay stores the day on each change. */
  const shownKey = computed(() => `${current.value ?? ''}:${todayKey.value}`)

  function markShown(id: IntroHintId): void {
    settings.markIntroHintShown(id, todayKey.value)
  }

  function close(): void {
    if (current.value) settings.closeIntroHint(current.value, todayKey.value)
  }

  /** "Planen" (#803), without its place: see the header. */
  const planDue = computed(() =>
    isIntroHintLive(settings.introHints, INTRO_PLAN_HINT, todayKey.value)
    && !recapStore.validPlanNoteSeen
    && !noticeUp.value
    && tasksStore.tasksNotPlanned.length > 0)

  return { active, current, shownKey, markShown, close, planDue }
}
