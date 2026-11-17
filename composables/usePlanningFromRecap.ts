/**
 * @composable usePlanningFromRecap
 * @description Whether "Planung" was entered from the new-day flow (#416): the recap's or the notice's "Tag planen".
 * Only then the app bar pill is the one green "Weiter zum Board" link (#373); on a Planung the user opened by hand
 * (pill, palette, column link) the normal pill with its three places stays.
 * @responsibility
 * - `markPlanningFromRecap`: called by the two "Tag planen" actions before they navigate to Planung
 * - `planningFromRecap`: read-only flag; module state, set on the client only
 * - `clearPlanningFromRecap`: AppNav calls it once the route leaves Planung, so a later visit by hand shows the normal pill
 */
import { readonly, ref } from 'vue'

const fromRecap = ref(false)

export const planningFromRecap = readonly(fromRecap)

export function markPlanningFromRecap() {
  fromRecap.value = true
}

export function clearPlanningFromRecap() {
  fromRecap.value = false
}
