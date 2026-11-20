import { nextTick } from 'vue'
import { MOTION } from '~/lib/motionTokens'

/**
 * The glide of the board (#610, #642): when a state change re-lays the board (turning "Karten stapeln" or the group-by
 * property on or off, picking or ending a topic focus, a card that changes column through `moveOrSwapToStatus`: the sheet, the context menu, the palette, #661), every card moves from its old place to its new one over
 * `MOTION.slowMs` instead of jumping in one frame (DESIGN.md "The One Piece Rule"). Purely visual: the change is
 * instant and final, nothing waits for the glide.
 *
 * - `around(change)` reads the rects of the column items and the heights of the column lists, runs `change`, waits
 *   for the DOM (`nextTick`) and plays a FLIP: an item that exists before and after glides (`transform`), one that
 *   is new fades in, one that is gone is gone at once; a list whose height changed animates its height so everything
 *   below it follows; a column footer that arrives grows from nothing (height and padding) and fades in, so the board
 *   and the page above it take its height over the glide and not in one frame (#671).
 * - Only what is on screen before or after the change animates (a long column is not a thousand animations).
 * - A change started while a glide runs reads the rects as they are drawn right now, so it continues from the
 *   current place and nothing jumps; a `pointerdown` or a key press (the start of a drag), or `cancelBoardGlide()`
 *   (unmount) ends every glide at its final state, so dnd-kit never measures a transformed card.
 * - Under `prefers-reduced-motion` (checked here: scripted animations are not covered by the global CSS rule) and
 *   outside the browser the change runs as it is.
 */

/** The items of a column's list and of the place "Alle"'s side list: cards, stacks, headers, gaps, dividers */
const ITEMS = '.task-list > *, .not-planned__grid > *'
/** The lists whose height follows their items */
const LISTS = '.task-list'
/** A column's footer ("Tag abschließen" under the done cards): it comes and goes with the column's cards, and its box takes its height with it */
const FOOTERS = '.column-footer'

const running = new Set<Animation>()
let listening = false

/** Ends every running glide at its final state (a drag starts, the board unmounts) */
export function cancelBoardGlide(): void {
  for (const animation of [...running]) animation.cancel()
  running.clear()
  stopListening()
}

function stopListening(): void {
  if (!listening || typeof window === 'undefined') return
  window.removeEventListener('pointerdown', cancelBoardGlide, true)
  window.removeEventListener('keydown', cancelBoardGlide, true)
  listening = false
}

function startListening(): void {
  if (listening) return
  window.addEventListener('pointerdown', cancelBoardGlide, true)
  window.addEventListener('keydown', cancelBoardGlide, true)
  listening = true
}

/** No glide without Web Animations (jsdom) or when the user asks for reduced motion (scripted animations are not covered by the global CSS rule) */
const reducedMotion = (): boolean =>
  typeof Element.prototype.animate !== 'function'
  || (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)

const taskIdOf = (el: Element): string | null => el.getAttribute('data-task-id') ?? el.querySelector('[data-task-id]')?.getAttribute('data-task-id') ?? null

function onScreen(rect: DOMRect): boolean {
  return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth
}

/**
 * One box that changes its own height with a state change (a card that grows from its title phase to its question
 * steps): runs `change`, and the box's height glides from the old to the new value over `MOTION.slowMs`; whatever
 * follows it in the flow glides with it. Same rules as `around`: reduced motion and the server run the change as it is.
 */
export async function glideHeight(el: HTMLElement | null, change: () => void): Promise<void> {
  if (typeof window === 'undefined' || !el || reducedMotion()) return change()
  const was = el.getBoundingClientRect().height
  change()
  await nextTick()
  const now = el.getBoundingClientRect().height
  if (Math.abs(was - now) < 1) return
  // `minHeight` too: a box whose new size comes from a `min-height` rule would otherwise snap to it while its height animates
  el.animate({ height: [`${was}px`, `${now}px`], minHeight: [`${was}px`, `${now}px`] }, { duration: MOTION.slowMs, easing: MOTION.standard, fill: 'none' })
}

/** A box that arrives with a state change takes its size from nothing (height, padding) while it fades in: what lies around it gets the room over the glide */
function growIn(el: HTMLElement, options: KeyframeAnimationOptions): Animation {
  const box = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return el.animate({
    height: ['0px', `${box.height}px`],
    paddingTop: ['0px', style.paddingTop],
    paddingBottom: ['0px', style.paddingBottom],
    opacity: [0, 1],
    overflow: ['hidden', 'hidden'],
  }, options)
}

export function useBoardGlide() {
  async function around(change: () => void): Promise<void> {
    if (typeof window === 'undefined' || reducedMotion()) return change()

    // Read first: a running glide is part of the rect, so a repeated change continues from where the card is drawn
    const before = new Map<Element, DOMRect>()
    const byTask = new Map<string, DOMRect>()
    for (const el of document.querySelectorAll(ITEMS)) {
      const rect = el.getBoundingClientRect()
      before.set(el, rect)
      const id = taskIdOf(el)
      if (id) byTask.set(id, rect)
    }
    const heights = new Map<Element, number>()
    for (const list of document.querySelectorAll(LISTS)) heights.set(list, list.getBoundingClientRect().height)
    const footersBefore = new Set(document.querySelectorAll(FOOTERS))
    cancelBoardGlide()

    change()
    await nextTick()

    const animations: Animation[] = []
    const options = { duration: MOTION.slowMs, easing: MOTION.standard, fill: 'none' as const }
    // First, so the lists below measure the board with the footer at its first keyframe: what stretches with the board follows the footer's growth
    for (const footer of document.querySelectorAll<HTMLElement>(FOOTERS)) {
      if (footersBefore.has(footer) || !onScreen(footer.getBoundingClientRect())) continue
      animations.push(growIn(footer, options))
    }
    for (const el of document.querySelectorAll<HTMLElement>(ITEMS)) {
      const now = el.getBoundingClientRect()
      const was = before.get(el) ?? (() => { const id = taskIdOf(el); return id ? byTask.get(id) : undefined })()
      if (!was) {
        if (onScreen(now)) animations.push(el.animate({ opacity: [0, 1] }, options))
        continue
      }
      const dx = was.left - now.left
      const dy = was.top - now.top
      if ((!dx && !dy) || (!onScreen(was) && !onScreen(now))) continue
      animations.push(el.animate({ transform: [`translate(${dx}px, ${dy}px)`, 'none'] }, options))
    }
    for (const list of document.querySelectorAll<HTMLElement>(LISTS)) {
      const was = heights.get(list)
      const now = list.getBoundingClientRect().height
      if (was === undefined || Math.abs(was - now) < 1) continue
      // A list that fills its column (`flex: 1`) ignores `height`: the basis carries the size, with the flex factors held off
      animations.push(list.animate({ height: [`${was}px`, `${now}px`], flexBasis: [`${was}px`, `${now}px`], flexGrow: [0, 0], flexShrink: [0, 0] }, options))
    }
    if (!animations.length) return
    startListening()
    for (const animation of animations) {
      running.add(animation)
      const done = () => {
        running.delete(animation)
        if (!running.size) stopListening()
      }
      animation.addEventListener('finish', done)
      animation.addEventListener('cancel', done)
    }
  }
  return { around }
}
