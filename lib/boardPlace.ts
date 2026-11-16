/**
 * @module lib/boardPlace
 * @description The two places of the board (#354, epic #334): "Alle" (`/all`, planning: "Nicht geplant" beside
 * Offen) and "Heute" (`/tasks`, the board). Both are paths of one page (`pages/tasks.vue`, `alias: ['/all']`), so
 * the board stays mounted and Offen is the same column in both. Path helpers plus the current path as module state:
 * `plugins/board-place.client.ts` mirrors the live router route into it (sync, so it changes in the same tick as the
 * app bar's selection), and `composables/useBoardPlace.ts` reads it. The board's composables therefore know the place
 * without importing the router, and outside the app (a unit test) the place is Heute.
 */
import { readonly, ref } from 'vue'

export type BoardPlace = 'all' | 'today'

export const BOARD_PLACE_PATHS: Record<BoardPlace, string> = { all: '/all', today: '/tasks' }

const isUnder = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`)

/** The board place a path belongs to (`/all`, `/all/<id>`, `/tasks`, `/tasks/add`, …), or null off the board. */
export function boardPlaceOfPath(path: string): BoardPlace | null {
  if (isUnder(path, BOARD_PLACE_PATHS.all)) return 'all'
  if (isUnder(path, BOARD_PLACE_PATHS.today)) return 'today'
  return null
}

/** Where a sheet or the add flow opens from `path`: under the place that is showing, `/tasks` anywhere else. */
export function boardBaseOfPath(path: string): string {
  return BOARD_PLACE_PATHS[boardPlaceOfPath(path) ?? 'today']
}

/**
 * The route location of a place. `force`: `/all` is an alias of `/tasks`, and vue-router calls a move between an
 * alias and its original redundant (same record, same params) and does nothing without it.
 */
export function boardPlaceLocation(place: BoardPlace): { path: string, force: true } {
  return { path: BOARD_PLACE_PATHS[place], force: true }
}

const path = ref<string>(BOARD_PLACE_PATHS.today)

/** The path the router is on (without query and hash); `/tasks` until the plugin has set it. */
export const currentBoardPath = readonly(path)

/** Called by `plugins/board-place.client.ts` on every route change (and by tests that pose as a place). */
export function setCurrentBoardPath(next: string): void {
  path.value = next
}
