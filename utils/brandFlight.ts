import { BREAKPOINT_QUERIES } from '~/lib/breakpoints'

/**
 * @module brandFlight
 * @description The finish of the welcome page (#437): the "kan-do" brand on the page flies to the brand in the app bar
 * while the page fades out beneath it. Desktop only (the bar hides its brand on a phone), skipped under reduced
 * motion, and never in the way of the navigation: when the bar's brand does not show up in time the clone is dropped
 * and the page just fades, as before.
 *
 * Technique (spec decision D1): the page's brand is cloned into a fixed layer above the fading page (the page leaves
 * as a fixed layer above the bar, `transitions.css`), the original is hidden, and the clone is moved onto the bar's
 * brand with a WAAPI translate and scale (FLIP). The real bar brand stays hidden until the clone lands, so the word
 * is never doubled. Nothing here touches `AppNav`: it only reads the brand text inside `[data-testid="app-nav-brand"]`.
 */

/** How long the bar may take to mount its brand after the navigation started */
export const TARGET_WAIT_MS = 800
/** The flight's duration: the page's slow beat (`--duration-slow`, 300 ms) */
const FLIGHT_MS = 420
const TARGET_SELECTOR = '[data-testid="app-nav-brand"] .app-nav-brand-text'

/** The rectangle of an element's text (the element itself may span the whole row) */
function textRect(el: HTMLElement): DOMRect {
  const range = document.createRange()
  range.selectNodeContents(el)
  return range.getBoundingClientRect()
}

/** The bar's brand once it is mounted and visible (not on a phone), or null when it does not show up in time */
function waitForTarget(): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = performance.now()
    const look = () => {
      const target = document.querySelector<HTMLElement>(TARGET_SELECTOR)
      if (target && target.getClientRects().length > 0 && textRect(target).width > 0) return resolve(target)
      if (performance.now() - start > TARGET_WAIT_MS) return resolve(null)
      requestAnimationFrame(look)
    }
    look()
  })
}

/**
 * Start the flight from `from` (the page's brand element) toward the app bar brand. Call it right before the
 * navigation; it returns at once. Safe to call anywhere: without a browser, with reduced motion or on a phone it does nothing.
 */
export function flyBrandToBar(from: HTMLElement | null | undefined): void {
  if (!import.meta.client || !from) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // The bar's brand is hidden on a phone (below the desktop step): the page just fades
  if (!window.matchMedia(BREAKPOINT_QUERIES.desktop).matches) return

  const rect = textRect(from)
  if (rect.width === 0) return
  const style = getComputedStyle(from)

  const clone = document.createElement('div')
  clone.textContent = from.textContent?.trim() ?? ''
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('data-testid', 'brand-flight')
  Object.assign(clone.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    margin: '0',
    padding: '0',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    // Above the fading page, which sits one layer above the bar
    zIndex: 'calc(var(--z-bar) + 2)',
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    letterSpacing: style.letterSpacing,
    lineHeight: `${rect.height}px`,
    color: style.color,
  })
  document.body.appendChild(clone)
  from.style.visibility = 'hidden'
  const root = from.closest<HTMLElement>('.welcome-root')
  root?.setAttribute('data-brand-flying', '')

  waitForTarget().then((target) => {
    const finish = () => {
      root?.removeAttribute('data-brand-flying')
      clone.remove()
      if (target) target.style.visibility = ''
    }
    if (!target) {
      // No bar brand in time: leave as the plain fade does (the page is already fading; take the clone with it)
      clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FLIGHT_MS / 2, fill: 'forwards' }).finished.then(finish, finish)
      return
    }
    const to = textRect(target)
    target.style.visibility = 'hidden'
    const scale = to.width / rect.width
    const dx = to.left - rect.left
    // The scaled clone's top-left lands so that its text centre sits on the bar brand's text centre
    const dy = to.top + to.height / 2 - (rect.top + (rect.height * scale) / 2)
    clone
      .animate(
        [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
        { duration: FLIGHT_MS, easing: 'cubic-bezier(.3,.8,.3,1)', fill: 'forwards' },
      )
      .finished.then(finish, finish)
  })
}
