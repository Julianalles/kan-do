/**
 * @module route-preload
 * @description Fetches the Statistik route's code in idle time after startup (#376). The nav links are `<NuxtLink custom>`,
 * which never get Nuxt's visible-link prefetch, so the first open otherwise fetched ~25 chunks (a request waterfall) on the
 * click. Failure is swallowed: the click then loads the route as before.
 */
import { isOverlayWindow } from '~/lib/overlayWindow'

export default defineNuxtPlugin((nuxtApp) => {
  // The floating Now window (#383) never opens the Statistik route
  if (isOverlayWindow()) return
  const preload = () => {
    void preloadRouteComponents('/statistics').catch(() => {})
  }
  nuxtApp.hooks.hookOnce('app:suspense:resolve', () => {
    // After the board's first paint: idle, with a timeout fallback for browsers without requestIdleCallback
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preload, { timeout: 4000 })
    else setTimeout(preload, 2000)
  })
})
