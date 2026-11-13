//! The log file, and what Help > Copy Diagnostic Info and Open Logs Folder need (F25).
//!
//! Warnings and errors from here (the `log` macros) and from the page
//! (lib/diagnostics/app-log.ts) go to scrivon.log in the logs folder, so a
//! problem can be reported with the log attached. Panics go to crash.log next
//! to it (`crash_report`). Neither gets a document's text.

use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// The log file's name, without ".log".
const LOG_FILE: &str = "scrivon";
/// A log this big is set aside with the date in its name, and a new one started.
const MAX_LOG_BYTES: u128 = 1024 * 1024;
/// How many set-aside logs are kept, besides the current one.
const KEEP_OLD_LOGS: usize = 2;

fn log_builder() -> tauri_plugin_log::Builder {
    let builder = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(LOG_FILE.into()),
        }))
        .max_file_size(MAX_LOG_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_OLD_LOGS))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .level(log::LevelFilter::Info);
    // A dev build also prints it in the terminal.
    if cfg!(debug_assertions) {
        builder.target(Target::new(TargetKind::Stderr))
    } else {
        builder
    }
}

/// Starts the log file. Call first in `setup`. When the log can't be opened,
/// the app still starts, without one: the log plugin's own setup would stop it.
pub fn start_logging(app: &AppHandle) {
    let (plugin, level, logger) = match log_builder().split(app) {
        Ok(parts) => parts,
        Err(err) => {
            eprintln!("Could not open the log file: {err}");
            return;
        }
    };
    if let Err(err) = tauri_plugin_log::attach_logger(level, logger) {
        eprintln!("Could not start the log: {err}");
    }
    if let Err(err) = app.plugin(plugin) {
        log::error!("Could not let the page write to the log: {err}");
    }
    let info = system_info();
    log::info!(
        "Scrivon {} started on {}, {}, WebView2 {}",
        app.package_info().version,
        info.os,
        info.arch,
        info.webview.as_deref().unwrap_or("unknown version")
    );
}

/// What Copy Diagnostic Info says about the computer (SystemInfo in lib/diagnostics/diagnostic-info.ts).
#[derive(Serialize, Debug)]
pub struct SystemInfo {
    os: String,
    arch: &'static str,
    webview: Option<String>,
}

#[tauri::command]
pub fn system_info() -> SystemInfo {
    SystemInfo {
        os: os_name(),
        arch: std::env::consts::ARCH,
        webview: tauri::webview_version().ok(),
    }
}

/// Opens the logs folder in File Explorer.
#[tauri::command(async)]
pub fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn os_name() -> String {
    windows_version().map_or_else(
        || "Windows (unknown version)".into(),
        |(major, minor, build)| windows_name(major, minor, build),
    )
}

#[cfg(not(windows))]
fn os_name() -> String {
    std::env::consts::OS.into()
}

/// Windows 11 still says it is version 10.0: its builds start at 22000.
#[cfg(any(windows, test))]
fn windows_name(major: u32, minor: u32, build: u32) -> String {
    let name = match (major, build) {
        (10, 22000..) => "Windows 11",
        (10, _) => "Windows 10",
        _ => "Windows",
    };
    format!("{name} ({major}.{minor}.{build})")
}

/// The real Windows version. Unlike GetVersionEx, RtlGetVersion doesn't
/// depend on the versions the exe's manifest says it supports.
#[cfg(windows)]
fn windows_version() -> Option<(u32, u32, u32)> {
    /// OSVERSIONINFOW.
    #[repr(C)]
    struct OsVersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform_id: u32,
        service_pack: [u16; 128],
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
    }
    let mut info = OsVersionInfo {
        size: std::mem::size_of::<OsVersionInfo>() as u32,
        major: 0,
        minor: 0,
        build: 0,
        platform_id: 0,
        service_pack: [0; 128],
    };
    // SAFETY: `info` is an OSVERSIONINFOW with its size set, as RtlGetVersion needs.
    let status = unsafe { RtlGetVersion(&mut info) };
    (status == 0).then_some((info.major, info.minor, info.build))
}

#[cfg(test)]
mod tests {
    use super::windows_name;

    #[test]
    fn tells_windows_11_from_windows_10_by_the_build() {
        assert_eq!(windows_name(10, 0, 26200), "Windows 11 (10.0.26200)");
        assert_eq!(windows_name(10, 0, 22000), "Windows 11 (10.0.22000)");
        assert_eq!(windows_name(10, 0, 19045), "Windows 10 (10.0.19045)");
        assert_eq!(windows_name(6, 3, 9600), "Windows (6.3.9600)");
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_windows_version_this_runs_on() {
        let info = super::system_info();
        assert!(info.os.starts_with("Windows 1"), "{}", info.os);
        assert!(!info.os.contains("unknown"), "{}", info.os);
        assert!(!info.arch.is_empty());
    }
}
