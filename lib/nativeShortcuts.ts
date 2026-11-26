/**
 * @module nativeShortcuts
 * @description Which key chords the production desktop app swallows (#398): the ones that turn the window back into a
 * browser page. Reload (F5, Cmd/Ctrl+R, with Shift), print (Cmd/Ctrl+P) and page zoom (Cmd/Ctrl with +, =, -, 0).
 * `plugins/desktop-shell.client.ts` cancels the `keydown` of a match; it never stops propagation. WKWebView binds none of
 * them by itself (no menu item names them), WebView2 and WebKitGTK do, so this is a safety net on macOS and the real
 * guard elsewhere. The shortcut modifier is Cmd on macOS and Ctrl elsewhere: on macOS Ctrl+P / Ctrl+N / Ctrl+A / Ctrl+E are
 * Cocoa text bindings (line up / down, line start / end), so a Ctrl chord passes through there. Everything else (Cmd+Z, Cmd+C, the app's own Cmd+N, Cmd+1..3, Cmd+,) is left alone.
 * #845: the zoom chords are the app's own now. `zoomShortcut` names what one asks for and the plugin steps the setting
 * "Größe der Anzeige" (`lib/uiScale.ts`); the chord is still cancelled, so the webview itself never zooms.
 */
import type { UiScaleDirection } from '~/lib/uiScale'

type KeyChord = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey'>

const ZOOM_BY_KEY: Record<string, UiScaleDirection> = { '+': 'in', '=': 'in', '-': 'out', '_': 'out', '0': 'reset' }
const ZOOM_BY_CODE: Record<string, UiScaleDirection> = {
  Equal: 'in', NumpadAdd: 'in', Minus: 'out', NumpadSubtract: 'out', Digit0: 'reset', Numpad0: 'reset',
}

/**
 * What a zoom chord asks for (#845): larger (`in`: mod with + or =), smaller (`out`: mod with -) or back to 100 %
 * (`reset`: mod with 0); `null` for every other key event. The key decides, the physical key (`code`) is the fallback
 * for a layout whose key value is something else. `mac` picks the modifier as in `isBrowserShortcut`.
 */
export function zoomShortcut(event: KeyChord, mac: boolean): UiScaleDirection | null {
  // Alt held: AltGr reports Ctrl+Alt on Windows/Linux and types `}` or `\` on a German layout; leave it to the text field.
  if (event.altKey || !(mac ? event.metaKey : event.ctrlKey)) return null
  return (Object.hasOwn(ZOOM_BY_KEY, event.key) ? ZOOM_BY_KEY[event.key] : undefined)
    ?? (Object.hasOwn(ZOOM_BY_CODE, event.code) ? ZOOM_BY_CODE[event.code] : undefined)
    ?? null
}

/**
 * True when `event` is a reload, print or page-zoom chord the desktop app must not pass on to the webview. `mac` picks the shortcut modifier:
 * Cmd on macOS, Ctrl elsewhere; the other one is left to the text field.
 */
export function isBrowserShortcut(event: KeyChord, mac: boolean): boolean {
  if (event.key === 'F5') return true
  if (!(mac ? event.metaKey : event.ctrlKey)) return false
  const key = event.key.toLowerCase()
  if (key === 'r' || key === 'p') return !event.altKey
  return zoomShortcut(event, mac) !== null
}
