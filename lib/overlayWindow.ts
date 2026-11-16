/**
 * @module overlayWindow
 * @description Tells whether this webview is the floating Now window (#383, ADR 020). That window loads the same
 * bundle as the app but must run none of the app shell: no data file, no timers, no menu, no updater. `app.vue`
 * switches on it and every client plugin that touches data or starts work returns early on it
 * (`tests/config/overlay-contract.test.ts` lists the plugins and fails for one that does neither).
 * Decided from the path the window was opened at, which Rust fixes to `/overlay`; it never changes in the window's life.
 */
import { isTauri } from '~/utils/isTauri'

/** The route the pill window is opened at (`WebviewUrl::App("overlay")` in `src-tauri/src/overlay.rs`). */
export const OVERLAY_PATH = '/overlay'

export function isOverlayWindow(): boolean {
  if (typeof window === 'undefined' || !isTauri()) return false
  const path = window.location.pathname
  return path === OVERLAY_PATH || path.startsWith(`${OVERLAY_PATH}/`)
}
