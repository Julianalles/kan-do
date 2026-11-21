/**
 * Overflow of the task sheet's property strip (#705): the strip clips its chips to two lines, and the "Eigenschaften" button
 * shows how many did not fit. Pure geometry; the strip measures its chips and asks here.
 */

/** How many chips lie fully below `limit` (the bottom of the strip's second line), in the order the strip lays them out. */
export const hiddenChipCount = (tops: number[], limit: number): number => tops.filter((top) => top >= limit).length;
