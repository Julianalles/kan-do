/**
 * @composable usePlanMoves
 * @description The two moves of the place "Alle" (#354, epic #334) as the user sees them: "Für heute einplanen"
 * (a "Alle Aufgaben" card lands in "Für heute": at the end of Offen's own cards, or, for a waiting task (#793), behind
 * the other Wartet cards of "Für heute" on "Alle", #797, #815) and "Nicht für heute planen" (a "Für heute" card goes back to the top of
 * "Alle Aufgaben"). The state change is `useTaskSync.planTask` / `unplanTask`; this adds the motion and the
 * screen-reader line.
 * @responsibility
 * - Desktop: the card travels from where it was to where it now is (FLIP on the card, 360 ms on the bar's curve)
 * - Phone: the other column is on another page, so the card slides out towards it first (a pick to the right,
 *   "Nicht für heute planen" to the left, 200 ms on the standard curve, #334 D8), then the state changes and the list closes the gap
 * - Reduced motion: no motion, the state changes at once
 * - `announcement`: one polite line per move, rendered by Board.vue's live region
 * - A second request for a card that is still leaving is ignored (a double click plans once)
 * - A source that plans by date (Apple Reminders, #553) gets its toasts from `usePlanToasts` after each move
 * - `planMany(ids)` (#702, "Alle für heute einplanen"): the same motion per card, but one `useTaskSync.planTasks` for all (one
 *   reconcile; a source that stores planning is written one task after another, never in parallel), one screen-reader
 *   line for the lot and no per-task toast: the caller says it once
 */
import { nextTick, ref } from 'vue'
import { useTaskSync } from '~/composables/useTaskSync'
import { usePlanToasts } from '~/composables/usePlanToasts'
import { useTasksStore } from '~/store/tasks'
import { isPhoneNow } from '~/composables/useIsDesktop'
import { translate } from '~/lib/i18n'
import { MOTION } from '~/lib/motionTokens'

/** The card's slide out of its page on a phone (#334 D8). */
export const PLAN_SLIDE_MS = 200
/** The card's travel across to the other column on desktop. */
export const PLAN_FLY_MS = 360

/** Read by Board.vue's live region; a repeat of the same sentence is still announced (the region re-renders it). */
const announcement = ref('')
const leaving = new Set<string>()

const reducedMotion = (): boolean =>
  typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches

const escapeId = (id: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id)
const notPlannedItem = (id: string) => document.querySelector<HTMLElement>(`[data-not-planned-id="${escapeId(id)}"]`)
/** The card of a planned task in "Für heute" on "Alle" or in Offen: the Jetzt and Wartet cards of "Alle" stand in `#column-open` as well (#797) */
const openCard = (id: string) => document.querySelector<HTMLElement>(`#column-open .task-wrapper[data-task-id="${escapeId(id)}"]`)

/** Phone: the card leaves its page sideways; resolves when it is out (or at once without motion). */
async function slideOut(el: HTMLElement | null, direction: 1 | -1): Promise<void> {
  if (!el || reducedMotion() || typeof el.animate !== 'function') return
  const box = el.getBoundingClientRect()
  const distance = direction === 1 ? window.innerWidth - box.left : box.right
  try {
    await el.animate(
      [{ transform: 'translateX(0)', opacity: 1 }, { transform: `translateX(${direction * distance}px)`, opacity: 0.6 }],
      { duration: PLAN_SLIDE_MS, easing: MOTION.standard, fill: 'forwards' },
    ).finished
  } catch {
    // Cancelled (the card left the DOM): the state change still happens
  }
}

/** Desktop: the card travels from `from` to the box `find()` has after the state change. */
async function fly(from: DOMRect | null, find: () => HTMLElement | null): Promise<void> {
  if (!from || reducedMotion()) return
  await nextTick()
  const el = find()
  if (!el || typeof el.animate !== 'function') return
  // A card put back flies into "Alle Aufgaben": that side lifts above Offen meanwhile (board.css).
  const side = el.closest<HTMLElement>('#column-not-planned')
  // A card put back lands on top of "Alle Aufgaben". With the page scrolled down that is out of view: the page stays where
  // it is (the user keeps their place in Offen; the toast says what happened) and nothing flies to a place nobody sees (#609)
  const to = el.getBoundingClientRect()
  if (side && (to.bottom <= 0 || to.top >= window.innerHeight)) return
  const dx = from.left - to.left
  const dy = from.top - to.top
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  side?.classList.add('is-receiving')
  el.classList.add('plan-flying')
  const done = () => {
    el.classList.remove('plan-flying')
    side?.classList.remove('is-receiving')
  }
  el.animate(
    [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
    // the place curve of the app bar and the board (`--nav-ease`, app-nav.css): it has no token (#593)
    { duration: PLAN_FLY_MS, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  ).finished.then(done, done)
}

export function usePlanMoves() {
  async function move(id: string, kind: 'plan' | 'unplan'): Promise<boolean> {
    // Resolved per move, not per caller: every Offen card on "Alle" holds this composable for its arrow
    const { planTask, unplanTask } = useTaskSync()
    const { afterPlan, afterPutBack } = usePlanToasts()
    const task = useTasksStore().task(id)
    if (!task || leaving.has(id)) return false
    const source = () => (kind === 'plan' ? notPlannedItem(id) : openCard(id))
    const target = () => (kind === 'plan' ? openCard(id) : notPlannedItem(id))
    let from: DOMRect | null = null
    if (typeof document !== 'undefined') {
      if (isPhoneNow()) {
        leaving.add(id)
        try {
          await slideOut(source(), kind === 'plan' ? 1 : -1)
        } finally {
          leaving.delete(id)
        }
      } else {
        from = source()?.querySelector('.task')?.getBoundingClientRect() ?? null
      }
    }
    const changed = kind === 'plan' ? planTask(id) : unplanTask(id)
    if (!changed) return false
    announcement.value = translate(kind === 'plan' ? 'board.notPlanned.planned' : 'board.notPlanned.unplanned', { title: task.title })
    void fly(from, () => target()?.querySelector<HTMLElement>('.task') ?? null)
    // A source that plans by date says what happened to its date (#553); the toast waits for the write, the move does not
    if (kind === 'plan') void afterPlan(id)
    else void afterPutBack(id)
    return true
  }

  /**
   * "Für heute einplanen": the task lands at the end of Offen's own cards; a waiting task keeps Wartet (#793) and lands behind the
   * Wartet cards "Für heute" lists on "Alle" (#797), which are in `#column-open` too, so the same lookup finds it (#815).
   */
  const planForToday = (id: string) => move(id, 'plan')
  /** "Nicht für heute planen": the Offen task goes to the top of "Alle Aufgaben". */
  const notToday = (id: string) => move(id, 'unplan')

  /**
   * Several cards at once (#702): every card moves as in `planForToday`, the state changes in one `planTasks` call, so the
   * writes of a source that stores planning go out in the order given, one after another. Raises no toast (the caller
   * does, once). Resolves to the ids that moved: a card still leaving, or a task that is gone, is left out.
   */
  async function planMany(ids: readonly string[]): Promise<string[]> {
    const { planTasks } = useTaskSync()
    const tasksStore = useTasksStore()
    const wanted = ids.filter(id => tasksStore.task(id) !== undefined && !leaving.has(id))
    const from = new Map<string, DOMRect | null>()
    if (typeof document !== 'undefined') {
      if (isPhoneNow()) {
        for (const id of wanted) leaving.add(id)
        try {
          await Promise.all(wanted.map(id => slideOut(notPlannedItem(id), 1)))
        } finally {
          for (const id of wanted) leaving.delete(id)
        }
      } else {
        for (const id of wanted) from.set(id, notPlannedItem(id)?.querySelector('.task')?.getBoundingClientRect() ?? null)
      }
    }
    const moved = planTasks(wanted.filter(id => tasksStore.task(id) !== undefined))
    if (moved.length === 0) return moved
    announcement.value = translate('board.notPlanned.plannedMany', { n: moved.length }, moved.length)
    for (const id of moved) void fly(from.get(id) ?? null, () => openCard(id)?.querySelector<HTMLElement>('.task') ?? null)
    return moved
  }

  return { planForToday, notToday, planMany, announcement }
}
