import { useBoardSetup } from '~/composables/useBoardSetup'

/**
 * /welcome is the first-run page (#561): a board that is already set up (example tasks or started fresh) that
 * requests it (bookmark, typed address, history) goes to Heute instead. A board that is not set up, and App reset
 * (it clears the state before it reloads onto /welcome), still get the page. A request with `?code=` is the
 * Todoist OAuth callback (`middleware/todoistOAuth.ts`) and is left alone.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.query.code) return
  if (useBoardSetup().isSetUp()) return navigateTo('/tasks', { replace: true })
})
