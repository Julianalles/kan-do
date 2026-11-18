/**
 * @composable useDayClose
 * @description Shared open state and read-only data for the day-close stage (#98, #480). The Mehr panel row, the Erledigt CTA, the
 * native menu and the command palette open the same stage (mounted once in pages/tasks.vue); no route, nothing persisted.
 * `useDayCloseData` selects what the sheet shows from the tasks store and never mutates it.
 * @responsibility Open/close, focus capture and restore; `freeze()` copies the day as the sheet showed it when the user
 * pressed "Tag abschließen", so the sheet keeps its content while the curtain plays over the emptied board. This composable acts
 * on nothing: the one action with an effect is `useDayCloseAction().finishDay` (kept apart so a caller that only opens the
 * stage, like the palette, never pulls the sync path in). `open()` does nothing while the new-day recap is open. Today's done tasks and the Offen/Jetzt/Wartet tasks as the sheet's data.
 */
import { computed, readonly, ref } from 'vue'
import { useTasksStore } from '~/store/tasks'
import { recapIsOpen } from '~/lib/recapOpenState'
import type { Task } from '~/types/task'

// Module-level: one stage per app. `typeof document` guards (not import.meta.client) keep this unit-testable.
const isOpen = ref(false)
let returnFocusTo: HTMLElement | null = null

/** The day as the sheet showed it when "Tag abschließen" was pressed: taking the tasks off must not empty the sheet while it leaves. */
const closing = ref<{ done: Task[], inFlight: Task[] } | null>(null)

export function useDayClose() {
  const tasksStore = useTasksStore()

  /**
   * Opens the stage. Never over the new-day recap: the two key moments do not stand together (both own `#recap-stage-host` and
   * `data-recap-stage`, and the morning's close would take the board off under the recap), so with the recap open it does nothing.
   */
  function open(): void {
    if (recapIsOpen.value || isOpen.value) return
    returnFocusTo = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null
    closing.value = null
    isOpen.value = true
  }

  /** Dismisses the stage; plain `close` has no side effect (Esc, "Abbrechen, nichts ändert sich", leaving the page). */
  function close(): void {
    isOpen.value = false
  }

  /** Copies the day as the sheet shows it now, for the sheet to keep while the curtain plays (`useDayCloseData` reads it until the next `open()`). */
  function freeze(): void {
    closing.value = {
      done: tasksStore.tasksDoneToday.map(task => ({ ...task })),
      inFlight: [...tasksStore.tasksOpen, ...tasksStore.tasksProgress, ...tasksStore.tasksWaiting].map(task => ({ ...task })),
    }
  }

  /**
   * Called after the leave animation. Focus goes back to the trigger; when there is none (the palette
   * that opened the stage is gone) it goes to the board, never to <body>.
   */
  function restoreFocus(): void {
    if (typeof document === 'undefined') return
    const trigger = returnFocusTo
    returnFocusTo = null
    if (trigger?.isConnected && trigger !== document.body) {
      trigger.focus({ preventScroll: true })
      return
    }
    focusBoard()
  }

  return { isOpen: readonly(isOpen), open, close, freeze, restoreFocus }
}

/** The board region gets focus when nothing else holds it, never <body>. */
export function focusBoard(): void {
  if (typeof document === 'undefined') return
  const board = document.querySelector<HTMLElement>('[data-task-sheet-return]')
  if (!board) return
  board.setAttribute('tabindex', '-1')
  board.addEventListener('blur', () => board.removeAttribute('tabindex'), { once: true })
  board.focus({ preventScroll: true })
}

/** What the sheet shows. Reads the local cache only; recomputes when a sync lands; after "Tag abschließen" it keeps the confirmed day until the next `open()`. */
export function useDayCloseData() {
  const tasksStore = useTasksStore()

  /** Completed today (local day), archived excluded: the store's own "done today" rule. */
  const done = computed(() => closing.value?.done ?? tasksStore.tasksDoneToday)
  /** Offen, Jetzt, Wartet in column order. */
  const inFlight = computed(() => closing.value?.inFlight ?? [
    ...tasksStore.tasksOpen,
    ...tasksStore.tasksProgress,
    ...tasksStore.tasksWaiting,
  ])

  return { done, inFlight }
}
