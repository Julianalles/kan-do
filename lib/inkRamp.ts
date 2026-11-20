/**
 * @module lib/inkRamp
 * @description The chart palette of the Statistik page (#469, DESIGN.md "Components"): the ink (`--ui-text-highlighted`) at six
 * strengths, darkest = largest. Charts never take a hue; a topic's own hue stays on its mark.
 */

/** Share of the ink per ramp step, step 0 first. */
export const INK_STEPS = [100, 72, 50, 32, 18, 10] as const

/** The CSS colour of a ramp step (clamped to the ramp). */
export function inkColor(step: number): string {
  const index = Math.min(Math.max(Math.trunc(step), 0), INK_STEPS.length - 1)
  const share = INK_STEPS[index]!
  return share === 100 ? 'var(--ui-text-highlighted)' : `color-mix(in srgb, var(--ui-text-highlighted) ${share}%, transparent)`
}

/**
 * The three estimate groups (#604): how a done task's time compares with its timebox. One source for the Statistik ring
 * (`StatsEstimateRing`) and the day-close Timebox (`DayCloseTimebox`): same order, same words (`statistics.estimate.<key>`),
 * same ink step. `group` is the key of `TimeBoxGroups` (`utils/dayClose.ts`) the day close counts it under.
 */
export const ESTIMATE_GROUPS = [
  { key: 'longer', group: 'over', step: 0 },
  { key: 'onTarget', group: 'within', step: 3 },
  { key: 'shorter', group: 'under', step: 5 },
] as const
