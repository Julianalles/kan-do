//! `bridge_request`: the only way the webview talks to the MCP Worker (ADR 023, the pattern of `github_request`, ADR 007).
//!
//! The sync token (Keychain entry `mcp-sync-token`) never reaches JS, and the Worker's address is kept by Rust too:
//! `mcp-bridge.json` in the app config dir (machine-local, never the data file). What may be asked of it is pinned:
//! three routes, each with one method. The webview therefore needs no `connect-src` entry (ADR 012 keeps Rust-side hosts
//! out of the CSP) and a compromised page cannot aim the token at another host or route.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, State};
use tauri_plugin_http::reqwest;

use crate::secrets::{SecretEntry, SecretError, Secrets};

pub const CONFIG_FILE: &str = "mcp-bridge.json";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// A snapshot of a busy day is a few kB; the Worker refuses more than 256 kB itself.
const MAX_BODY_BYTES: usize = 256 * 1024;
const USER_AGENT: &str = "kan-do-desktop";

#[derive(Debug, Serialize)]
pub struct BridgeResponse {
    pub status: u16,
    pub body: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct Config {
    #[serde(rename = "baseUrl")]
    base_url: String,
}

/// The origin (`https://host`) of a Worker address the user typed, or [`SecretError::InvalidRequest`].
///
/// Accepted: a public `https` host name with at most a trailing slash. Refused: other schemes, user info, ports, paths,
/// queries, fragments, IP literals, single-label and local names (`localhost`, `*.local`, `*.internal`), so the token
/// can only go to a real public host name the user typed.
pub fn normalize_base(input: &str) -> Result<String, SecretError> {
    let invalid = Err(SecretError::InvalidRequest);
    let Ok(url) = reqwest::Url::parse(input.trim()) else { return invalid };
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !(url.path().is_empty() || url.path() == "/")
    {
        return invalid;
    }
    // `domain()` is `None` for an IP literal.
    let Some(host) = url.domain() else { return invalid };
    let host = host.to_ascii_lowercase();
    let local = host.ends_with(".local") || host.ends_with(".internal") || host.ends_with(".localhost");
    if !host.contains('.') || host.ends_with('.') || local {
        return invalid;
    }
    Ok(format!("https://{host}"))
}

/// Routes the Worker offers the app, each with its one method: `PUT /sync/snapshot`, `GET /sync/commands`,
/// `POST /sync/commands/<id>/result`.
pub fn validate_route(method: &str, path: &str) -> Result<reqwest::Method, SecretError> {
    let refused = Err(SecretError::InvalidRequest);
    let allowed = match (method, path) {
        ("PUT", "/sync/snapshot") | ("GET", "/sync/commands") => true,
        ("POST", _) => path
            .strip_prefix("/sync/commands/")
            .and_then(|rest| rest.strip_suffix("/result"))
            .is_some_and(|id| !id.is_empty() && id.len() <= 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')),
        _ => false,
    };
    if !allowed {
        return refused;
    }
    match method {
        "PUT" => Ok(reqwest::Method::PUT),
        "POST" => Ok(reqwest::Method::POST),
        _ => Ok(reqwest::Method::GET),
    }
}

fn config_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(CONFIG_FILE))
}

/// The saved base URL. A missing, unreadable or malformed file reads as "not configured"; a stored value is checked again.
fn read_base(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let config: Config = serde_json::from_str(&text).ok()?;
    normalize_base(&config.base_url).ok()
}

fn write_base(path: &Path, base: &str) -> Result<(), SecretError> {
    let dir = path.parent().ok_or(SecretError::InvalidRequest)?;
    std::fs::create_dir_all(dir).map_err(|_| SecretError::InvalidRequest)?;
    let text = serde_json::to_string(&Config { base_url: base.to_owned() }).map_err(|_| SecretError::InvalidRequest)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|_| SecretError::InvalidRequest)?;
    std::fs::rename(&tmp, path).map_err(|_| SecretError::InvalidRequest)
}

fn map_transport_error(error: &reqwest::Error) -> SecretError {
    if error.is_timeout() { SecretError::Timeout } else { SecretError::Network }
}

/// Runs one pinned request against `base` with the stored sync token. All validation happens before the token is read.
pub async fn execute(
    secrets: &Secrets,
    base: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<BridgeResponse, SecretError> {
    let method = validate_route(method, path)?;
    let payload = match body {
        Some(value) => {
            let bytes = serde_json::to_vec(&value).map_err(|_| SecretError::InvalidRequest)?;
            if bytes.len() > MAX_BODY_BYTES {
                return Err(SecretError::TooLarge);
            }
            Some(bytes)
        }
        None => None,
    };
    if secrets.is_rejected(SecretEntry::McpSync) {
        return Err(SecretError::Rejected);
    }
    let (token, epoch) = secrets.get_with_epoch(SecretEntry::McpSync)?;
    let token = token.ok_or(SecretError::NotConfigured)?;

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        // The token must not follow a redirect anywhere.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| SecretError::Network)?;
    let mut auth = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| SecretError::InvalidRequest)?;
    auth.set_sensitive(true);
    let mut request = client
        .request(method, format!("{base}{path}"))
        .header(reqwest::header::AUTHORIZATION, auth)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, USER_AGENT);
    if let Some(bytes) = payload {
        request = request.header(reqwest::header::CONTENT_TYPE, "application/json").body(bytes);
    }

    let mut response = request.send().await.map_err(|e| map_transport_error(&e))?;
    let status = response.status().as_u16();
    if status == 401 {
        secrets.mark_rejected_if(SecretEntry::McpSync, epoch);
        return Err(SecretError::Rejected);
    }
    if response.content_length().is_some_and(|len| len > MAX_BODY_BYTES as u64) {
        return Err(SecretError::TooLarge);
    }
    let mut buffer: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| map_transport_error(&e))? {
        if buffer.len() + chunk.len() > MAX_BODY_BYTES {
            return Err(SecretError::TooLarge);
        }
        buffer.extend_from_slice(&chunk);
    }
    let body = if buffer.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&buffer).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&buffer).into_owned()))
    };
    Ok(BridgeResponse { status, body })
}

/// Only the main window talks to the Worker: the floating Now window must never touch user data.
fn ensure_main_window(window: &tauri::Window) -> Result<(), SecretError> {
    if crate::data_file::is_data_window(window.label()) {
        Ok(())
    } else {
        log::warn!("bridge: a command was refused for the window \"{}\"", window.label());
        Err(SecretError::InvalidRequest)
    }
}

/// Saves the Worker address (checked by [`normalize_base`]) and returns its host for display.
#[tauri::command]
pub async fn bridge_configure(window: tauri::Window, app: tauri::AppHandle, url: String) -> Result<String, SecretError> {
    ensure_main_window(&window)?;
    let base = normalize_base(&url)?;
    let path = config_path(&app).ok_or(SecretError::InvalidRequest)?;
    write_base(&path, &base)?;
    Ok(base.trim_start_matches("https://").to_owned())
}

/// The saved host (never the token), or `null` when none is saved.
#[tauri::command]
pub async fn bridge_host(window: tauri::Window, app: tauri::AppHandle) -> Result<Option<String>, SecretError> {
    ensure_main_window(&window)?;
    Ok(config_path(&app).and_then(|path| read_base(&path)).map(|base| base.trim_start_matches("https://").to_owned()))
}

/// Forgets the saved address. The Keychain entry is removed through `secret_delete`.
#[tauri::command]
pub async fn bridge_clear(window: tauri::Window, app: tauri::AppHandle) -> Result<(), SecretError> {
    ensure_main_window(&window)?;
    if let Some(path) = config_path(&app) {
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(SecretError::InvalidRequest),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn bridge_request(
    window: tauri::Window,
    app: tauri::AppHandle,
    secrets: State<'_, Secrets>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<BridgeResponse, SecretError> {
    ensure_main_window(&window)?;
    validate_route(&method, &path)?;
    let base = config_path(&app).and_then(|path| read_base(&path)).ok_or(SecretError::NotConfigured)?;
    // The first read of the entry may hit the Keychain (seconds): warm the cache off the runtime workers.
    let warm = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let _ = warm.state::<Secrets>().get(SecretEntry::McpSync);
    })
    .await;
    execute(&secrets, &base, &method, &path, body).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::test_support::memory_secrets;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    const TOKEN: &str = "sync_secretvalue1234";

    #[test]
    fn accepts_a_public_https_host() {
        for (input, expected) in [
            ("https://kando-mcp.example.workers.dev", "https://kando-mcp.example.workers.dev"),
            ("https://kando-mcp.example.workers.dev/", "https://kando-mcp.example.workers.dev"),
            ("  https://Mcp.Example.COM  ", "https://mcp.example.com"),
        ] {
            assert_eq!(normalize_base(input).as_deref(), Ok(expected), "{input}");
        }
    }

    #[test]
    fn refuses_anything_that_is_not_a_plain_public_https_host() {
        for input in [
            "",
            "kando-mcp.example.workers.dev",
            "http://kando-mcp.example.workers.dev",
            "https://localhost",
            "https://printer.local",
            "https://nas.internal",
            "https://intranet",
            "https://127.0.0.1",
            "https://[::1]",
            "https://10.0.0.5",
            "https://user:pw@host.example",
            "https://host.example:8443",
            "https://host.example/mcp",
            "https://host.example/?x=1",
            "https://host.example/#x",
            "ftp://host.example",
        ] {
            assert_eq!(normalize_base(input), Err(SecretError::InvalidRequest), "{input:?}");
        }
    }

    #[test]
    fn only_the_three_sync_routes_with_their_one_method_pass() {
        assert!(validate_route("PUT", "/sync/snapshot").is_ok());
        assert!(validate_route("GET", "/sync/commands").is_ok());
        assert!(validate_route("POST", "/sync/commands/cmd-1/result").is_ok());
        assert!(validate_route("POST", "/sync/commands/3f2a_9-b/result").is_ok());
        for (method, path) in [
            ("GET", "/sync/snapshot"),
            ("PUT", "/sync/commands"),
            ("POST", "/sync/snapshot"),
            ("DELETE", "/sync/commands"),
            ("GET", "/mcp"),
            ("GET", "/sync/commands?x=1"),
            ("GET", "https://evil.example/sync/commands"),
            ("POST", "/sync/commands//result"),
            ("POST", "/sync/commands/../result"),
            ("POST", "/sync/commands/a/b/result"),
            ("POST", "/sync/commands/a%2fb/result"),
            ("POST", "/sync/commands/id/result/"),
            ("get", "/sync/commands"),
        ] {
            assert_eq!(validate_route(method, path).map(|_| ()), Err(SecretError::InvalidRequest), "{method} {path}");
        }
    }

    #[test]
    fn the_saved_address_round_trips_and_a_bad_file_reads_as_not_configured() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CONFIG_FILE);
        assert_eq!(read_base(&path), None);
        write_base(&path, "https://mcp.example.com").unwrap();
        assert_eq!(read_base(&path).as_deref(), Some("https://mcp.example.com"));
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(read_base(&path), None);
        // A value planted in the file is checked again before use.
        std::fs::write(&path, r#"{"baseUrl":"http://127.0.0.1:1"}"#).unwrap();
        assert_eq!(read_base(&path), None);
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    fn serve_once(response: &'static str) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap();
            stream.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (base, handle)
    }

    #[test]
    fn sends_the_bearer_token_and_returns_status_and_body() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::McpSync, TOKEN).unwrap();
        let (base, handle) = serve_once("HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: 17\r\nconnection: close\r\n\r\n{\"commands\":[]}  ");
        let response = block_on(execute(&secrets, &base, "GET", "/sync/commands", None)).unwrap();
        assert_eq!(response.status, 200);
        assert_eq!(response.body["commands"], serde_json::json!([]));
        let request = handle.join().unwrap().to_lowercase();
        assert!(request.starts_with("get /sync/commands "));
        assert!(request.contains(&format!("authorization: bearer {}", TOKEN.to_lowercase())));
    }

    #[test]
    fn a_401_marks_the_entry_rejected_and_later_calls_make_no_request() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::McpSync, TOKEN).unwrap();
        let (base, handle) = serve_once("HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
        assert_eq!(block_on(execute(&secrets, &base, "GET", "/sync/commands", None)).map(|_| ()), Err(SecretError::Rejected));
        handle.join().unwrap();
        assert!(secrets.is_rejected(SecretEntry::McpSync));
        assert_eq!(block_on(execute(&secrets, "http://127.0.0.1:9", "GET", "/sync/commands", None)).map(|_| ()), Err(SecretError::Rejected));
        // A new token clears the flag.
        secrets.set(SecretEntry::McpSync, "sync_other5678").unwrap();
        assert!(!secrets.is_rejected(SecretEntry::McpSync));
    }

    #[test]
    fn without_a_token_nothing_is_sent_and_a_refused_route_never_reads_the_keychain() {
        let (secrets, backend) = memory_secrets();
        assert_eq!(block_on(execute(&secrets, "http://127.0.0.1:9", "GET", "/sync/commands", None)).map(|_| ()), Err(SecretError::NotConfigured));
        let reads = backend.reads.load(std::sync::atomic::Ordering::SeqCst);
        assert_eq!(block_on(execute(&secrets, "http://127.0.0.1:9", "GET", "/mcp", None)).map(|_| ()), Err(SecretError::InvalidRequest));
        assert_eq!(backend.reads.load(std::sync::atomic::Ordering::SeqCst), reads);
    }

    #[test]
    fn an_oversized_body_is_refused_before_anything_is_read() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::McpSync, TOKEN).unwrap();
        let big = serde_json::json!({ "x": "a".repeat(MAX_BODY_BYTES + 1) });
        assert_eq!(block_on(execute(&secrets, "http://127.0.0.1:9", "PUT", "/sync/snapshot", Some(big))).map(|_| ()), Err(SecretError::TooLarge));
    }

    #[test]
    fn a_redirect_is_not_followed() {
        let (secrets, _) = memory_secrets();
        secrets.set(SecretEntry::McpSync, TOKEN).unwrap();
        let (base, handle) = serve_once("HTTP/1.1 302 Found\r\nlocation: https://evil.example/\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
        let response = block_on(execute(&secrets, &base, "GET", "/sync/commands", None)).unwrap();
        handle.join().unwrap();
        assert_eq!(response.status, 302);
    }
}
