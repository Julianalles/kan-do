/**
 * @module timeboxProgress
 * @description Colour and share rules for timebox progress: the ring in the task sheet's time stats (the spent share),
 * the card's progress chip (#388, which never passes `isDone`: a done card shows a grey chip, "done teal" lives only
 * in the sheet ring) and the timer bar of the Jetzt card and the Now window's line (#450, #436: the share that is left).
 * Overrun is attention (warning/orange), never raspberry (destructive only, see DESIGN.md);
 * finished tasks carry no escalation, only the done teal (#124).
 */

export type TimeboxRingColor = 'success' | 'primary' | 'warning';

/**
 * Semantic colour of the timebox ring.
 * @param percentage Spent share of the timebox, 0-100 (clamped upstream)
 * @param isDone Task is finished; the ring is a teal record, not a warning
 */
export function getTimeboxRingColor(percentage: number, isDone = false): TimeboxRingColor {
  if (isDone) return 'success';
  if (percentage > 80) return 'warning';
  return 'primary';
}

/** Smallest arc (percent) drawn for a running timer so the ring never collapses to a dot. */
export const RUNNING_MIN_ARC_PERCENT = 4;

/** True when the elapsed label should read "<1 min" instead of a rounded "0 min". */
export function isUnderOneMinute(seconds: number): boolean {
  return seconds > 0 && seconds < 60;
}

export interface TimerBarShare {
  /** Share of the timebox that is left, 0-100; 100 when over (the bar is full and warning: it has run out) */
  share: number;
  /** The timebox is used up: spent is above it */
  over: boolean;
}

/**
 * The timer bar of a task in Jetzt (#450) and the Now window's line (#436): it starts full and shrinks with the
 * remaining time. Over the timebox it is full again, so "over" reads as an alarm, not as "nothing left"; the colour
 * comes from `getTimeboxRingColor` on the spent share.
 * @returns `null` without a timebox (nothing to shrink: the label counts the time passed)
 */
export function getTimerBarShare(spentSeconds: number, boxSeconds: number | null): TimerBarShare | null {
  if (boxSeconds === null || boxSeconds <= 0) return null;
  const spent = Math.max(0, spentSeconds);
  if (spent > boxSeconds) return { share: 100, over: true };
  return { share: ((boxSeconds - spent) / boxSeconds) * 100, over: false };
}
