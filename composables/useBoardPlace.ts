/**
 * @composable useBoardPlace
 * @description Which place of the board shows (#354): "Planung" on `/all*`, "Heute" otherwise. Reads the path
 * `plugins/board-place.client.ts` mirrors from the live router route (`lib/boardPlace.ts`), so it follows the URL in
 * the same tick as the app bar's selection and needs no router itself.
 * @responsibility
 * - `place` / `isAll`: the place the board page shows; off the board page it reads `today`
 * - `basePath`: the path a task sheet or the add flow opens under, so a sheet opened on "Planung" closes back to "Planung"
 * - `boardBasePath()`: the same as a one-off read for handlers outside a component (a toast action, the palette)
 * - `todayLocation()`: the navigation target of "go to Heute" for callers that may stand on "Planung"
 */
import { computed } from 'vue'
import { BOARD_PLACE_PATHS, boardBaseOfPath, boardPlaceLocation, boardPlaceOfPath, currentBoardPath, type BoardPlace } from '~/lib/boardPlace'

/** One-off read: `/all` while "Planung" shows, else `/tasks`. */
export function boardBasePath(): string {
  return boardBaseOfPath(currentBoardPath.value)
}

/**
 * Where "go to Heute" leads from anywhere (the palette, the menu bar): the forced location while "Planung" shows
 * (a plain `/tasks` is a redundant navigation there and does nothing), the plain path otherwise.
 */
export function todayLocation(): string | { path: string, force: true } {
  return boardPlaceOfPath(currentBoardPath.value) === 'all' ? boardPlaceLocation('today') : BOARD_PLACE_PATHS.today
}

export function useBoardPlace() {
  const place = computed<BoardPlace>(() => boardPlaceOfPath(currentBoardPath.value) ?? 'today')
  const isAll = computed(() => place.value === 'all')
  const basePath = computed(() => boardBaseOfPath(currentBoardPath.value))
  return { place, isAll, basePath }
}
