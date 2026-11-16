/**
 * @module lib/appPresence
 * @description Whether the user is in the app window or away from it (#356, D3 o). "Away" starts when the document
 * turns hidden or the window loses the focus, and lasts until it is shown or focused again. A glance at another
 * window is not leaving: the user counts as away only once the absence has lasted `AWAY_GRACE_MS`.
 * Two readers: the timer driver tags each counted second with it (a second counted while away is the only kind a
 * new day asks about), and the board page asks whether a return followed a real absence (the new day starts
 * on the app's start and on such a return, never while the user works in the window).
 * Runtime only, plain TypeScript, no store.
 */

/** How long a window may be left before the user counts as away (a glance at another window stays below it). */
export const AWAY_GRACE_MS = 60_000

/** A focus and a visibility event of one return arrive together: the second one reads the first one's answer. */
const SAME_RETURN_MS = 1000

let awaySince: number | null = null
let lastReturn: { at: number; absenceMs: number } | null = null
let startPending = true
let stopListening: (() => void) | null = null

const leave = () => {
  if (awaySince === null) awaySince = Date.now()
}

/** The window is shown or focused again: the absence ends and is remembered for the handlers of this return. */
const back = (now: number) => {
  if (awaySince === null) return
  lastReturn = { at: now, absenceMs: now - awaySince }
  awaySince = null
}

/** Begins watching the window. Idempotent. Browser only. */
export function startPresence(): void {
  if (typeof window === 'undefined' || stopListening) return
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') leave()
    else back(Date.now())
  }
  const onFocus = () => back(Date.now())
  window.addEventListener('blur', leave)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisibility)
  stopListening = () => {
    window.removeEventListener('blur', leave)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  // An app opened in a background tab starts away
  if (document.visibilityState === 'hidden') leave()
}

export function stopPresence(): void {
  stopListening?.()
  stopListening = null
  awaySince = null
  lastReturn = null
}

/** Test seam: a fresh page load. */
export function resetPresence(): void {
  stopPresence()
  startPending = true
}

/** True from `AWAY_GRACE_MS` after the window was left until it is back. */
export function isAway(now: number = Date.now()): boolean {
  return awaySince !== null && now - awaySince >= AWAY_GRACE_MS
}

/**
 * Whether this return to the app follows a real absence (focus and visibility events of one return answer the same).
 * A return whose leaving was never seen (the page loaded in the background, a synthetic event) counts as one: the
 * answer errs towards the old behaviour. Call it from the handler of the focus or visibility event.
 */
export function returnedAfterAbsence(now: number = Date.now()): boolean {
  // Whichever listener runs first, the absence is closed exactly once and remembered for the events of this return
  back(now)
  if (lastReturn === null || now - lastReturn.at > SAME_RETURN_MS) {
    lastReturn = null
    return true
  }
  return lastReturn.absenceMs >= AWAY_GRACE_MS
}

/** True once per page load: the first board of an app start is "the app was opened"; later mounts are navigation. */
export function takeAppStart(): boolean {
  const first = startPending
  startPending = false
  return first
}
