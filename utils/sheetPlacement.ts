/**
 * Placement and motion constants of the desktop task sheet (#468, `TaskMorphShell`).
 *
 * Pure geometry, no DOM: the shell measures the card and the window and asks here where the sheet goes. Everything is
 * in CSS pixels of the viewport.
 */
import { MOTION } from '~/lib/motionTokens'

/** Gap between the sheet and every window edge. */
export const SHEET_MARGIN = 16;

/** Width of the desktop task sheet; a narrower window gives it the full width minus the margins. */
export const SHEET_MAX_WIDTH = 720;

/**
 * Timings of the morph (ms), mirrored in the shell's doc block. Easings mirror `--ease-emphasized` (things that arrive)
 * and `--ease-standard` (things that leave) of main.css: the Web Animations API does not resolve a custom property in an easing.
 */
export const SHEET_MOTION = {
  /** The grow out of the card (#705): one phase for the panel box, the radius, the scaling card face and the content fading in. */
  openMs: 340,
  /** The fold back into the card: the same phase reversed, a little shorter. */
  closeMs: 260,
  /** No origin card: the centred scale-in. */
  centredInMs: 160,
  /** No origin card: the short fade out. */
  centredOutMs: 140,
  /** The scrim fading in; it fades out over `closeMs`. */
  scrimInMs: 160,
  /** Reduced motion: no grow and no fold, only this fade. */
  reducedMs: 1,
  easeOpen: MOTION.emphasized,
  easeClose: MOTION.standard,
} as const;

export interface SheetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetViewport {
  width: number;
  height: number;
  /** The first y the sheet may use: the bottom of the app bar row, so the sheet never covers the bar (#518). Defaults to `SHEET_MARGIN`. */
  top?: number;
}

/** The first y the sheet may use in this window. */
const topOf = (viewport: SheetViewport): number => Math.max(SHEET_MARGIN, viewport.top ?? SHEET_MARGIN);

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** The sheet's width in a window of this width: 720 px, or the window minus the margins. */
export const sheetWidth = (viewportWidth: number): number => Math.max(0, Math.min(SHEET_MAX_WIDTH, viewportWidth - 2 * SHEET_MARGIN));

/** The sheet's frame height as a share of its width (#705): 612 px at 720, whatever the task holds. */
export const SHEET_FRAME_RATIO = 0.85;

/**
 * The fixed frame of the desktop task sheet (#705): its height follows the width and the window, never the content, so the
 * sheet keeps one shape for a task with no extra properties and for one with eleven. A window too short for it gives the
 * sheet `maxHeight`; the columns scroll inside.
 */
export const sheetHeight = (width: number, maxHeight: number): number => Math.max(0, Math.min(Math.round(width * SHEET_FRAME_RATIO), maxHeight));

/** The tallest the sheet may be in a window of this height with this top inset (default: the margin); above that its columns scroll. */
export const sheetMaxHeight = (viewportHeight: number, top: number = SHEET_MARGIN): number => Math.max(0, viewportHeight - Math.max(SHEET_MARGIN, top) - SHEET_MARGIN);

/** A card is a usable origin when it has a size and shows at least partly inside the window (a scrolled-out card does not). */
export const isUsableOrigin = (box: SheetBox | null | undefined, viewport: SheetViewport): box is SheetBox => {
  if (!box || box.w <= 0 || box.h <= 0) return false;
  return box.x < viewport.width && box.x + box.w > 0 && box.y < viewport.height && box.y + box.h > 0;
};

/**
 * Where a sheet of `w` x `h` goes: centred on the origin's centre (on the window's when there is none), then moved
 * inside the window so it keeps `SHEET_MARGIN` to the left, right and bottom edge and stays below the app bar (`viewport.top`, #518).
 * A sheet taller or wider than the window is pinned to the top left.
 */
export const placeSheet = (origin: SheetBox | null, size: { w: number; h: number }, viewport: SheetViewport): SheetBox => {
  const { w, h } = size;
  const centreX = origin ? origin.x + origin.w / 2 : viewport.width / 2;
  const centreY = origin ? origin.y + origin.h / 2 : viewport.height / 2;
  const top = topOf(viewport);
  return {
    x: clamp(centreX - w / 2, SHEET_MARGIN, Math.max(SHEET_MARGIN, viewport.width - w - SHEET_MARGIN)),
    y: clamp(centreY - h / 2, top, Math.max(top, viewport.height - h - SHEET_MARGIN)),
    w,
    h,
  };
};

/** The same box moved inside the window (after the content grew or the window shrank); size is not touched. */
export const keepInside = (box: SheetBox, viewport: SheetViewport): SheetBox => placeSheet(box, { w: box.w, h: box.h }, viewport);
