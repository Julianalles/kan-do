//! Apple Reminders bridge (#550, ADR 022, epic #481): the native half of "plan your day from Reminders".
//!
//! The web view cannot reach EventKit, so the access comes from here. The commands are macOS only (every other
//! target registers the same names and answers `unsupported`):
//!
//! - `reminders_access_status` reads the permission and never prompts.
//! - `reminders_request_access` is the **only** command that may show the macOS prompt. Nothing calls it at app start.
//! - `reminders_lists`, `reminders_fetch` read; they need full access (`access-denied` otherwise).
//! - `reminders_set_due` and `reminders_set_completed` are the only writes. Both are compare-and-set, both check the
//!   reminder's list against the `allowedListIds` the caller passes (the lists kan-do reads), both re-read what the
//!   store holds after the save and answer with it, and a write that finds its target state already in place is a
//!   no-op success.
//! - `reminders_open_settings` opens System Settings at the Reminders privacy pane.
//!
//! Dates are components, never instants: a due date is `{ date: "YYYY-MM-DD", time: "HH:mm" | null }` read from the
//! year, month, day, hour and minute components as they are, and `set_due` writes only year, month and day, so a
//! date-only reminder never shifts by a day and a reminder with a time keeps its time, time zone, calendar, start
//! date and alarms.
//!
//! v1 never creates, deletes, moves or edits the text of a reminder: the permission copy promises exactly that, and a
//! test fails when the production code of this module mentions such a call. There is no change push either: sync polls
//! at the app's fetch cadence.
//!
//! The command logic ([`logic`]) runs against the [`RemindersStore`] trait, so `cargo test --lib reminders` covers it
//! with a fake store and never touches EventKit (and so never shows a permission prompt). The EventKit
//! implementation lives in [`eventkit`] (macOS) and runs off the main thread in `spawn_blocking`. Errors are fixed
//! typed strings ([`RemindersError`]), like `secrets.rs`: no platform text reaches the web view.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};

/// Where System Settings shows the Reminders permission.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub const SETTINGS_URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders";

/// The typed errors of every command. Mirrors `RemindersErrorName` in `lib/reminders.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemindersError {
    /// Not macOS.
    Unsupported,
    /// The permission is not full access.
    AccessDenied,
    /// The reminder belongs to a list the caller does not read.
    NotRead,
    /// No reminder with that id.
    NotFound,
    /// The stored state is no longer the one the caller saw; nothing was written.
    Changed,
    /// A malformed argument, or a call from a window other than `main`.
    InvalidRequest,
    /// The store refused the save, or does not hold what was saved.
    SaveFailed,
    /// Anything else (the platform text is never forwarded).
    Failed,
}

impl fmt::Display for RemindersError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            RemindersError::Unsupported => "reminders are unsupported on this platform",
            RemindersError::AccessDenied => "reminders access not granted",
            RemindersError::NotRead => "the reminder is in a list kan-do does not read",
            RemindersError::NotFound => "reminder not found",
            RemindersError::Changed => "the reminder changed since it was read",
            RemindersError::InvalidRequest => "request not allowed",
            RemindersError::SaveFailed => "the reminder could not be saved",
            RemindersError::Failed => "reminders unavailable",
        })
    }
}

impl std::error::Error for RemindersError {}

/// The permission, as the web view sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessStatus {
    NotDetermined,
    Granted,
    Denied,
    Restricted,
    /// Write-only access (events only on macOS; reported as is, it never reads reminders).
    WriteOnly,
}

/// A calendar date without a time zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ymd {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

impl Ymd {
    /// Strict `YYYY-MM-DD`, a real calendar day.
    pub fn parse(text: &str) -> Option<Ymd> {
        let bytes = text.as_bytes();
        if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
            return None;
        }
        let digits = |range: std::ops::Range<usize>| -> Option<u32> {
            let part = &text[range];
            if part.bytes().all(|b| b.is_ascii_digit()) {
                part.parse().ok()
            } else {
                None
            }
        };
        let (year, month, day) = (digits(0..4)? as i32, digits(5..7)?, digits(8..10)?);
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let days = match month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if leap => 29,
            2 => 28,
            _ => return None,
        };
        (year >= 1 && (1..=days).contains(&day)).then_some(Ymd { year, month, day })
    }
}

impl fmt::Display for Ymd {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:04}-{:02}-{:02}", self.year, self.month, self.day)
    }
}

/// A due date as the components hold it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    /// `YYYY-MM-DD`
    pub date: String,
    /// `HH:mm` when the components carry an hour, else `null`.
    pub time: Option<String>,
}

/// What kan-do shows of a repeat rule: `FREQ=WEEKLY;INTERVAL=2`. Informational; the bridge never edits a rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recurrence {
    pub rule: String,
}

/// A reminder list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListInfo {
    /// `EKCalendar.calendarIdentifier`
    pub id: String,
    pub title: String,
    /// `#rrggbb`
    pub color: Option<String>,
    /// Incomplete reminders.
    pub open_count: u32,
    pub allows_writes: bool,
}

/// A reminder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    /// `EKCalendarItem.calendarItemIdentifier`
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub notes: String,
    pub completed: bool,
    /// Epoch ms.
    pub completed_at: Option<i64>,
    pub due: Option<Due>,
    pub recurrence: Option<Recurrence>,
}

/// The answer of `reminders_fetch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub reminders: Vec<Reminder>,
    /// Requested lists that do not exist (any more): skipped, not an error.
    pub missing_list_ids: Vec<String>,
}

/// The answer of `reminders_set_completed`: the state re-read after the save.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Completion {
    pub completed: bool,
    pub due: Option<Due>,
}

/// What a write needs to know about the stored reminder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub list_id: String,
    pub completed: bool,
    pub due: Option<Due>,
    pub recurrence: Option<Recurrence>,
}

/// The reminders store behind the commands. Blocking; every call is made off the main thread.
pub trait RemindersStore {
    /// Never prompts.
    fn access_status(&self) -> AccessStatus;
    /// Shows the macOS prompt and waits for the answer. Only [`logic::request_access`] calls it.
    fn prompt_for_access(&self) -> AccessStatus;
    fn lists(&self) -> Result<Vec<ListInfo>, RemindersError>;
    /// Reads exactly the reminders of `list_ids` (incomplete ones plus those completed at or after
    /// `completed_since_ms`); never another list.
    fn fetch(&self, list_ids: &[String], completed_since_ms: i64) -> Result<FetchResult, RemindersError>;
    /// The stored state, refreshed from the database. `None`: no such reminder.
    fn read(&self, id: &str) -> Result<Option<Snapshot>, RemindersError>;
    /// Sets year, month and day of the due date and nothing else (`None` clears the date components), saved with
    /// `commit: true`. A failed save leaves the reminder as it was.
    fn write_due(&self, id: &str, date: Option<Ymd>) -> Result<(), RemindersError>;
    /// Ticks or unticks that one reminder, saved with `commit: true`.
    fn write_completed(&self, id: &str, completed: bool) -> Result<(), RemindersError>;
}

/// The command logic: argument checks, the access gate, compare-and-set and the re-read. Pure over a store.
pub mod logic {
    use super::*;

    pub fn access_status(store: &dyn RemindersStore) -> AccessStatus {
        store.access_status()
    }

    /// The prompt appears only when the user has not answered yet; later answers are the system's to change.
    pub fn request_access(store: &dyn RemindersStore) -> AccessStatus {
        match store.access_status() {
            AccessStatus::NotDetermined => store.prompt_for_access(),
            other => other,
        }
    }

    fn require_full_access(store: &dyn RemindersStore) -> Result<(), RemindersError> {
        match store.access_status() {
            AccessStatus::Granted => Ok(()),
            _ => Err(RemindersError::AccessDenied),
        }
    }

    pub fn lists(store: &dyn RemindersStore) -> Result<Vec<ListInfo>, RemindersError> {
        require_full_access(store)?;
        store.lists()
    }

    pub fn fetch(store: &dyn RemindersStore, list_ids: &[String], completed_since_ms: i64) -> Result<FetchResult, RemindersError> {
        require_full_access(store)?;
        let mut seen = HashSet::new();
        let unique: Vec<String> = list_ids.iter().filter(|id| seen.insert(id.as_str())).cloned().collect();
        if unique.is_empty() {
            return Ok(FetchResult { reminders: Vec::new(), missing_list_ids: Vec::new() });
        }
        store.fetch(&unique, completed_since_ms)
    }

    fn parse_optional(text: Option<&str>) -> Result<Option<Ymd>, RemindersError> {
        match text {
            None => Ok(None),
            Some(text) => Ymd::parse(text).map(Some).ok_or(RemindersError::InvalidRequest),
        }
    }

    fn date_of(due: &Option<Due>) -> Option<Ymd> {
        due.as_ref().and_then(|due| Ymd::parse(&due.date))
    }

    /// The stored reminder, when it is one kan-do may write (its list is among `allowed_list_ids`).
    fn writable(store: &dyn RemindersStore, id: &str, allowed_list_ids: &[String]) -> Result<Snapshot, RemindersError> {
        if id.is_empty() {
            return Err(RemindersError::InvalidRequest);
        }
        let snapshot = store.read(id)?.ok_or(RemindersError::NotFound)?;
        if allowed_list_ids.iter().any(|allowed| *allowed == snapshot.list_id) {
            Ok(snapshot)
        } else {
            Err(RemindersError::NotRead)
        }
    }

    /// Compare-and-set of the due date. `expected_date` is the date kan-do holds (`None` = none), `date` the target
    /// (`None` clears the date, used only to restore a reminder that had none).
    pub fn set_due(
        store: &dyn RemindersStore,
        id: &str,
        expected_date: Option<&str>,
        date: Option<&str>,
        allowed_list_ids: &[String],
    ) -> Result<Option<Due>, RemindersError> {
        require_full_access(store)?;
        let expected = parse_optional(expected_date)?;
        let target = parse_optional(date)?;
        let snapshot = writable(store, id, allowed_list_ids)?;
        let current = date_of(&snapshot.due);
        if current == target {
            // Already in place (a double submit, or the user set the same day): nothing to write.
            return Ok(snapshot.due);
        }
        if current != expected {
            return Err(RemindersError::Changed);
        }
        store.write_due(id, target)?;
        let after = store.read(id)?.ok_or(RemindersError::SaveFailed)?;
        if date_of(&after.due) != target {
            return Err(RemindersError::SaveFailed);
        }
        Ok(after.due)
    }

    /// Ticks or unticks one reminder. For a recurring reminder `occurrence_date` is the due date kan-do holds; when
    /// the stored due date differs (or kan-do holds none while the reminder has one), the occurrence is gone and nothing
    /// is written; the caller always passes the date it holds, so a retried tick cannot tick the next occurrence.
    pub fn set_completed(
        store: &dyn RemindersStore,
        id: &str,
        completed: bool,
        occurrence_date: Option<&str>,
        allowed_list_ids: &[String],
    ) -> Result<Completion, RemindersError> {
        require_full_access(store)?;
        let occurrence = parse_optional(occurrence_date)?;
        let snapshot = writable(store, id, allowed_list_ids)?;
        if snapshot.completed == completed {
            return Ok(Completion { completed, due: snapshot.due });
        }
        let recurring = snapshot.recurrence.is_some();
        if recurring && date_of(&snapshot.due) != occurrence {
            return Err(RemindersError::Changed);
        }
        store.write_completed(id, completed)?;
        match store.read(id)? {
            Some(after) => {
                // A recurring reminder that was ticked comes back open on its next date: both are the store's answer.
                if !recurring && after.completed != completed {
                    return Err(RemindersError::SaveFailed);
                }
                Ok(Completion { completed: after.completed, due: after.due })
            }
            // A series that ended with this tick has nothing left to read.
            None if recurring && completed => Ok(Completion { completed: true, due: None }),
            None => Err(RemindersError::SaveFailed),
        }
    }
}

/// Runs `work` with the EventKit store off the async runtime's threads.
#[cfg(target_os = "macos")]
async fn run<T, F>(work: F) -> Result<T, RemindersError>
where
    T: Send + 'static,
    F: FnOnce(&dyn RemindersStore) -> Result<T, RemindersError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let store = eventkit::EventKitStore::new();
        work(&store)
    })
    .await
    .map_err(|_| RemindersError::Failed)?
}

#[cfg(not(target_os = "macos"))]
async fn run<T, F>(_work: F) -> Result<T, RemindersError>
where
    T: Send + 'static,
    F: FnOnce(&dyn RemindersStore) -> Result<T, RemindersError> + Send + 'static,
{
    Err(RemindersError::Unsupported)
}

/// Only the main window talks to Reminders: the floating Now window must never touch user data.
fn ensure_main_window(window: &tauri::Window) -> Result<(), RemindersError> {
    if crate::data_file::is_data_window(window.label()) {
        Ok(())
    } else {
        log::warn!("reminders: a command was refused for the window \"{}\"", window.label());
        Err(RemindersError::InvalidRequest)
    }
}

#[tauri::command]
pub async fn reminders_access_status(window: tauri::Window) -> Result<AccessStatus, RemindersError> {
    ensure_main_window(&window)?;
    run(|store| Ok(logic::access_status(store))).await
}

#[tauri::command]
pub async fn reminders_request_access(window: tauri::Window) -> Result<AccessStatus, RemindersError> {
    ensure_main_window(&window)?;
    run(|store| Ok(logic::request_access(store))).await
}

#[tauri::command]
pub async fn reminders_lists(window: tauri::Window) -> Result<Vec<ListInfo>, RemindersError> {
    ensure_main_window(&window)?;
    run(|store| logic::lists(store)).await
}

#[tauri::command]
pub async fn reminders_fetch(window: tauri::Window, list_ids: Vec<String>, completed_since: i64) -> Result<FetchResult, RemindersError> {
    ensure_main_window(&window)?;
    run(move |store| logic::fetch(store, &list_ids, completed_since)).await
}

#[tauri::command]
pub async fn reminders_set_due(
    window: tauri::Window,
    id: String,
    expected_date: Option<String>,
    date: Option<String>,
    allowed_list_ids: Vec<String>,
) -> Result<Option<Due>, RemindersError> {
    ensure_main_window(&window)?;
    run(move |store| logic::set_due(store, &id, expected_date.as_deref(), date.as_deref(), &allowed_list_ids)).await
}

#[tauri::command]
pub async fn reminders_set_completed(
    window: tauri::Window,
    id: String,
    completed: bool,
    occurrence_date: Option<String>,
    allowed_list_ids: Vec<String>,
) -> Result<Completion, RemindersError> {
    ensure_main_window(&window)?;
    run(move |store| logic::set_completed(store, &id, completed, occurrence_date.as_deref(), &allowed_list_ids)).await
}

#[tauri::command]
pub async fn reminders_open_settings(window: tauri::Window, app: tauri::AppHandle) -> Result<(), RemindersError> {
    ensure_main_window(&window)?;
    open_settings(&app)
}

#[cfg(target_os = "macos")]
fn open_settings(app: &tauri::AppHandle) -> Result<(), RemindersError> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(SETTINGS_URL, None::<&str>).map_err(|_| RemindersError::Failed)
}

#[cfg(not(target_os = "macos"))]
fn open_settings(_app: &tauri::AppHandle) -> Result<(), RemindersError> {
    Err(RemindersError::Unsupported)
}

/// EventKit behind [`RemindersStore`].
#[cfg(target_os = "macos")]
mod eventkit {
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObjectProtocol};
    use objc2::sel;
    use objc2_app_kit::NSColorSpace;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityType, EKEventStore, EKRecurrenceFrequency, EKReminder,
    };
    use objc2_foundation::{NSArray, NSCopying, NSDate, NSDateComponents, NSError, NSString};

    use super::*;

    /// `NSDateComponentUndefined`
    const UNDEFINED: isize = isize::MAX;
    /// How long a fetch may take before the call gives up.
    const FETCH_TIMEOUT: Duration = Duration::from_secs(60);
    /// How long the access prompt may wait for the user.
    const PROMPT_TIMEOUT: Duration = Duration::from_secs(10 * 60);

    pub struct EventKitStore {
        store: Retained<EKEventStore>,
    }

    impl EventKitStore {
        pub fn new() -> Self {
            // SAFETY: plain `init`; creating a store neither prompts nor reads.
            Self { store: unsafe { EKEventStore::new() } }
        }

        fn reminder_calendars(&self) -> Retained<NSArray<EKCalendar>> {
            // SAFETY: a read of the calendar list; the caller checked full access.
            unsafe { self.store.calendarsForEntityType(EKEntityType::Reminder) }
        }

        fn reminder(&self, id: &str) -> Option<Retained<EKReminder>> {
            let id = NSString::from_str(id);
            // SAFETY: a lookup by identifier.
            let item = unsafe { self.store.calendarItemWithIdentifier(&id) }?;
            let reminder = item.downcast::<EKReminder>().ok()?;
            // SAFETY: refresh pulls the stored state, so a change made in Reminders since the last read is seen.
            unsafe { reminder.refresh() };
            Some(reminder)
        }

        /// Runs a reminders fetch with `predicate` and maps each reminder inside the completion callback.
        fn fetch_with<T, M>(&self, predicate: &objc2_foundation::NSPredicate, map: M) -> Result<Vec<T>, RemindersError>
        where
            T: Send + 'static,
            M: Fn(&EKReminder) -> T + 'static,
        {
            let (sender, receiver) = mpsc::channel::<Vec<T>>();
            let block = RcBlock::new(move |found: *mut NSArray<EKReminder>| {
                // SAFETY: EventKit passes nil or a valid array that lives for the callback.
                let items = match unsafe { found.as_ref() } {
                    Some(array) => array.iter().map(|reminder| map(&reminder)).collect(),
                    None => Vec::new(),
                };
                let _ = sender.send(items);
            });
            // SAFETY: the block is valid for the call, EventKit copies it.
            let token = unsafe { self.store.fetchRemindersMatchingPredicate_completion(predicate, &block) };
            match receiver.recv_timeout(FETCH_TIMEOUT) {
                Ok(items) => Ok(items),
                Err(_) => {
                    // SAFETY: `token` is the value the fetch returned.
                    unsafe { self.store.cancelFetchRequest(&token) };
                    Err(RemindersError::Failed)
                }
            }
        }

        fn save(&self, reminder: &EKReminder) -> Result<(), RemindersError> {
            // SAFETY: saves one reminder and commits at once. A failure is rolled back so nothing stays pending.
            let saved = unsafe { self.store.saveReminder_commit_error(reminder, true) };
            match saved {
                Ok(()) => Ok(()),
                Err(_) => {
                    unsafe { reminder.rollback() };
                    Err(RemindersError::SaveFailed)
                }
            }
        }
    }

    pub fn status_of(status: EKAuthorizationStatus) -> AccessStatus {
        if status == EKAuthorizationStatus::NotDetermined {
            AccessStatus::NotDetermined
        } else if status == EKAuthorizationStatus::FullAccess {
            AccessStatus::Granted
        } else if status == EKAuthorizationStatus::WriteOnly {
            AccessStatus::WriteOnly
        } else if status == EKAuthorizationStatus::Restricted {
            AccessStatus::Restricted
        } else {
            AccessStatus::Denied
        }
    }

    /// The date part of due-date components; `None` when year, month or day is missing.
    pub fn due_of(components: &NSDateComponents) -> Option<Due> {
        let (year, month, day, hour, minute) =
            (components.year(), components.month(), components.day(), components.hour(), components.minute());
        if year == UNDEFINED || month == UNDEFINED || day == UNDEFINED || year < 1 {
            return None;
        }
        let time = (hour != UNDEFINED).then(|| format!("{:02}:{:02}", hour, if minute == UNDEFINED { 0 } else { minute }));
        Some(Due { date: format!("{:04}-{:02}-{:02}", year, month, day), time })
    }

    /// Year, month and day replaced on a copy of the existing components (hour, minute, time zone, calendar and
    /// every other component stay); a reminder without a date gets a date-only component.
    pub fn with_date(existing: Option<&NSDateComponents>, date: Ymd) -> Retained<NSDateComponents> {
        let components = match existing {
            Some(existing) => existing.copy(),
            None => NSDateComponents::new(),
        };
        components.setYear(date.year as isize);
        components.setMonth(date.month as isize);
        components.setDay(date.day as isize);
        components
    }

    fn rule_of(reminder: &EKReminder) -> Option<Recurrence> {
        // SAFETY: plain getters.
        unsafe {
            if !reminder.hasRecurrenceRules() {
                return None;
            }
            let rule = reminder.recurrenceRules()?.firstObject()?;
            let frequency = if rule.frequency() == EKRecurrenceFrequency::Daily {
                "DAILY"
            } else if rule.frequency() == EKRecurrenceFrequency::Weekly {
                "WEEKLY"
            } else if rule.frequency() == EKRecurrenceFrequency::Monthly {
                "MONTHLY"
            } else {
                "YEARLY"
            };
            Some(Recurrence { rule: format!("FREQ={};INTERVAL={}", frequency, rule.interval().max(1)) })
        }
    }

    fn snapshot_of(reminder: &EKReminder) -> Snapshot {
        // SAFETY: plain getters.
        unsafe {
            Snapshot {
                list_id: reminder.calendar().map(|calendar| calendar.calendarIdentifier().to_string()).unwrap_or_default(),
                completed: reminder.isCompleted(),
                due: reminder.dueDateComponents().and_then(|components| due_of(&components)),
                recurrence: rule_of(reminder),
            }
        }
    }

    fn record_of(reminder: &EKReminder) -> Reminder {
        let snapshot = snapshot_of(reminder);
        // SAFETY: plain getters.
        unsafe {
            Reminder {
                id: reminder.calendarItemIdentifier().to_string(),
                list_id: snapshot.list_id,
                title: reminder.title().to_string(),
                notes: reminder.notes().map(|notes| notes.to_string()).unwrap_or_default(),
                completed: snapshot.completed,
                completed_at: reminder.completionDate().map(|date| (date.timeIntervalSince1970() * 1000.0).round() as i64),
                due: snapshot.due,
                recurrence: snapshot.recurrence,
            }
        }
    }

    /// `#rrggbb` of a list's colour, best effort.
    fn hex_of(calendar: &EKCalendar) -> Option<String> {
        // SAFETY: colour getters on a calendar of the live store.
        unsafe {
            let color = calendar.color().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
            let channel = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
            Some(format!("#{:02x}{:02x}{:02x}", channel(color.redComponent()), channel(color.greenComponent()), channel(color.blueComponent())))
        }
    }

    impl RemindersStore for EventKitStore {
        fn access_status(&self) -> AccessStatus {
            // SAFETY: a class method that reads the permission and never prompts.
            status_of(unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Reminder) })
        }

        #[allow(deprecated)]
        fn prompt_for_access(&self) -> AccessStatus {
            let (sender, receiver) = mpsc::channel::<()>();
            let block = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
                let _ = sender.send(());
            });
            let handler = RcBlock::as_ptr(&block);
            // macOS 14 introduced the full-access request; older systems only know the entity-type one.
            // SAFETY: the block is valid for the call, EventKit copies it. This is the one place a prompt can start.
            unsafe {
                if self.store.respondsToSelector(sel!(requestFullAccessToRemindersWithCompletion:)) {
                    self.store.requestFullAccessToRemindersWithCompletion(handler);
                } else {
                    self.store.requestAccessToEntityType_completion(EKEntityType::Reminder, handler);
                }
            }
            let _ = receiver.recv_timeout(PROMPT_TIMEOUT);
            self.access_status()
        }

        fn lists(&self) -> Result<Vec<ListInfo>, RemindersError> {
            let counts = self.open_counts()?;
            let calendars = self.reminder_calendars();
            // SAFETY: plain getters.
            Ok(calendars
                .iter()
                .map(|calendar| unsafe {
                    let id = calendar.calendarIdentifier().to_string();
                    ListInfo {
                        open_count: counts.get(&id).copied().unwrap_or(0),
                        id,
                        title: calendar.title().to_string(),
                        color: hex_of(&calendar),
                        allows_writes: calendar.allowsContentModifications(),
                    }
                })
                .collect())
        }

        fn fetch(&self, list_ids: &[String], completed_since_ms: i64) -> Result<FetchResult, RemindersError> {
            let all = self.reminder_calendars();
            // SAFETY: identifier getters.
            let known: Vec<(String, Retained<EKCalendar>)> =
                all.iter().map(|calendar| (unsafe { calendar.calendarIdentifier() }.to_string(), calendar)).collect();
            let mut chosen: Vec<Retained<EKCalendar>> = Vec::new();
            let mut missing = Vec::new();
            for id in list_ids {
                match known.iter().find(|(known_id, _)| known_id == id) {
                    Some((_, calendar)) => chosen.push(calendar.clone()),
                    None => missing.push(id.clone()),
                }
            }
            if chosen.is_empty() {
                return Ok(FetchResult { reminders: Vec::new(), missing_list_ids: missing });
            }
            let calendars = NSArray::from_retained_slice(&chosen);
            // SAFETY: predicates over exactly the chosen calendars.
            let (open, done) = unsafe {
                let since = NSDate::dateWithTimeIntervalSince1970(completed_since_ms as f64 / 1000.0);
                (
                    self.store.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(None, None, Some(&calendars)),
                    self.store.predicateForCompletedRemindersWithCompletionDateStarting_ending_calendars(Some(&since), None, Some(&calendars)),
                )
            };
            let mut reminders = self.fetch_with(&open, record_of)?;
            reminders.extend(self.fetch_with(&done, record_of)?);
            Ok(FetchResult { reminders, missing_list_ids: missing })
        }

        fn read(&self, id: &str) -> Result<Option<Snapshot>, RemindersError> {
            Ok(self.reminder(id).map(|reminder| snapshot_of(&reminder)))
        }

        fn write_due(&self, id: &str, date: Option<Ymd>) -> Result<(), RemindersError> {
            let reminder = self.reminder(id).ok_or(RemindersError::NotFound)?;
            // SAFETY: sets only the due-date components, from a copy of the existing ones.
            unsafe {
                match date {
                    Some(date) => {
                        let existing = reminder.dueDateComponents();
                        reminder.setDueDateComponents(Some(&with_date(existing.as_deref(), date)));
                    }
                    None => reminder.setDueDateComponents(None),
                }
            }
            self.save(&reminder)
        }

        fn write_completed(&self, id: &str, completed: bool) -> Result<(), RemindersError> {
            let reminder = self.reminder(id).ok_or(RemindersError::NotFound)?;
            // SAFETY: sets only the completed flag.
            unsafe { reminder.setCompleted(completed) };
            self.save(&reminder)
        }
    }

    impl EventKitStore {
        /// Incomplete reminders per list (one fetch over every reminder list, only the counts leave the callback).
        fn open_counts(&self) -> Result<HashMap<String, u32>, RemindersError> {
            // SAFETY: a predicate over all reminder calendars.
            let predicate = unsafe { self.store.predicateForIncompleteRemindersWithDueDateStarting_ending_calendars(None, None, None) };
            let lists = self.fetch_with(&predicate, |reminder| unsafe { reminder.calendar().map(|calendar| calendar.calendarIdentifier().to_string()) })?;
            let mut counts: HashMap<String, u32> = HashMap::new();
            for id in lists.into_iter().flatten() {
                *counts.entry(id).or_default() += 1;
            }
            Ok(counts)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use objc2_foundation::NSTimeZone;

        fn components(year: isize, month: isize, day: isize, time: Option<(isize, isize)>, zone: Option<&str>) -> Retained<NSDateComponents> {
            // Foundation value objects: no EventKit and no permission involved.
            let c = NSDateComponents::new();
            c.setYear(year);
            c.setMonth(month);
            c.setDay(day);
            if let Some((hour, minute)) = time {
                c.setHour(hour);
                c.setMinute(minute);
            }
            if let Some(zone) = zone {
                c.setTimeZone(NSTimeZone::timeZoneWithName(&NSString::from_str(zone)).as_deref());
            }
            c
        }

        #[test]
        fn due_of_reads_the_components_as_they_are() {
            let c = components(2026, 11, 20, None, None);
            assert_eq!(due_of(&c), Some(Due { date: "2026-11-20".into(), time: None }));
            let c = components(2026, 1, 5, Some((9, 5)), Some("Pacific/Kiritimati"));
            assert_eq!(due_of(&c), Some(Due { date: "2026-01-05".into(), time: Some("09:05".into()) }));
        }

        #[test]
        fn due_of_without_a_day_is_none() {
            let c = NSDateComponents::new();
            c.setHour(8);
            assert_eq!(due_of(&c), None);
        }

        #[test]
        fn with_date_keeps_hour_minute_and_time_zone() {
            let existing = components(2026, 11, 20, Some((23, 45)), Some("Pacific/Kiritimati"));
            let moved = with_date(Some(&existing), Ymd { year: 2026, month: 11, day: 21 });
            assert_eq!(due_of(&moved), Some(Due { date: "2026-11-21".into(), time: Some("23:45".into()) }));
            let zone = moved.timeZone().map(|zone| zone.name().to_string());
            assert_eq!(zone.as_deref(), Some("Pacific/Kiritimati"));
            // The original is untouched.
            assert_eq!(due_of(&existing).map(|due| due.date), Some("2026-11-20".into()));
        }

        #[test]
        fn with_date_on_no_date_is_date_only_and_floating() {
            let made = with_date(None, Ymd { year: 2026, month: 2, day: 28 });
            assert_eq!(due_of(&made), Some(Due { date: "2026-02-28".into(), time: None }));
            assert!(made.timeZone().is_none());
            assert_eq!(made.hour(), UNDEFINED);
        }

        /// Reads the real permission through EventKit: never prompts and reads no reminder. Ignored by default so a
        /// plain `cargo test` never depends on the machine's privacy settings; run it with `-- --ignored`.
        #[test]
        #[ignore]
        fn the_real_status_read_links_and_does_not_prompt() {
            let store = EventKitStore::new();
            let status = store.access_status();
            assert!(matches!(
                status,
                AccessStatus::NotDetermined | AccessStatus::Granted | AccessStatus::Denied | AccessStatus::Restricted | AccessStatus::WriteOnly
            ));
            // Without full access the guarded reads refuse before any EventKit read.
            if status != AccessStatus::Granted {
                assert_eq!(logic::lists(&store), Err(RemindersError::AccessDenied));
            }
        }

        #[test]
        fn status_mapping_covers_every_eventkit_status() {
            assert_eq!(status_of(EKAuthorizationStatus::NotDetermined), AccessStatus::NotDetermined);
            assert_eq!(status_of(EKAuthorizationStatus::Restricted), AccessStatus::Restricted);
            assert_eq!(status_of(EKAuthorizationStatus::Denied), AccessStatus::Denied);
            assert_eq!(status_of(EKAuthorizationStatus::FullAccess), AccessStatus::Granted);
            assert_eq!(status_of(EKAuthorizationStatus::WriteOnly), AccessStatus::WriteOnly);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::{Cell, RefCell};

    use super::*;

    /// The due date as EventKit's components hold it.
    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Parts {
        ymd: Ymd,
        hour: Option<u32>,
        minute: Option<u32>,
        time_zone: Option<&'static str>,
    }

    impl Parts {
        fn date(year: i32, month: u32, day: u32) -> Parts {
            Parts { ymd: Ymd { year, month, day }, hour: None, minute: None, time_zone: None }
        }
        fn at(mut self, hour: u32, minute: u32, zone: &'static str) -> Parts {
            self.hour = Some(hour);
            self.minute = Some(minute);
            self.time_zone = Some(zone);
            self
        }
        fn due(&self) -> Due {
            Due {
                date: self.ymd.to_string(),
                time: self.hour.map(|hour| format!("{:02}:{:02}", hour, self.minute.unwrap_or(0))),
            }
        }
    }

    /// What ticking a recurring reminder does in the fake (unverified in the real store until the Mac check).
    #[derive(Clone)]
    enum OnComplete {
        /// A plain reminder: becomes completed.
        Complete,
        /// A recurring one that moves to its next date and stays open.
        NextDate(Parts),
        /// A recurring one whose series ends: completed, no further date.
        SeriesEnds,
    }

    #[derive(Clone)]
    struct Item {
        id: &'static str,
        list_id: &'static str,
        title: &'static str,
        completed: bool,
        completed_at: Option<i64>,
        parts: Option<Parts>,
        recurrence: Option<&'static str>,
        on_complete: OnComplete,
    }

    fn item(id: &'static str, list_id: &'static str, parts: Option<Parts>) -> Item {
        Item { id, list_id, title: "Task", completed: false, completed_at: None, parts, recurrence: None, on_complete: OnComplete::Complete }
    }

    struct Fake {
        status: Cell<AccessStatus>,
        answer: AccessStatus,
        prompts: Cell<u32>,
        lists: Vec<ListInfo>,
        items: RefCell<Vec<Item>>,
        /// Lists the fake was asked to read, in order.
        list_reads: RefCell<Vec<String>>,
        /// `id: what` for every save.
        saves: RefCell<Vec<String>>,
        fail_saves: Cell<bool>,
        swallow_saves: Cell<bool>,
    }

    impl Fake {
        fn new(items: Vec<Item>) -> Fake {
            let list = |id: &str, title: &str| ListInfo { id: id.into(), title: title.into(), color: None, open_count: 0, allows_writes: true };
            Fake {
                status: Cell::new(AccessStatus::Granted),
                answer: AccessStatus::Granted,
                prompts: Cell::new(0),
                lists: vec![list("L1", "Today"), list("L2", "Work"), list("L3", "Private")],
                items: RefCell::new(items),
                list_reads: RefCell::new(Vec::new()),
                saves: RefCell::new(Vec::new()),
                fail_saves: Cell::new(false),
                swallow_saves: Cell::new(false),
            }
        }
        fn item(&self, id: &str) -> Item {
            self.items.borrow().iter().find(|item| item.id == id).cloned().expect("item")
        }
    }

    fn snapshot(item: &Item) -> Snapshot {
        Snapshot {
            list_id: item.list_id.into(),
            completed: item.completed,
            due: item.parts.as_ref().map(Parts::due),
            recurrence: item.recurrence.map(|rule| Recurrence { rule: rule.into() }),
        }
    }

    impl RemindersStore for Fake {
        fn access_status(&self) -> AccessStatus {
            self.status.get()
        }
        fn prompt_for_access(&self) -> AccessStatus {
            self.prompts.set(self.prompts.get() + 1);
            self.status.set(self.answer);
            self.answer
        }
        fn lists(&self) -> Result<Vec<ListInfo>, RemindersError> {
            Ok(self.lists.clone())
        }
        fn fetch(&self, list_ids: &[String], completed_since_ms: i64) -> Result<FetchResult, RemindersError> {
            let mut missing = Vec::new();
            for id in list_ids {
                if self.lists.iter().any(|list| list.id == *id) {
                    self.list_reads.borrow_mut().push(id.clone());
                } else {
                    missing.push(id.clone());
                }
            }
            let reminders = self
                .items
                .borrow()
                .iter()
                .filter(|item| list_ids.iter().any(|id| id == item.list_id))
                .filter(|item| !item.completed || item.completed_at.is_some_and(|at| at >= completed_since_ms))
                .map(|item| {
                    let snap = snapshot(item);
                    Reminder {
                        id: item.id.into(),
                        list_id: snap.list_id,
                        title: item.title.into(),
                        notes: String::new(),
                        completed: snap.completed,
                        completed_at: item.completed_at,
                        due: snap.due,
                        recurrence: snap.recurrence,
                    }
                })
                .collect();
            Ok(FetchResult { reminders, missing_list_ids: missing })
        }
        fn read(&self, id: &str) -> Result<Option<Snapshot>, RemindersError> {
            Ok(self.items.borrow().iter().find(|item| item.id == id).map(snapshot))
        }
        fn write_due(&self, id: &str, date: Option<Ymd>) -> Result<(), RemindersError> {
            if self.fail_saves.get() {
                return Err(RemindersError::SaveFailed);
            }
            self.saves.borrow_mut().push(format!("{id}: due {}", date.map(|d| d.to_string()).unwrap_or_else(|| "none".into())));
            if self.swallow_saves.get() {
                return Ok(());
            }
            let mut items = self.items.borrow_mut();
            let item = items.iter_mut().find(|item| item.id == id).ok_or(RemindersError::NotFound)?;
            // Year, month and day only; everything else of the components stays.
            item.parts = match (item.parts.take(), date) {
                (Some(mut parts), Some(date)) => {
                    parts.ymd = date;
                    Some(parts)
                }
                (None, Some(date)) => Some(Parts { ymd: date, hour: None, minute: None, time_zone: None }),
                (_, None) => None,
            };
            Ok(())
        }
        fn write_completed(&self, id: &str, completed: bool) -> Result<(), RemindersError> {
            if self.fail_saves.get() {
                return Err(RemindersError::SaveFailed);
            }
            self.saves.borrow_mut().push(format!("{id}: completed {completed}"));
            let mut items = self.items.borrow_mut();
            let item = items.iter_mut().find(|item| item.id == id).ok_or(RemindersError::NotFound)?;
            match (completed, item.on_complete.clone()) {
                (true, OnComplete::NextDate(next)) => item.parts = Some(next),
                (true, OnComplete::SeriesEnds) => item.completed = true,
                (flag, _) => {
                    item.completed = flag;
                    item.completed_at = flag.then_some(1_000);
                }
            }
            Ok(())
        }
    }

    fn ids(list: &[&str]) -> Vec<String> {
        list.iter().map(|id| id.to_string()).collect()
    }

    // --- access ---

    #[test]
    fn only_request_access_can_prompt_and_only_when_undecided() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 20)))]);
        fake.status.set(AccessStatus::NotDetermined);
        assert_eq!(logic::access_status(&fake), AccessStatus::NotDetermined);
        assert_eq!(logic::lists(&fake), Err(RemindersError::AccessDenied));
        assert_eq!(logic::fetch(&fake, &ids(&["L1"]), 0), Err(RemindersError::AccessDenied));
        assert_eq!(logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"])), Err(RemindersError::AccessDenied));
        assert_eq!(logic::set_completed(&fake, "a", true, None, &ids(&["L1"])), Err(RemindersError::AccessDenied));
        assert_eq!(fake.prompts.get(), 0);
        assert!(fake.saves.borrow().is_empty());

        assert_eq!(logic::request_access(&fake), AccessStatus::Granted);
        assert_eq!(fake.prompts.get(), 1);
        // Answered: asking again never prompts again.
        assert_eq!(logic::request_access(&fake), AccessStatus::Granted);
        assert_eq!(fake.prompts.get(), 1);
    }

    #[test]
    fn a_denied_answer_is_reported_and_does_not_prompt_again() {
        let mut fake = Fake::new(vec![]);
        fake.answer = AccessStatus::Denied;
        fake.status.set(AccessStatus::NotDetermined);
        assert_eq!(logic::request_access(&fake), AccessStatus::Denied);
        assert_eq!(logic::request_access(&fake), AccessStatus::Denied);
        assert_eq!(fake.prompts.get(), 1);
    }

    #[test]
    fn every_status_but_granted_blocks_reads_and_writes() {
        for status in [AccessStatus::NotDetermined, AccessStatus::Denied, AccessStatus::Restricted, AccessStatus::WriteOnly] {
            let fake = Fake::new(vec![item("a", "L1", None)]);
            fake.status.set(status);
            assert_eq!(logic::lists(&fake), Err(RemindersError::AccessDenied), "{status:?}");
            assert_eq!(logic::fetch(&fake, &ids(&["L1"]), 0), Err(RemindersError::AccessDenied), "{status:?}");
            assert_eq!(logic::set_due(&fake, "a", None, Some("2026-11-21"), &ids(&["L1"])), Err(RemindersError::AccessDenied), "{status:?}");
            assert!(fake.saves.borrow().is_empty());
            assert!(fake.list_reads.borrow().is_empty());
        }
    }

    // --- reading ---

    #[test]
    fn fetch_reads_only_the_listed_lists_and_reports_missing_ones() {
        let fake = Fake::new(vec![
            item("a", "L1", None),
            item("b", "L2", None),
            item("c", "L3", None),
        ]);
        let result = logic::fetch(&fake, &ids(&["L1", "L2", "L1", "GONE"]), 0).unwrap();
        assert_eq!(result.missing_list_ids, ids(&["GONE"]));
        let mut found: Vec<&str> = result.reminders.iter().map(|r| r.id.as_str()).collect();
        found.sort();
        assert_eq!(found, vec!["a", "b"]);
        // L3 is switched off: never read. A duplicate id is read once.
        assert_eq!(*fake.list_reads.borrow(), ids(&["L1", "L2"]));
    }

    #[test]
    fn fetch_without_lists_reads_nothing() {
        let fake = Fake::new(vec![item("a", "L1", None)]);
        let result = logic::fetch(&fake, &[], 0).unwrap();
        assert!(result.reminders.is_empty() && result.missing_list_ids.is_empty());
        assert!(fake.list_reads.borrow().is_empty());
    }

    #[test]
    fn fetch_keeps_open_reminders_and_those_completed_since() {
        let mut old = item("old", "L1", None);
        old.completed = true;
        old.completed_at = Some(500);
        let mut today = item("today", "L1", None);
        today.completed = true;
        today.completed_at = Some(2_000);
        let fake = Fake::new(vec![item("open", "L1", None), old, today]);
        let result = logic::fetch(&fake, &ids(&["L1"]), 1_000).unwrap();
        let mut found: Vec<&str> = result.reminders.iter().map(|r| r.id.as_str()).collect();
        found.sort();
        assert_eq!(found, vec!["open", "today"]);
    }

    #[test]
    fn fetch_reports_due_time_and_recurrence() {
        let mut daily = item("r", "L1", Some(Parts::date(2026, 11, 20).at(9, 30, "Europe/Berlin")));
        daily.recurrence = Some("FREQ=WEEKLY;INTERVAL=2");
        let fake = Fake::new(vec![daily, item("none", "L1", None)]);
        let result = logic::fetch(&fake, &ids(&["L1"]), 0).unwrap();
        let by = |id: &str| result.reminders.iter().find(|r| r.id == id).unwrap().clone();
        assert_eq!(by("r").due, Some(Due { date: "2026-11-20".into(), time: Some("09:30".into()) }));
        assert_eq!(by("r").recurrence, Some(Recurrence { rule: "FREQ=WEEKLY;INTERVAL=2".into() }));
        assert_eq!(by("none").due, None);
        assert_eq!(by("none").recurrence, None);
    }

    // --- set_due ---

    #[test]
    fn set_due_writes_the_date_and_answers_with_the_stored_state() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 20)))]);
        let due = logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"])).unwrap();
        assert_eq!(due, Some(Due { date: "2026-11-21".into(), time: None }));
        assert_eq!(*fake.saves.borrow(), vec!["a: due 2026-11-21".to_string()]);
    }

    #[test]
    fn set_due_on_a_moved_date_writes_nothing_and_answers_changed() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 25)))]);
        let result = logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"]));
        assert_eq!(result, Err(RemindersError::Changed));
        assert!(fake.saves.borrow().is_empty());
        assert_eq!(fake.item("a").parts, Some(Parts::date(2026, 11, 25)));
    }

    #[test]
    fn set_due_expecting_none_on_a_reminder_that_got_a_date_is_changed() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 25)))]);
        assert_eq!(logic::set_due(&fake, "a", None, Some("2026-11-21"), &ids(&["L1"])), Err(RemindersError::Changed));
        assert!(fake.saves.borrow().is_empty());
    }

    #[test]
    fn set_due_keeps_hour_minute_and_time_zone() {
        let timed = Parts::date(2026, 11, 20).at(23, 45, "Pacific/Kiritimati");
        let fake = Fake::new(vec![item("a", "L1", Some(timed))]);
        let due = logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-22"), &ids(&["L1"])).unwrap();
        assert_eq!(due, Some(Due { date: "2026-11-22".into(), time: Some("23:45".into()) }));
        assert_eq!(fake.item("a").parts, Some(Parts::date(2026, 11, 22).at(23, 45, "Pacific/Kiritimati")));
    }

    #[test]
    fn set_due_on_a_reminder_without_a_date_writes_a_date_only_component() {
        let fake = Fake::new(vec![item("a", "L1", None)]);
        let due = logic::set_due(&fake, "a", None, Some("2026-11-20"), &ids(&["L1"])).unwrap();
        assert_eq!(due, Some(Due { date: "2026-11-20".into(), time: None }));
        assert_eq!(fake.item("a").parts, Some(Parts::date(2026, 11, 20)));
    }

    #[test]
    fn set_due_with_null_restores_a_reminder_that_had_no_date() {
        let fake = Fake::new(vec![item("a", "L1", None)]);
        logic::set_due(&fake, "a", None, Some("2026-11-20"), &ids(&["L1"])).unwrap();
        let due = logic::set_due(&fake, "a", Some("2026-11-20"), None, &ids(&["L1"])).unwrap();
        assert_eq!(due, None);
        assert_eq!(fake.item("a").parts, None);
        // Still compare-and-set: a moved date is not cleared.
        let moved = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 25)))]);
        assert_eq!(logic::set_due(&moved, "a", Some("2026-11-20"), None, &ids(&["L1"])), Err(RemindersError::Changed));
        assert!(moved.saves.borrow().is_empty());
    }

    #[test]
    fn set_due_twice_is_a_no_op_success() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 20)))]);
        let first = logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"])).unwrap();
        // The same call again (a double submit): the target is in place, nothing is written, no `changed`.
        let second = logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"])).unwrap();
        assert_eq!(first, second);
        assert_eq!(fake.saves.borrow().len(), 1);
    }

    #[test]
    fn set_due_refuses_a_reminder_outside_the_allowed_lists() {
        let fake = Fake::new(vec![item("a", "L3", Some(Parts::date(2026, 11, 20)))]);
        assert_eq!(logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1", "L2"])), Err(RemindersError::NotRead));
        assert_eq!(logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &[]), Err(RemindersError::NotRead));
        assert!(fake.saves.borrow().is_empty());
    }

    #[test]
    fn set_due_on_a_missing_reminder_is_not_found() {
        let fake = Fake::new(vec![]);
        assert_eq!(logic::set_due(&fake, "x", None, Some("2026-11-21"), &ids(&["L1"])), Err(RemindersError::NotFound));
    }

    #[test]
    fn a_failed_save_leaves_the_reminder_as_it_was() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 20)))]);
        fake.fail_saves.set(true);
        assert_eq!(logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"])), Err(RemindersError::SaveFailed));
        assert_eq!(fake.item("a").parts, Some(Parts::date(2026, 11, 20)));
        assert_eq!(logic::set_completed(&fake, "a", true, None, &ids(&["L1"])), Err(RemindersError::SaveFailed));
        assert!(!fake.item("a").completed);
    }

    #[test]
    fn a_save_the_store_swallowed_is_reported_not_assumed() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 20)))]);
        fake.swallow_saves.set(true);
        assert_eq!(logic::set_due(&fake, "a", Some("2026-11-20"), Some("2026-11-21"), &ids(&["L1"])), Err(RemindersError::SaveFailed));
    }

    #[test]
    fn set_due_rejects_malformed_dates_before_reading() {
        let fake = Fake::new(vec![item("a", "L1", None)]);
        for bad in ["2026-13-01", "2026-02-30", "26-11-20", "2026/11/20", "2026-11-2", "", "2026-11-20T00:00:00Z"] {
            assert_eq!(logic::set_due(&fake, "a", None, Some(bad), &ids(&["L1"])), Err(RemindersError::InvalidRequest), "{bad}");
            assert_eq!(logic::set_due(&fake, "a", Some(bad), Some("2026-11-20"), &ids(&["L1"])), Err(RemindersError::InvalidRequest), "{bad}");
        }
        assert_eq!(logic::set_due(&fake, "", None, Some("2026-11-20"), &ids(&["L1"])), Err(RemindersError::InvalidRequest));
        assert!(fake.saves.borrow().is_empty());
    }

    // --- set_completed ---

    #[test]
    fn set_completed_ticks_and_unticks_one_reminder() {
        let fake = Fake::new(vec![item("a", "L1", Some(Parts::date(2026, 11, 20))), item("b", "L1", None)]);
        let done = logic::set_completed(&fake, "a", true, None, &ids(&["L1"])).unwrap();
        assert_eq!(done, Completion { completed: true, due: Some(Due { date: "2026-11-20".into(), time: None }) });
        assert!(!fake.item("b").completed);
        let open = logic::set_completed(&fake, "a", false, None, &ids(&["L1"])).unwrap();
        assert!(!open.completed);
    }

    #[test]
    fn set_completed_twice_is_a_no_op_success() {
        let fake = Fake::new(vec![item("a", "L1", None)]);
        logic::set_completed(&fake, "a", true, None, &ids(&["L1"])).unwrap();
        let again = logic::set_completed(&fake, "a", true, None, &ids(&["L1"])).unwrap();
        assert!(again.completed);
        assert_eq!(fake.saves.borrow().len(), 1);
    }

    #[test]
    fn set_completed_refuses_a_reminder_outside_the_allowed_lists() {
        let fake = Fake::new(vec![item("a", "L3", None)]);
        assert_eq!(logic::set_completed(&fake, "a", true, None, &ids(&["L1"])), Err(RemindersError::NotRead));
        assert!(fake.saves.borrow().is_empty());
    }

    #[test]
    fn ticking_a_recurring_reminder_reports_the_date_that_follows() {
        let mut weekly = item("r", "L1", Some(Parts::date(2026, 11, 20).at(9, 0, "Europe/Berlin")));
        weekly.recurrence = Some("FREQ=WEEKLY;INTERVAL=1");
        weekly.on_complete = OnComplete::NextDate(Parts::date(2026, 11, 27).at(9, 0, "Europe/Berlin"));
        let fake = Fake::new(vec![weekly]);
        let result = logic::set_completed(&fake, "r", true, Some("2026-11-20"), &ids(&["L1"])).unwrap();
        // The moved date is the next occurrence, not an error.
        assert_eq!(result, Completion { completed: false, due: Some(Due { date: "2026-11-27".into(), time: Some("09:00".into()) }) });
    }

    #[test]
    fn ticking_the_last_occurrence_reports_the_series_ended() {
        let mut last = item("r", "L1", None);
        last.recurrence = Some("FREQ=DAILY;INTERVAL=1");
        last.on_complete = OnComplete::SeriesEnds;
        let fake = Fake::new(vec![last]);
        let result = logic::set_completed(&fake, "r", true, None, &ids(&["L1"])).unwrap();
        assert_eq!(result, Completion { completed: true, due: None });
    }

    #[test]
    fn ticking_an_occurrence_that_is_already_gone_is_changed() {
        let mut weekly = item("r", "L1", Some(Parts::date(2026, 11, 27)));
        weekly.recurrence = Some("FREQ=WEEKLY;INTERVAL=1");
        weekly.on_complete = OnComplete::NextDate(Parts::date(2026, 12, 4));
        let fake = Fake::new(vec![weekly]);
        // kan-do still holds the 20th; the reminder is already on the 27th.
        assert_eq!(logic::set_completed(&fake, "r", true, Some("2026-11-20"), &ids(&["L1"])), Err(RemindersError::Changed));
        assert!(fake.saves.borrow().is_empty());
    }

    #[test]
    fn ticking_a_dated_recurring_reminder_without_an_occurrence_is_changed() {
        // A retried tick that carries no occurrence must not tick the occurrence that followed the first one.
        let mut weekly = item("r", "L1", Some(Parts::date(2026, 11, 27)));
        weekly.recurrence = Some("FREQ=WEEKLY;INTERVAL=1");
        weekly.on_complete = OnComplete::NextDate(Parts::date(2026, 12, 4));
        let fake = Fake::new(vec![weekly]);
        assert_eq!(logic::set_completed(&fake, "r", true, None, &ids(&["L1"])), Err(RemindersError::Changed));
        assert!(fake.saves.borrow().is_empty());
    }

    #[test]
    fn a_swallowed_tick_on_a_plain_reminder_is_reported() {
        struct Swallow(Fake);
        impl RemindersStore for Swallow {
            fn access_status(&self) -> AccessStatus { self.0.access_status() }
            fn prompt_for_access(&self) -> AccessStatus { self.0.prompt_for_access() }
            fn lists(&self) -> Result<Vec<ListInfo>, RemindersError> { self.0.lists() }
            fn fetch(&self, l: &[String], s: i64) -> Result<FetchResult, RemindersError> { self.0.fetch(l, s) }
            fn read(&self, id: &str) -> Result<Option<Snapshot>, RemindersError> { self.0.read(id) }
            fn write_due(&self, id: &str, d: Option<Ymd>) -> Result<(), RemindersError> { self.0.write_due(id, d) }
            fn write_completed(&self, _: &str, _: bool) -> Result<(), RemindersError> { Ok(()) }
        }
        let store = Swallow(Fake::new(vec![item("a", "L1", None)]));
        assert_eq!(logic::set_completed(&store, "a", true, None, &ids(&["L1"])), Err(RemindersError::SaveFailed));
    }

    // --- dates, wire format, module contract ---

    #[test]
    fn ymd_parses_real_calendar_days_only() {
        assert_eq!(Ymd::parse("2026-11-20"), Some(Ymd { year: 2026, month: 11, day: 20 }));
        assert_eq!(Ymd::parse("2028-02-29").map(|d| d.day), Some(29));
        assert_eq!(Ymd::parse("2026-02-29"), None);
        assert_eq!(Ymd::parse("2100-02-29"), None);
        assert_eq!(Ymd::parse("2000-02-29").map(|d| d.day), Some(29));
        assert_eq!(Ymd::parse("2026-00-10"), None);
        assert_eq!(Ymd::parse("2026-04-31"), None);
        assert_eq!(Ymd::parse("+026-04-30"), None);
        assert_eq!(Ymd { year: 2026, month: 1, day: 5 }.to_string(), "2026-01-05");
    }

    #[test]
    fn the_wire_format_is_the_contract_of_the_web_wrapper() {
        assert_eq!(serde_json::to_string(&AccessStatus::NotDetermined).unwrap(), "\"notDetermined\"");
        assert_eq!(serde_json::to_string(&AccessStatus::WriteOnly).unwrap(), "\"writeOnly\"");
        assert_eq!(serde_json::to_string(&RemindersError::AccessDenied).unwrap(), "\"access-denied\"");
        assert_eq!(serde_json::to_string(&RemindersError::NotRead).unwrap(), "\"not-read\"");
        assert_eq!(serde_json::to_string(&RemindersError::SaveFailed).unwrap(), "\"save-failed\"");
        let reminder = Reminder {
            id: "i".into(),
            list_id: "l".into(),
            title: "t".into(),
            notes: String::new(),
            completed: false,
            completed_at: None,
            due: Some(Due { date: "2026-11-20".into(), time: None }),
            recurrence: None,
        };
        assert_eq!(
            serde_json::to_value(&reminder).unwrap(),
            serde_json::json!({
                "id": "i", "listId": "l", "title": "t", "notes": "", "completed": false, "completedAt": null,
                "due": { "date": "2026-11-20", "time": null }, "recurrence": null
            })
        );
        let list = ListInfo { id: "l".into(), title: "t".into(), color: Some("#112233".into()), open_count: 3, allows_writes: false };
        assert_eq!(
            serde_json::to_value(&list).unwrap(),
            serde_json::json!({ "id": "l", "title": "t", "color": "#112233", "openCount": 3, "allowsWrites": false })
        );
        assert_eq!(
            serde_json::to_value(&FetchResult { reminders: vec![], missing_list_ids: ids(&["x"]) }).unwrap(),
            serde_json::json!({ "reminders": [], "missingListIds": ["x"] })
        );
    }

    #[test]
    fn the_settings_url_is_the_reminders_privacy_pane() {
        assert_eq!(SETTINGS_URL, "x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders");
    }

    /// The permission copy promises that kan-do never creates, deletes, moves or edits the text of a reminder: the
    /// production code must not mention a call that does.
    #[test]
    fn production_code_has_no_create_delete_move_or_text_edit() {
        let source = include_str!("reminders.rs");
        let marker = concat!("#[cfg(test)]", "\nmod tests {");
        let production = source.split(marker).next().unwrap();
        for forbidden in [
            "removeReminder",
            "reminderWithEventStore",
            "saveCalendar",
            "removeCalendar",
            "setTitle",
            "setNotes",
            "setCalendar",
            "setAlarms",
            "setRecurrenceRules",
            "setStartDateComponents",
            "EKReminder::new",
            "EKReminder::init",
        ] {
            assert!(!production.contains(forbidden), "reminders.rs production code mentions {forbidden}");
        }
    }
}
