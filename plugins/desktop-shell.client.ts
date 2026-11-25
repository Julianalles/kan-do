/**
 * @module desktop-shell
 * @description Marks `<html data-shell="desktop">` when the app runs inside Tauri (#614), before the first
 * render. CSS keys desktop-only behaviour on it (no rubber-band overscroll, `assets/css/utilities.css`), so the
 * web build keeps the browser's own scrolling. Same detection as everywhere else: `isTauri()`. Also keeps the
 * window draggable while a full-screen layer covers the drag strip (`lib/windowDrag.ts`). In a production build it
 * also cancels the browser's context menu (#370, `lib/nativeContextMenu.ts`) and the reload, print and zoom shortcuts
 * (#398, `lib/nativeShortcuts.ts`); dev builds keep them for Inspect and HMR. The zoom chords (Cmd/Ctrl with +, - and 0)
 * step the setting "Größe der Anzeige" instead (#845), in every build. Links and images cannot be dragged out
 * of the window (#398; `-webkit-user-drag` in `assets/css/utilities.css`, the `dragstart` listener is the fallback).
 */
import { isTauri } from '~/utils/isTauri'
import { isLayerDragStart } from '~/lib/windowDrag'
import { shouldBlockContextMenu } from '~/lib/nativeContextMenu'
import { isApplePlatform } from '~/composables/usePlatformShortcut'
import { isBrowserShortcut, zoomShortcut } from '~/lib/nativeShortcuts'
import { isOverlayWindow } from '~/lib/overlayWindow'
import { stepUiScale } from '~/lib/uiScale'
import { useSettingsStore } from '~/store/settings'

export default defineNuxtPlugin(() => {
  if (!isTauri()) return
  document.documentElement.dataset.shell = 'desktop'

  const onLayerBar = (event: MouseEvent) =>
    isLayerDragStart(event, document.querySelector('.titlebar')?.getBoundingClientRect().height ?? 0)

  // The dialog dismisses on a pointerdown outside it: swallow that one (capture, before it), drag on the mousedown.
  document.addEventListener('pointerdown', (event) => {
    if (onLayerBar(event)) event.stopImmediatePropagation()
  }, true)
  document.addEventListener('mousedown', (event) => {
    if (event.detail !== 1 || !onLayerBar(event)) return
    event.preventDefault()
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
  })

  // A native app does not drag a link or an image out of its window as a ghost (#398). Only a drag that starts on one is
  // cancelled: selected text and the board's pointer-driven drag (dnd-kit) never start a native `dragstart` there.
  document.addEventListener('dragstart', (event) => {
    if (event.target instanceof Element && event.target.closest('a, img')) event.preventDefault()
  })

  // No Back / Reload / Inspect menu in an installed app (#370). Bubble phase and no stopPropagation: the task card's own
  // menu (reka ContextMenu) still opens. Text fields and selected text keep the native menu (Cut, Copy, Paste).
  if (!import.meta.dev) {
    document.addEventListener('contextmenu', (event) => {
      if (shouldBlockContextMenu(event.target, window.getSelection())) event.preventDefault()
    })
  }

  // Reload, print and the webview's page zoom are not the app's (#398): the window is not a browser tab. Cancelled in a
  // production build only (dev keeps reload for HMR); never stops propagation, so the app's own chords still arrive.
  // The zoom chords step the setting "Größe der Anzeige" instead (#845), in dev builds too. The floating Now window
  // has no settings and never scales: there the chord is only cancelled.
  const mac = isApplePlatform()
  document.addEventListener('keydown', (event) => {
    const zoom = zoomShortcut(event, mac)
    if (zoom) {
      event.preventDefault()
      if (isOverlayWindow()) return
      const settingsStore = useSettingsStore()
      settingsStore.setUiScale(stepUiScale(settingsStore.uiScale, zoom))
      return
    }
    if (!import.meta.dev && isBrowserShortcut(event, mac)) event.preventDefault()
  })
})
