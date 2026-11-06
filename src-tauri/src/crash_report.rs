//! Says why Scrivon couldn't start instead of just not opening.
//!
//! Release builds have no console, so a startup panic (Tauri turns a failed
//! WebView2 setup into `panic!("Failed to setup app: …")`) used to make the app
//! vanish without a word. Every panic is now written to a crash log, and one
//! that happens before the app has finished starting also shows an error box.

use std::any::Any;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

const LOG_FILE: &str = "crash.log";
/// A log bigger than this is started afresh, so a crash loop can't fill the disk.
const MAX_LOG_BYTES: u64 = 256 * 1024;
const WEBVIEW2_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

static LOG_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
static STARTED: AtomicBool = AtomicBool::new(false);
static SHOWN: AtomicBool = AtomicBool::new(false);

/// Installs the panic hook. Call first thing in `run()`.
pub fn install(identifier: &str) {
    LOG_PATH.get_or_init(|| log_dir(identifier).map(|dir| dir.join(LOG_FILE)));
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|at| format!(" at {}:{}", at.file(), at.line()))
            .unwrap_or_default();
        let message = payload_text(info.payload());
        record(&format!("panic{location}: {message}"));
        if !STARTED.load(Ordering::SeqCst) {
            show_startup_error(&message);
        }
        default_hook(info);
    }));
}

/// The app is up (its window was created): later panics are only logged.
pub fn mark_started() {
    STARTED.store(true, Ordering::SeqCst);
}

/// Reports an error that stopped the app from starting.
pub fn startup_failed(error: &str) {
    record(&format!("startup failed: {error}"));
    show_startup_error(error);
}

fn log_dir(identifier: &str) -> Option<PathBuf> {
    // Next to the WebView2 data, where Tauri's own app log folder is.
    #[cfg(windows)]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(not(windows))]
    let base = Some(std::env::temp_dir());
    Some(base?.join(identifier).join("logs"))
}

fn log_path() -> Option<&'static Path> {
    LOG_PATH.get()?.as_deref()
}

fn payload_text(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "unknown error".into()
    }
}

fn record(line: &str) {
    if let Some(path) = log_path() {
        let _ = append_log(path, line);
    }
}

fn append_log(path: &Path, line: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let too_big = std::fs::metadata(path).is_ok_and(|meta| meta.len() > MAX_LOG_BYTES);
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(!too_big)
        .write(true)
        .truncate(too_big)
        .open(path)?;
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs());
    writeln!(
        file,
        "[unix {seconds}] Scrivon {}: {line}",
        env!("CARGO_PKG_VERSION")
    )
}

fn startup_error_text(detail: &str, log: Option<&Path>) -> String {
    let mut text = format!(
        "Scrivon couldn't start.\n\n{}\n\nIf this keeps happening, restart Windows, then repair or \
         reinstall the Microsoft Edge WebView2 Runtime: {WEBVIEW2_URL}",
        detail.trim()
    );
    if let Some(log) = log {
        text.push_str(&format!("\n\nDetails were saved to {}", log.display()));
    }
    text
}

fn show_startup_error(detail: &str) {
    if SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    // Without the WebView2 Runtime, Tauri shows its own message with a download link.
    if tauri::webview_version().is_err() {
        return;
    }
    show_error_box(&startup_error_text(detail, log_path()));
}

/// An error box in release builds on Windows; debug builds print to the console.
#[cfg(all(windows, not(debug_assertions)))]
fn show_error_box(text: &str) {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
    }
    const MB_ICONERROR: u32 = 0x10;
    const MB_SETFOREGROUND: u32 = 0x1_0000;

    let wide = |value: &str| -> Vec<u16> { value.encode_utf16().chain([0]).collect() };
    let text = wide(text);
    let caption = wide("Scrivon");
    // SAFETY: both strings are NUL-terminated UTF-16 that outlive the call, and
    // a null owner window is allowed.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_ICONERROR | MB_SETFOREGROUND,
        );
    }
}

#[cfg(not(all(windows, not(debug_assertions))))]
fn show_error_box(text: &str) {
    eprintln!("{text}");
}

#[cfg(test)]
mod tests {
    use super::{append_log, payload_text, startup_error_text, MAX_LOG_BYTES};

    #[test]
    fn reads_panic_messages() {
        let literal: Box<dyn std::any::Any + Send> = Box::new("Failed to setup app");
        assert_eq!(payload_text(literal.as_ref()), "Failed to setup app");
        let formatted: Box<dyn std::any::Any + Send> =
            Box::new(format!("Failed to setup app: {}", "WebView2 error"));
        assert_eq!(
            payload_text(formatted.as_ref()),
            "Failed to setup app: WebView2 error"
        );
        let other: Box<dyn std::any::Any + Send> = Box::new(42_u8);
        assert_eq!(payload_text(other.as_ref()), "unknown error");
    }

    #[test]
    fn the_error_box_says_what_failed_what_to_try_and_where_the_log_is() {
        let log = std::path::Path::new(r"C:\Users\me\AppData\Local\scrivon\logs\crash.log");
        let text = startup_error_text("Failed to setup app: WebView2 error\n", Some(log));
        assert!(text.starts_with("Scrivon couldn't start."), "{text}");
        assert!(
            text.contains("Failed to setup app: WebView2 error\n\n"),
            "{text}"
        );
        assert!(text.contains("WebView2 Runtime"), "{text}");
        assert!(text.ends_with(r"crash.log"), "{text}");
        assert!(!startup_error_text("boom", None).contains("saved to"));
    }

    #[test]
    fn appends_to_the_log_and_starts_afresh_when_it_gets_big() {
        let dir = std::env::temp_dir().join(format!("scrivon-crash-{}", uuid::Uuid::new_v4()));
        let path = dir.join("logs").join("crash.log");

        append_log(&path, "first").unwrap();
        append_log(&path, "second").unwrap();
        let log = std::fs::read_to_string(&path).unwrap();
        assert!(log.contains("first") && log.contains("second"), "{log}");
        assert_eq!(log.lines().count(), 2);

        std::fs::write(&path, vec![b'x'; MAX_LOG_BYTES as usize + 1]).unwrap();
        append_log(&path, "third").unwrap();
        let log = std::fs::read_to_string(&path).unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(log.lines().count(), 1);
        assert!(log.contains("third"));
    }
}
