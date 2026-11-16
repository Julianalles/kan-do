/**
 * @composable useOpenCapacityLine
 * @description What Offen's capacity line (#132) says right now, for a reader outside the column (#354: the echo of
 * the line on "Alle", BoardCapacityEcho). The live Offen column publishes what it renders (`publish`, from its own
 * list items, `capacityLineState`), so the echo follows the topic focus, the sorting and the stacks and never
 * calculates a second line.
 * @responsibility One shared state per app (one live Offen column); the maths stays in `lib/dayCapacity` and `useDayCapacity`.
 */
import { readonly, ref } from 'vue'
import type { ColumnItem } from '~/types/columnItem'
import { capacityLineState, type CapacityLineState } from '~/utils/columnItems'

const openLine = ref<CapacityLineState>({ full: false, below: 0 })

export function useOpenCapacityLine() {
  function publish(items: readonly ColumnItem[]) {
    const next = capacityLineState(items)
    if (next.full !== openLine.value.full || next.below !== openLine.value.below) openLine.value = next
  }
  return { line: readonly(openLine), publish }
}
