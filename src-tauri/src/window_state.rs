//! The main window opens where and how the user left it (#393). `tauri-plugin-window-state` writes
//! `.window-state.json` into the app config dir on exit and restores it when the window is created: machine-local, never
//! part of the synced data file (like `overlay-window.json`, #383). Registered Rust-side only: JS gets no
//! `window-state:*` permission.
//!
//! What it saves is chosen on purpose. `VISIBLE` stays out: an agent sandbox run starts the window invisible and must
//! stay so (`KANDO_SANDBOX_BACKGROUND`, #623), and a hidden window must never come back hidden. `DECORATIONS` stays out:
//! the title bar is a fixed overlay (`titleBarStyle: Overlay`, #614). The floating Now window (#383) places itself
//! (`overlay.rs`), so the plugin must not touch it.

use tauri::plugin::TauriPlugin;
use tauri::Runtime;
use tauri_plugin_window_state::{Builder, StateFlags};

use crate::overlay::OVERLAY_LABEL;

/// Window labels the plugin leaves alone.
pub const DENYLIST: &[&str] = &[OVERLAY_LABEL];

/// What is saved and restored: size, position, maximized and full screen.
pub fn state_flags() -> StateFlags {
  StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
  Builder::default().with_state_flags(state_flags()).with_denylist(DENYLIST).build()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn saves_bounds_and_screen_mode_only() {
    let flags = state_flags();
    assert!(flags.contains(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN));
    // A sandbox run starts invisible and a hidden window must not be restored hidden; the title bar is fixed.
    assert!(!flags.contains(StateFlags::VISIBLE));
    assert!(!flags.contains(StateFlags::DECORATIONS));
  }

  #[test]
  fn leaves_the_now_window_alone() {
    assert!(DENYLIST.contains(&OVERLAY_LABEL));
    assert!(!DENYLIST.contains(&"main"));
  }
}
