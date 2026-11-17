/**
 * @module lib/boardPlace
 * @description The two places of the board (#354, epic #334): "Alle" (`/all`, planning: "Meine Aufgaben" beside
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
 * A task made now starts as not planned (#367): the place "Alle" shows, also under its sheet (`/all/add`). Every
 * caller of `useTaskSync().createTask` that adds a new task to Offen passes this as the draft's `notPlanned`.
 */
export function newTaskStartsNotPlanned(): boolean {
  return boardPlaceOfPath(path.value) === 'all'
}

/**
 * Locale key of the Offen column's name on a place (#375): "Heute" on "Alle" (there the only question is whether a
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

/**
 * The pace of the next move between the places (#433): `glide` is the first move to Heute after the day's fresh start
 * (1.2 s), `lift` the move to "Alle" under the recap's lifting curtain (1.4 s). Both only name a pace: the times are
 * board.css and app-nav.css's (`html[data-place-pace]` overrides `--place-move` / `--nav-move`, so strip, column
 * titles, app bar chip and phone strip keep one clock). Runtime state only: a reload never replays a glide, and
 * reduced motion never sets one.
 */
export type PlacePace = 'glide' | 'lift'

/** The local day (key) a fresh start armed the glide for; consumed by the first move to Heute. */
let glideDay: string | null = null
/** When the recap armed the lift: it is for the move its own click starts, never a later one. */
let liftAt = 0
const LIFT_WINDOW_MS = 2000
/** The pace attribute outlives a move that never ends (a retarget, a place that did not change): this is the net. */
const PACE_NET_MS = 1800
let paceTimer: ReturnType<typeof setTimeout> | undefined

const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** A fresh start ran on `dayKey`: the next move to Heute is the day's first and glides. */
export function armGlide(dayKey: string): void {
  glideDay = dayKey
}

/** The recap's "Tag neu planen" starts the move to "Alle" next: it lifts. No-op under reduced motion. */
export function armLift(): void {
  if (!prefersReducedMotion()) liftAt = Date.now()
}

/** The pace of a move to `to` on `dayKey`, consuming what was armed: a glide only by a move to Heute on its own day. */
export function takePlacePace(to: BoardPlace, dayKey: string): PlacePace | null {
  const lifted = liftAt > 0 && Date.now() - liftAt <= LIFT_WINDOW_MS
  liftAt = 0
  if (to === 'all' && lifted) return 'lift'
  if (to === 'today' && glideDay !== null) {
    const armed = glideDay === dayKey
    glideDay = null
    if (armed && !prefersReducedMotion()) return 'glide'
  }
  return null
}

/** Put the pace on <html> for the move that starts now (null: back to the standard 420 ms); a net clears it later. */
export function setPlacePace(pace: PlacePace | null): void {
  if (typeof document === 'undefined') return
  clearTimeout(paceTimer)
  if (pace === null) {
    document.documentElement.removeAttribute('data-place-pace')
    return
  }
  document.documentElement.setAttribute('data-place-pace', pace)
  paceTimer = setTimeout(() => setPlacePace(null), PACE_NET_MS)
}

/** Test seam: nothing armed. */
export function resetPlacePace(): void {
  glideDay = null
  liftAt = 0
  setPlacePace(null)
}

/** Called by `plugins/board-place.client.ts` on every route change (and by tests that pose as a place). */
export function setCurrentBoardPath(next: string): void {
  path.value = next
}
