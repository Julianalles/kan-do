/**
 * @module lib/boardPlace
 * @description The two places of the board (#354, epic #334): "Planung" (`/all`, planning: "Meine Aufgaben" beside
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

/**
 * A task made now starts as not planned (#367): the place "Planung" shows, also under its sheet (`/all/add`). Every
 * caller of `useTaskSync().createTask` that adds a new task to Offen passes this as the draft's `notPlanned`.
 */
export function newTaskStartsNotPlanned(): boolean {
  return boardPlaceOfPath(path.value) === 'all'
}

/**
 * Locale key of the Offen column's name on a place (#375): "Heute" on "Planung" (there the only question is whether a
 * task is for today), "Offen" on "Heute". The headline and the drag announcements both read it, so the visible and the
 * spoken name of the column never disagree on one place. The status itself is "Offen" everywhere (`taskStatus.open`).
 */
export function openColumnTitleKey(place: BoardPlace | null = boardPlaceOfPath(path.value)): string {
  return place === 'all' ? 'board.columns.openPlanning' : 'board.columns.open'
}

/**
 * Time and curve of the move between the places, as board.css sets them on `.board-container` (`--place-move`,
 * `--place-ease`) and any element inside it inherits them. `ms` 0 = reduced motion, or no stylesheet (a unit test).
 */
export function readPlaceMove(el: Element | null): { ms: number, easing: string } {
  if (!el) return { ms: 0, easing: 'ease' }
  const style = getComputedStyle(el)
  const raw = style.getPropertyValue('--place-move').trim()
  const value = Number.parseFloat(raw)
  const ms = Number.isNaN(value) ? 0 : raw.endsWith('ms') ? value : value * 1000
  return { ms, easing: style.getPropertyValue('--place-ease').trim() || 'ease' }
}

/** Called by `plugins/board-place.client.ts` on every route change (and by tests that pose as a place). */
export function setCurrentBoardPath(next: string): void {
  path.value = next
}
