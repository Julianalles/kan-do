/**
 * @module route-arrival
 * @description Tells `lib/routeArrival.ts` about every finished navigation, so a page can tell a cold load from an
 * arrival from another page (kd#133: the board's focus overlay waits before it appears on a return).
 */
import { arrivedFromAnotherPage, noteNavigation, isSheetRoutePath, endLoadRest } from '~/lib/routeArrival'

export default defineNuxtPlugin(() => {
  // A task or add link loaded directly opens its sheet at rest (#594): the attribute switches the sheet's CSS motion off
  // (assets/css/sheet.css) until the first close or the first move to another page
  const root = document.documentElement
  if (isSheetRoutePath(window.location.pathname)) root.setAttribute('data-load-rest', '')
  useRouter().afterEach((to, from, failure) => {
    if (failure) return
    // The start location matches no route record
    noteNavigation(from.matched.length > 0 ? from.path : null, to.path)
    if (arrivedFromAnotherPage()) endLoadRest()
  })
})
