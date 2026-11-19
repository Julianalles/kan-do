/**
 * @module routeArrival
 * @description Whether the app has moved between pages since it loaded (kd#133). A component that mounts after that
 * was reached from another page, not by a cold load: the board then lets its focus overlay wait before it appears.
 * `plugins/route-arrival.client.ts` feeds it from the router; the state lives as long as the page load.
 */
import { ref } from 'vue'

let navigated = false
/** Bumped when the direct-load rest ends (the first close or the first move to another page): AddTaskSlot's draft watches it (#594) */
export const loadRestEnds = ref(0)

/** Ends the direct-load rest: from here the sheet's motion runs as usual, so a close animates (#594) */
export function endLoadRest(): void {
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-load-rest')
  loadRestEnds.value++
}

/**
 * Called for every finished navigation with the path it left (`null`: the router's start location) and the path it
 * reached. Still the cold load: leaving the start location or the empty redirect page `/`, and a navigation that
 * stays on its path (Nuxt replaces the first route with itself once the app is up; a query change). Every other counts.
 */
export function noteNavigation(fromPath: string | null, toPath: string): void {
  if (fromPath !== null && fromPath !== '/' && fromPath !== toPath) navigated = true
}

/** True once the app has left a real page: what mounts now was arrived at by in-app navigation */
export function arrivedFromAnotherPage(): boolean {
  return navigated
}

/** Tests only */
export function resetRouteArrival(): void {
  navigated = false
  loadRestEnds.value = 0
}

/** A sheet route: /tasks/:id, /tasks/add (and the same under /all and /statistics): a link to it opens a sheet on load (#594) */
export function isSheetRoutePath(path: string): boolean {
  return /^\/(tasks|all|statistics)\/[^/]+/.test(path)
}
