/**
 * @composable useAppNav
 * @description Which place of the app bar the current route belongs to (#470, ADR 017). A pure function of the
 * route: the open state of the Mehr panel is never an input, so an open panel can never replace the selected place.
 * @responsibility
 * - `placeOfPath`: `/all*` -> all ("Alle", #354: the planning side of the board page), `/tasks*` -> board (Heute), `/statistics` -> statistics, `/trash` and `/settings*` -> more (the third
 *   segment of the pill, #583: ⋯ itself is never selected), else none
 * - `thirdItemOfPath` / `thirdItem`: the page behind ⋯ the route is on (Papierkorb on `/trash*`, Einstellungen on
 *   `/settings*`, linking `/settings`), shown as a third segment in the pill and left out of the Mehr panel meanwhile
 * - `recapShown` / `selectedPlace` (#428): while the new-day recap is open the pill is `Rückblick | Statistik` on every route (no Alle, no
 *   Heute: the user is either in the recap or free to visit the planning and the board); `selectedPlace` is `'recap'` while the route is
 *   the board page the recap sits over, else `currentPlace`. Leaving the recap turns Rückblick into Alle + Heute
 * - `showsBar`: false for routes that opt out with `definePageMeta({ appNav: false })` (welcome, ui, error-test, index)
 * - Reads the live router route (`useLiveRoute`), so the selection follows the URL in the same tick
 * - `currentPlace`: the place to mark with `aria-current="page"`; `null` on a route without bar or place. `'more'`
 *   marks the third segment, never the ⋯ button
 */
import { computed } from 'vue'
import { useRouter } from 'nuxt/app'
import { recapOpen } from '~/composables/useNewDayRecap'

/** The places of the bar: "Alle" (all, #354), Heute (board), Statistik (statistics) and `more` (a page behind ⋯, shown as the third segment) */
export type AppNavPlace = 'all' | 'board' | 'statistics' | 'more'

/** What the pill marks as selected: a place, or Rückblick (#428) while the recap is open on the board page */
export type AppNavSelected = AppNavPlace | 'recap'

/** True when `path` is `base` itself or below it (`/tasks`, `/tasks/add`, but not `/tasksfoo`) */
const isUnder = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`)

/** Route path -> place. Query and hash are not part of `route.path`. */
export function placeOfPath(path: string): AppNavPlace | null {
  if (isUnder(path, '/all')) return 'all'
  if (isUnder(path, '/tasks')) return 'board'
  if (isUnder(path, '/statistics')) return 'statistics'
  if (isUnder(path, '/trash') || isUnder(path, '/settings')) return 'more'
  return null
}

/** A page behind ⋯ that the pill shows as its third segment: where it links and the i18n key of its label */
export interface ThirdItem {
  to: '/settings' | '/settings?tab=sources' | '/settings?tab=manage' | '/trash'
  labelKey: 'nav.settings' | 'nav.trash'
}

/** Route path -> third segment, or null on Heute, Statistik and routes without a place. `/settings/*` reads "Einstellungen". */
export function thirdItemOfPath(path: string): ThirdItem | null {
  if (isUnder(path, '/trash')) return { to: '/trash', labelKey: 'nav.trash' }
  if (path === '/settings' || path === '/settings/') return { to: '/settings', labelKey: 'nav.settings' }
  // Leaving a sub-page through the bar restores the tab that holds it (#691): the Notion and Erinnerungen pages sit under Speicherorte, the rest under Verwaltung
  if (isUnder(path, '/settings')) {
    return { to: isUnder(path, '/settings/notion') || isUnder(path, '/settings/reminders') ? '/settings?tab=sources' : '/settings?tab=manage', labelKey: 'nav.settings' }
  }
  return null
}

/**
 * The live vue-router route. Never `useRoute()` here: Nuxt's app-level route only syncs once the incoming page's
 * Suspense has resolved (`_route.sync()` in NuxtPage), so it still names the old page while the URL has already
 * changed. An async page (statistics) made the bar select the old place and close a panel opened in that gap (#507).
 */
export function useLiveRoute() {
  return useRouter().currentRoute
}

export function useAppNav() {
  const route = useLiveRoute()

  const showsBar = computed(() => route.value.meta.appNav !== false)
  const currentPlace = computed<AppNavPlace | null>(() => (showsBar.value ? placeOfPath(route.value.path) : null))
  /** The page behind ⋯ the pill shows as its third segment; null on a primary page, a route without place or without bar */
  const thirdItem = computed<ThirdItem | null>(() => (showsBar.value ? thirdItemOfPath(route.value.path) : null))
  /** The board page shows (Heute or Alle, one page, #354): the Ansicht options, "Tag abschließen" and the topic funnel exist only then */
  const onBoard = computed(() => currentPlace.value === 'board' || currentPlace.value === 'all')

  /** The new-day recap is open (#428): the pill shows Rückblick and Statistik instead of Alle and Heute, on every route */
  const recapShown = computed(() => showsBar.value && recapOpen.value)
  /** The place to mark: Rückblick while the recap covers the board page, else the route's place */
  const selectedPlace = computed<AppNavSelected | null>(() => (recapShown.value && onBoard.value ? 'recap' : currentPlace.value))

  return { showsBar, currentPlace, selectedPlace, recapShown, onBoard, thirdItem }
}
