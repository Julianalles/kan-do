/**
 * @module uiScale
 * @description The size of the interface (#845): the fixed steps of the setting "Größe der Anzeige", in percent of
 * the browser's root font size. The app is rem-based, so the root font size scales type, spacing and controls
 * together (`plugins/ui-scale.client.ts` applies it). The range ends at 125 %: at 150 % the phone app bar leaves a
 * 390 px viewport and the desktop pills reach the window's traffic lights at the minimum window width (measured).
 * Shared by `store/settings.ts`, the settings page and the desktop shortcuts.
 */

/** The steps, smallest first. Changing them: check the phone app bar at 390 px and the desktop title row at 800 px. */
export const UI_SCALE_STEPS = [80, 90, 100, 110, 125] as const

export type UiScale = (typeof UI_SCALE_STEPS)[number]

export const DEFAULT_UI_SCALE: UiScale = 100

export type UiScaleDirection = 'in' | 'out' | 'reset'

export function isUiScale(value: unknown): value is UiScale {
  return typeof value === 'number' && (UI_SCALE_STEPS as readonly number[]).includes(value)
}

/** A stored value that is not one of the steps (older data, a wrong type, a step that no longer exists) reads as 100 %. */
export function sanitizeUiScale(value: unknown): UiScale {
  return isUiScale(value) ? value : DEFAULT_UI_SCALE
}

/** One step up (`in`) or down (`out`), staying at the ends; `reset` is 100 %. */
export function stepUiScale(current: UiScale, direction: UiScaleDirection): UiScale {
  if (direction === 'reset') return DEFAULT_UI_SCALE
  const index = UI_SCALE_STEPS.indexOf(current) + (direction === 'in' ? 1 : -1)
  return UI_SCALE_STEPS[index] ?? current
}
