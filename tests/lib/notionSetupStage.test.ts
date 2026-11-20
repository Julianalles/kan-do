import { describe, expect, it } from 'vitest';
import { notionStageOnArrival } from '~/lib/notionSetupStage';

describe('notionStageOnArrival', () => {
  it('connects an unconnected source whatever was asked', () => {
    expect(notionStageOnArrival(undefined, false)?.purpose).toBe('connect');
    expect(notionStageOnArrival('repair', false)?.purpose).toBe('connect');
  });
  it('repairs a connected source at the token step, config complete or not', () => {
    expect(notionStageOnArrival('repair', true)).toEqual({ purpose: 'repair', mode: 'setup', intro: false });
  });
  it('opens settings mode as a repair of the connected source', () => {
    expect(notionStageOnArrival('settings', true)).toEqual({ purpose: 'repair', mode: 'settings', intro: false });
  });
  it('shows the tabs for a plain visit of a connected source', () => {
    expect(notionStageOnArrival(undefined, true)).toBeNull();
  });
});
