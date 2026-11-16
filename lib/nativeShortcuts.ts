/**
 * @module nativeShortcuts
 * @description Which key chords the production desktop app swallows (#398): the ones that turn the window back into a
 * browser page. Reload (F5, Cmd/Ctrl+R, with Shift), print (Cmd/Ctrl+P) and page zoom (Cmd/Ctrl with +, =, -, 0).
 * `plugins/desktop-shell.client.ts` cancels the `keydown` of a match; it never stops propagation. WKWebView binds none of
 * them by itself (no menu item names them), WebView2 and WebKitGTK do, so this is a safety net on macOS and the real
 * guard elsewhere. Everything else (Cmd+Z, Cmd+C, the app's own Cmd+N, Cmd+1..3, Cmd+,) is left alone.
 */

type KeyChord = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>

const ZOOM_KEYS = new Set(['+', '=', '-', '_', '0'])
const ZOOM_CODES = new Set(['Equal', 'Minus', 'Digit0', 'Numpad0', 'NumpadAdd', 'NumpadSubtract'])

/** True when `event` is a reload, print or page-zoom chord the desktop app must not pass on to the webview. */
export function isBrowserShortcut(event: KeyChord): boolean {
  if (event.key === 'F5') return true
  if (!(event.metaKey || event.ctrlKey)) return false
  const key = event.key.toLowerCase()
  if (key === 'r' || key === 'p') return !event.altKey
  return ZOOM_KEYS.has(event.key) || ZOOM_CODES.has(event.code)
}
