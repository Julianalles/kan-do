//! Floating Now window (#383, ADR 020): a small always-on-top pill that shows the Jetzt task and its timer while
//! kan-do is not the front window.
//!
//! Rust owns the window and decides when it shows. The main window publishes one snapshot of the Jetzt task
//! (`overlay_sync`, with the setting); the pill window (the Nuxt route `/overlay`) renders what Rust emits as
//! `overlay://state` and reports clicks as `overlay_action`. The pill never reads or writes the data file
//! (`data_file::ensure_main_window` refuses it), so it can never become a second writer (ADR 011).
//!
//! The pill shows iff the setting is on, a task sits in Jetzt, the pill webview has reported ready and the main
//! window is not focused. The window is created hidden once the first snapshot with a task arrives, destroyed when
//! the setting turns off and with the main window (a hidden window alive would keep the app running).
//!
//! Its position is machine-local (`overlay-window.json` in the app config dir, written debounced while the user
//! drags): the data file may sit in iCloud and be opened on a Mac with other displays. A saved spot that is off
//! every screen resolves back to a visible one (`resolve_position`); the default is bottom right of the primary
//! monitor's work area, which excludes the menu bar and the Dock.
//!
//! `OVERLAY_ACTIONS`, the event names and the label are mirrored in `lib/nowWindow.ts`;
//! `tests/config/overlay-contract.test.ts` keeps both sides in step.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};

/// Label of the pill window (also the key of its capability).
pub const OVERLAY_LABEL: &str = "overlay";
/// Rust to the pill: the snapshot (`Snapshot` or `null`).
pub const STATE_EVENT: &str = "overlay://state";
/// Rust to the main window: a pill action to carry out (`{ kind, taskId }`).
pub const ACTION_EVENT: &str = "overlay://action";
/// What the pill may ask for. `open` is handled here, the rest is forwarded to the main window.
pub const OVERLAY_ACTIONS: &[&str] = &["open", "toggle-pause", "done"];

const WINDOW_WIDTH: f64 = 324.0;
const WINDOW_HEIGHT: f64 = 64.0;
const DEFAULT_MARGIN: i32 = 16;
const POSITION_FILE: &str = "overlay-window.json";
const SAVE_DEBOUNCE: Duration = Duration::from_millis(400);

/// The Jetzt task as the pill shows it. `spent_seconds` was true at `at` (epoch ms); `running` is false while paused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub task_id: String,
    pub title: String,
    pub time_box_seconds: Option<u64>,
    pub spent_seconds: u64,
    pub at: u64,
    pub running: bool,
    pub locale: String,
}

#[derive(Default)]
struct Inner {
    enabled: bool,
    snapshot: Option<Snapshot>,
    /// Last focus state the main window reported; `None` until it does (then the window is asked).
    main_focused: Option<bool>,
    /// The pill webview has mounted and asked for its state.
    ready: bool,
    /// The spot Rust placed the window at: a `Moved` to it is not the user's doing.
    placed: Option<(i32, i32)>,
    /// The spot waiting to be written, and whether a writer thread is already waiting for it.
    pending_save: Option<(i32, i32)>,
    saver_waiting: bool,
}

/// Managed state of the pill window.
#[derive(Default)]
pub struct OverlayState {
    inner: Mutex<Inner>,
}

impl OverlayState {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

// ---- pure placement ------------------------------------------------------------------------------------------

/// A work area or a window rectangle in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn right(&self) -> i32 {
        self.x.saturating_add(self.width as i32)
    }
    fn bottom(&self) -> i32 {
        self.y.saturating_add(self.height as i32)
    }
    fn contains(&self, px: i32, py: i32) -> bool {
        px >= self.x && px < self.right() && py >= self.y && py < self.bottom()
    }
}

/// Where the window goes: the saved spot, clamped into the work area that holds the window's centre; a saved spot
/// off every area (a removed display) or none at all resolves to the bottom right of the `primary` area, `margin`
/// from its edges. No areas at all: `None` (the system places the window).
pub fn resolve_position(
    saved: Option<(i32, i32)>,
    size: (u32, u32),
    areas: &[Rect],
    primary: usize,
    margin: i32,
) -> Option<(i32, i32)> {
    let default_area = areas.get(primary).or_else(|| areas.first())?;
    let (w, h) = (size.0 as i32, size.1 as i32);
    let clamp_into = |area: &Rect, x: i32, y: i32| {
        let max_x = (area.right() - w).max(area.x);
        let max_y = (area.bottom() - h).max(area.y);
        (x.clamp(area.x, max_x), y.clamp(area.y, max_y))
    };
    if let Some((x, y)) = saved {
        if let Some(area) = areas.iter().find(|a| a.contains(x + w / 2, y + h / 2)) {
            return Some(clamp_into(area, x, y));
        }
    }
    Some(clamp_into(
        default_area,
        default_area.right() - w - margin,
        default_area.bottom() - h - margin,
    ))
}

/// Reads the position file's text: `{ "x": n, "y": n }`; anything else is no saved spot.
pub fn parse_position(text: &str) -> Option<(i32, i32)> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let x = i32::try_from(value.get("x")?.as_i64()?).ok()?;
    let y = i32::try_from(value.get("y")?.as_i64()?).ok()?;
    Some((x, y))
}

fn position_json(x: i32, y: i32) -> String {
    format!("{{\"x\":{x},\"y\":{y}}}")
}

/// Whether `kind` is an action the pill may send.
pub fn is_overlay_action(kind: &str) -> bool {
    OVERLAY_ACTIONS.contains(&kind)
}

// ---- window --------------------------------------------------------------------------------------------------

fn position_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(POSITION_FILE))
}

fn work_areas<R: Runtime>(app: &AppHandle<R>) -> (Vec<Rect>, usize) {
    let to_rect = |m: &tauri::Monitor| {
        let area = m.work_area();
        Rect { x: area.position.x, y: area.position.y, width: area.size.width, height: area.size.height }
    };
    let areas: Vec<Rect> = app.available_monitors().unwrap_or_default().iter().map(to_rect).collect();
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| to_rect(&m))
        .and_then(|rect| areas.iter().position(|a| *a == rect))
        .unwrap_or(0);
    (areas, primary)
}

fn create_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    let window = WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App("overlay".into()))
        .title("kan-do")
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focusable(false)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()
        .map_err(|error| log::warn!("overlay: window not created: {error}"))
        .ok()?;
    let saved = position_path(app).and_then(|path| fs::read_to_string(path).ok()).and_then(|text| parse_position(&text));
    let size = window.outer_size().map(|s| (s.width, s.height)).unwrap_or((WINDOW_WIDTH as u32, WINDOW_HEIGHT as u32));
    let (areas, primary) = work_areas(app);
    if let Some((x, y)) = resolve_position(saved, size, &areas, primary, DEFAULT_MARGIN) {
        app.state::<OverlayState>().lock().placed = Some((x, y));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    Some(window)
}

fn main_focused<R: Runtime>(app: &AppHandle<R>) -> bool {
    if let Some(known) = app.state::<OverlayState>().lock().main_focused {
        return known;
    }
    app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false)
}

/// Brings the window in line with the state: created when wanted, destroyed when the setting is off, shown while the
/// main window is not in front, told the snapshot.
fn apply<R: Runtime>(app: &AppHandle<R>) {
    let (enabled, snapshot, ready) = {
        let state = app.state::<OverlayState>();
        let inner = state.lock();
        (inner.enabled, inner.snapshot.clone(), inner.ready)
    };
    if !enabled {
        destroy(app);
        return;
    }
    let window = app.get_webview_window(OVERLAY_LABEL);
    if snapshot.is_none() {
        if let Some(window) = window {
            let _ = window.hide();
        }
        return;
    }
    let created = window.is_none();
    let Some(window) = window.or_else(|| create_window(app)) else { return };
    if created {
        log::info!("overlay: window created");
    }
    let _ = app.emit_to(OVERLAY_LABEL, STATE_EVENT, &snapshot);
    if ready && !main_focused(app) {
        // A sandbox run puts nothing on the user's screen (docs/testing/tauri-dev-sandbox.md, #623): the decision is
        // logged instead, which is what an unattended check reads
        if crate::sandbox_background() {
            log::info!("overlay: would show (sandbox run, not shown)");
        } else {
            let _ = window.show();
        }
    } else {
        log::info!("overlay: hidden (ready {ready}, main focused {})", main_focused(app));
        let _ = window.hide();
    }
}

/// Destroys the pill window (setting off, main window closing). Safe when there is none.
pub fn destroy<R: Runtime>(app: &AppHandle<R>) {
    app.state::<OverlayState>().lock().ready = false;
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.destroy();
    }
}

/// The main window gained or lost focus.
pub fn on_main_focus<R: Runtime>(app: &AppHandle<R>, focused: bool) {
    app.state::<OverlayState>().lock().main_focused = Some(focused);
    apply(app);
}

/// `Builder::on_window_event` for the pill window: remembers where the user drops it.
pub fn on_overlay_event<R: Runtime>(app: &AppHandle<R>, event: &WindowEvent) {
    if let WindowEvent::Moved(position) = event {
        schedule_save(app, (position.x, position.y));
    }
}

fn schedule_save<R: Runtime>(app: &AppHandle<R>, spot: (i32, i32)) {
    let state = app.state::<OverlayState>();
    {
        let mut inner = state.lock();
        if inner.placed == Some(spot) {
            return;
        }
        inner.pending_save = Some(spot);
        if inner.saver_waiting {
            return;
        }
        inner.saver_waiting = true;
    }
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(SAVE_DEBOUNCE);
        let spot = {
            let state = app.state::<OverlayState>();
            let mut inner = state.lock();
            inner.saver_waiting = false;
            inner.pending_save.take()
        };
        let (Some((x, y)), Some(path)) = (spot, position_path(&app)) else { return };
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Err(error) = fs::write(&path, position_json(x, y)) {
            log::warn!("overlay: position not saved: {error}");
        }
    });
}

fn from_window(window: &tauri::Window, label: &str) -> Result<(), String> {
    if window.label() == label {
        Ok(())
    } else {
        Err("not allowed from this window".into())
    }
}

// ---- commands ------------------------------------------------------------------------------------------------

/// Main window to Rust: the setting and the Jetzt task (`null` when none). Sent on every change, never per second.
#[tauri::command]
pub async fn overlay_sync(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, OverlayState>,
    enabled: bool,
    snapshot: Option<Snapshot>,
) -> Result<(), String> {
    from_window(&window, crate::data_file::DATA_WINDOW_LABEL)?;
    {
        let mut inner = state.lock();
        inner.enabled = enabled;
        inner.snapshot = snapshot;
        log::info!("overlay: sync (enabled {enabled}, task {})", inner.snapshot.is_some());
    }
    apply(&app);
    Ok(())
}

/// Pill to Rust: the webview has mounted. Answers the current snapshot and shows the window if it is due.
#[tauri::command]
pub async fn overlay_ready(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, OverlayState>,
) -> Result<Option<Snapshot>, String> {
    from_window(&window, OVERLAY_LABEL)?;
    let snapshot = {
        let mut inner = state.lock();
        inner.ready = true;
        inner.snapshot.clone()
    };
    log::info!("overlay: pill ready (task {})", snapshot.is_some());
    apply(&app);
    Ok(snapshot)
}

/// Pill to Rust: a click. `open` brings kan-do forward; the others go to the main window with the task they were for.
#[tauri::command]
pub async fn overlay_action(window: tauri::Window, app: AppHandle, kind: String, task_id: String) -> Result<(), String> {
    from_window(&window, OVERLAY_LABEL)?;
    if !is_overlay_action(&kind) {
        return Err("unknown action".into());
    }
    if kind == "open" {
        // A sandbox run must never take the user's focus (docs/testing/tauri-dev-sandbox.md, #623)
        if crate::sandbox_background() {
            return Ok(());
        }
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
        return Ok(());
    }
    app.emit_to("main", ACTION_EVENT, serde_json::json!({ "kind": kind, "taskId": task_id }))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SIZE: (u32, u32) = (324, 64);
    const MAIN: Rect = Rect { x: 0, y: 25, width: 2560, height: 1375 };
    const SIDE: Rect = Rect { x: 2560, y: 0, width: 1920, height: 1080 };

    #[test]
    fn default_is_bottom_right_of_the_primary_work_area() {
        let spot = resolve_position(None, SIZE, &[MAIN, SIDE], 0, 16);
        assert_eq!(spot, Some((2560 - 324 - 16, 25 + 1375 - 64 - 16)));
    }

    #[test]
    fn default_follows_the_primary_index() {
        let spot = resolve_position(None, SIZE, &[MAIN, SIDE], 1, 16);
        assert_eq!(spot, Some((4480 - 324 - 16, 1080 - 64 - 16)));
    }

    #[test]
    fn a_saved_spot_on_screen_is_kept() {
        assert_eq!(resolve_position(Some((300, 200)), SIZE, &[MAIN, SIDE], 0, 16), Some((300, 200)));
        assert_eq!(resolve_position(Some((2800, 100)), SIZE, &[MAIN, SIDE], 0, 16), Some((2800, 100)));
    }

    #[test]
    fn a_saved_spot_half_off_the_edge_is_pulled_back_in() {
        // centre still inside the area, window sticks out to the right and below
        assert_eq!(resolve_position(Some((2390, 1360)), SIZE, &[MAIN], 0, 16), Some((2560 - 324, 25 + 1375 - 64)));
        // above the menu bar
        assert_eq!(resolve_position(Some((100, 0)), SIZE, &[MAIN], 0, 16), Some((100, 25)));
    }

    #[test]
    fn a_saved_spot_on_a_removed_display_falls_back_to_the_default() {
        assert_eq!(
            resolve_position(Some((2800, 100)), SIZE, &[MAIN], 0, 16),
            Some((2560 - 324 - 16, 25 + 1375 - 64 - 16))
        );
        assert_eq!(
            resolve_position(Some((-5000, -5000)), SIZE, &[MAIN], 0, 16),
            Some((2560 - 324 - 16, 25 + 1375 - 64 - 16))
        );
    }

    #[test]
    fn a_work_area_smaller_than_the_window_still_resolves_inside_it() {
        let tiny = Rect { x: 10, y: 20, width: 100, height: 30 };
        assert_eq!(resolve_position(None, SIZE, &[tiny], 0, 16), Some((10, 20)));
    }

    #[test]
    fn no_display_means_no_position() {
        assert_eq!(resolve_position(Some((1, 1)), SIZE, &[], 0, 16), None);
    }

    #[test]
    fn the_position_file_is_read_tolerantly() {
        assert_eq!(parse_position(&position_json(-40, 900)), Some((-40, 900)));
        assert_eq!(parse_position(""), None);
        assert_eq!(parse_position("not json"), None);
        assert_eq!(parse_position("{\"x\":1}"), None);
        assert_eq!(parse_position("{\"x\":\"1\",\"y\":2}"), None);
        assert_eq!(parse_position("{\"x\":99999999999,\"y\":2}"), None);
        assert_eq!(parse_position("[1,2]"), None);
        assert_eq!(parse_position("null"), None);
    }

    #[test]
    fn only_the_listed_actions_pass() {
        for kind in OVERLAY_ACTIONS {
            assert!(is_overlay_action(kind));
        }
        assert!(!is_overlay_action(""));
        assert!(!is_overlay_action("quit"));
        assert!(!is_overlay_action("Open"));
    }

    #[test]
    fn the_snapshot_reads_the_camel_case_wire_shape() {
        let snapshot: Snapshot = serde_json::from_str(
            r#"{"taskId":"a","title":"T","timeBoxSeconds":1500,"spentSeconds":860,"at":1763300000000,"running":true,"locale":"de"}"#,
        )
        .unwrap();
        assert_eq!(snapshot.time_box_seconds, Some(1500));
        let none: Snapshot = serde_json::from_str(
            r#"{"taskId":"a","title":"T","timeBoxSeconds":null,"spentSeconds":0,"at":1,"running":false,"locale":"en"}"#,
        )
        .unwrap();
        assert_eq!(none.time_box_seconds, None);
    }
}
