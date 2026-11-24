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
 * - A hint's moment (`INTRO_HINT_DUE`) and its step (`INTRO_HINT_DONE`) read the board as it is; #801 adds entries
 * - Nothing here touches a task or a connection
 */
import { computed, watch } from 'vue'
import { useSettingsStore } from '~/store/settings'
import { useTasksStore } from '~/store/tasks'
import { useToday } from '~/composables/useToday'
import { useNewDay } from '~/composables/useNewDay'
import { useNewDayRecap } from '~/composables/useNewDayRecap'
import { useDayClose } from '~/composables/useDayClose'
import { boardBaseOfPath, boardPlaceOfPath, currentBoardPath } from '~/lib/boardPlace'
import { currentIntroHint, INTRO_HINT_ORDER, type IntroHintId } from '~/lib/introHints'
import { isOverlayWindow } from '~/lib/overlayWindow'
import { dayKey } from '~/utils/recapDay'

type TasksStore = ReturnType<typeof useTasksStore>

/** When a hint's moment has come. */
const INTRO_HINT_DUE: Record<IntroHintId, (tasks: TasksStore) => boolean> = {
  start: (tasks) => tasks.tasksOpen.length > 0 && tasks.tasksProgress.length === 0,
}

/** When a hint's step is done. */
const INTRO_HINT_DONE: Record<IntroHintId, (tasks: TasksStore) => boolean> = {
  start: (tasks) => tasks.tasksProgress.length > 0,
}

/** Started once in AppShell: a step done anywhere in the app ends its hint. */
export function useIntroHintSteps(): void {
  if (isOverlayWindow()) return
  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
  for (const id of INTRO_HINT_ORDER) {
    watch(
      () => settings.introHints !== null && INTRO_HINT_DONE[id](tasksStore),
      (done) => { if (done) settings.answerIntroHint(id) },
      { immediate: true },
    )
  }
}

export function useIntroHints() {
  const settings = useSettingsStore()
  const tasksStore = useTasksStore()
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

  return { active, current, shownKey, markShown, close }
}
