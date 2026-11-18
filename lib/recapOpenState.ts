import { ref } from 'vue'

/**
 * Whether the new-day recap is open (#385, #480). Module-level and shared: `useNewDayRecap` owns it, `useDayClose` reads it so the
 * day-close stage never opens over the recap (the two key moments never stand together). A module of its own, not an export of
 * `useNewDayRecap`, because that composable already imports `useDayClose` (its check waits while the stage is open).
 */
export const recapIsOpen = ref(false)
