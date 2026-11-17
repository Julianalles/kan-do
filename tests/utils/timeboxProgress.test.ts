import { describe, expect, it } from 'vitest';
import { getTimeboxRingColor, getTimerBarShare, isUnderOneMinute } from '~/utils/timeboxProgress';

describe('getTimeboxRingColor', () => {
  it.each([
    [0, 'primary'],
    [50, 'primary'],
    [80, 'primary'],
    [81, 'warning'],
    [100, 'warning'],
  ])('maps %i%% to %s', (pct, color) => {
    expect(getTimeboxRingColor(pct)).toBe(color);
  });

  it('never returns error (raspberry) at or beyond 100%', () => {
    for (const pct of [100, 150, 1000]) expect(getTimeboxRingColor(pct)).not.toBe('error');
  });

  it('is the done teal on done cards regardless of overrun (#124)', () => {
    for (const pct of [0, 90, 100, 200]) expect(getTimeboxRingColor(pct, true)).toBe('success');
  });
});

describe('isUnderOneMinute', () => {
  it('flags only elapsed values between 0 and 60 seconds', () => {
    expect(isUnderOneMinute(0)).toBe(false);
    expect(isUnderOneMinute(1)).toBe(true);
    expect(isUnderOneMinute(59)).toBe(true);
    expect(isUnderOneMinute(60)).toBe(false);
  });
});

describe('getTimerBarShare (#450)', () => {
  it('has no bar without a timebox', () => {
    expect(getTimerBarShare(600, null)).toBeNull();
    expect(getTimerBarShare(600, 0)).toBeNull();
    expect(getTimerBarShare(600, -5)).toBeNull();
  });

  it('starts full and shrinks with the remaining time', () => {
    expect(getTimerBarShare(0, 3600)).toEqual({ share: 100, over: false });
    expect(getTimerBarShare(900, 3600)).toEqual({ share: 75, over: false });
    expect(getTimerBarShare(1800, 3600)).toEqual({ share: 50, over: false });
    expect(getTimerBarShare(3420, 3600)).toEqual({ share: 5, over: false });
  });

  it('is empty at the timebox and not yet over', () => {
    expect(getTimerBarShare(3600, 3600)).toEqual({ share: 0, over: false });
  });

  it('is full again once over the timebox (it has run out, not nothing left)', () => {
    expect(getTimerBarShare(3601, 3600)).toEqual({ share: 100, over: true });
    expect(getTimerBarShare(9000, 3600)).toEqual({ share: 100, over: true });
  });

  it('reads negative spent time as nothing spent', () => {
    expect(getTimerBarShare(-30, 3600)).toEqual({ share: 100, over: false });
  });
});
