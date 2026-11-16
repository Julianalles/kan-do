/**
 * @module board-place
 * @description Mirrors the live router route's path into `lib/boardPlace.ts` (#354), so the board knows whether
 * "Alle" (`/all`) or "Heute" (`/tasks`) shows without its composables importing the router. Sync flush: the place
 * changes in the same tick as `router.currentRoute`, as the app bar's selection does (`useLiveRoute`, #507), and
 * never lags behind like Nuxt's `useRoute()`.
 */
import { watch } from 'vue'
import { setCurrentBoardPath } from '~/lib/boardPlace'

export default defineNuxtPlugin(() => {
  watch(() => useRouter().currentRoute.value.path, setCurrentBoardPath, { immediate: true, flush: 'sync' })
})
