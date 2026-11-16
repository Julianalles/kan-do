# ADR 020: A floating Now window: a second Tauri window owned by Rust, with no access to the data file

## Status

Accepted (#383; decisions D1 to D8 in the issue body). The ADR number was taken as the next free one on `main` and may be renumbered at merge.

## Context

While a task sits in Jetzt and the user works in another app, the task and its timebox are out of sight. The design (a pill that floats over other apps, draggable, switchable in the settings) needs a second window. The app has one writer of the data file, guarded in Rust (ADR 011), and a webview that loads the whole app shell (stores, timers, menu, updater); a second webview that did the same would be a second writer and a second timer driver.

## Decision

- **Rust owns the window and its visibility** (`src-tauri/src/overlay.rs`). The window (label `overlay`, opened at the route `/overlay`) is created hidden once a snapshot with a Jetzt task arrives while the setting is on, shown iff the setting is on, a task sits in Jetzt, the pill has reported ready and the main window is not focused (`WindowEvent::Focused` of `main`), hidden otherwise, destroyed when the setting turns off and with the main window (a hidden window left alive would keep the process running after the last visible window closed). Rejected: a window made from JS (needs `core:webview:allow-create-webview-window`, and the show/hide decision would run in a webview macOS may throttle while it is covered).
- **The main window publishes a snapshot, Rust relays it.** `overlay_sync(enabled, snapshot)` carries `{ taskId, title, timeBoxSeconds, spentSeconds, at, running, locale }` (or `null`), sent on every change of what the pill shows and at the 10 s time checkpoint, never per second. The pill counts on by the wall clock from `at` (`lib/nowWindow.ts`), so a throttled main window cannot freeze it. The pill's clicks go back as `overlay_action(kind, taskId)` with `kind` in `OVERLAY_ACTIONS` (`open`, `toggle-pause`, `done`): `open` is handled in Rust, the other two reach the main window as the event `overlay://action`, which ignores a task that is no longer the Jetzt task. Pause is the existing timer stop, runtime-only; done is the board's own completion path. Rejected: the pill reading the persisted store (a second writer on the guarded data file).
- **The pill never touches data.** `app.vue` is a thin switch (`lib/overlayWindow.ts`: Tauri and path `/overlay`) between the pill and the app shell (`components/AppShell.vue`, the former `app.vue`); every client plugin that loads data, starts work or checks for updates returns early in the pill window (`tests/config/overlay-contract.test.ts` lists `plugins/` and fails for a new plugin that neither guards nor is listed as harmless); and Rust's `data_*` commands refuse a window that is not `main`. The pill needs no store: it takes the language from the snapshot.
- **The position is machine-local.** `overlay-window.json` (`{ x, y }`, physical pixels) in the app config dir, written debounced while the user drags. The data file can sit in iCloud and be opened on Macs with other displays, so a position stored there would travel to a screen it does not fit. A saved spot is clamped into the work area (`Monitor::work_area`: no menu bar, no Dock) of the monitor that holds it and falls back to the bottom right of the primary one when it is on no display (`resolve_position`, unit-tested). Only the on/off setting is persisted state: `settings-store.floatingNowEnabled`, additive, default on.
- **Transparent window.** `app.macOSPrivateApi` and the `tauri` crate feature `macos-private-api` (the build refuses one without the other): kan-do ships a notarized DMG, not through the App Store. The window is not focusable (`focusable(false)`), always on top, on all spaces, without shadow (the capsule draws its own), and `accept_first_mouse` so the first click acts.
- **Least privilege.** `capabilities/overlay.json` grants the `overlay` window `core:event:default` and `core:window:allow-start-dragging` only; no new CSP host. The pill drags with `startDragging()` after 3 px of pointer travel, because a `data-tauri-drag-region` element cannot be clicked.

## Consequences

- A second webview costs memory; it exists only while the setting is on and a Jetzt task has been seen.
- Over another app's full-screen space the pill does not show (Tauri 2.12 does not expose the collection behaviour that needs); hover on an inactive window, the first-click behaviour and the drag feel are WKWebView matters checked by hand.
- The window is macOS-tested only; the setting is hidden on the web.
- A pause lasts until the app restarts or the task re-enters Jetzt (the driver's rule); the Jetzt card shows no paused state yet.
- A new plugin is guarded with `isOverlayWindow()` or listed as harmless; a new `data_*` command takes `window: tauri::Window` and calls `ensure_main_window`.
