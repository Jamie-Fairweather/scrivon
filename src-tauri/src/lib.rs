mod atomic_write;
mod close_watchdog;
mod crash_report;
mod legacy_profile;
mod page_numbers;
mod pdf_export;
mod prevent_browser_shortcuts;
mod system_fonts;
mod updater;
mod workspace_access;

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_fs::FsExt;

use close_watchdog::CloseWatchdog;
use updater::PendingUpdate;
use workspace_access::WorkspaceAccess;

/// The store files the frontend uses (lib/tauri/store.ts and lib/tauri/backups.ts),
/// and whether each one saves itself 100 ms after a change (the plugin's default).
/// The others are saved by hand right after each change.
const STORES: [(&str, bool); 4] = [
    ("workspace.json", true),
    ("workspace.backup.json", false),
    ("unsaved-changes.json", false),
    ("unsaved-changes.2.json", false),
];

/// Opens the app's store files before the webview can reach them. The webview
/// can only use these (`getStore`), never open a store itself: the plugin's
/// `load` takes any path, and an absolute one would let a script in the window
/// write a JSON file anywhere on disk, such as the Startup folder (S02). A
/// damaged file is ignored here and the store starts empty; the frontend's
/// `reload()` then says why and brings back its copy.
fn open_stores(app: &tauri::AppHandle) {
    for (name, auto_save) in STORES {
        let builder = tauri_plugin_store::StoreBuilder::new(app, name);
        let builder = if auto_save {
            builder
        } else {
            builder.defaults(HashMap::new()).disable_auto_save()
        };
        if let Err(err) = builder.build() {
            eprintln!("Could not open {name}: {err}");
        }
    }
}

/// Builds the window from its entry in tauri.conf.json. That entry has
/// `"create": false`, so Tauri doesn't build it before `setup` runs: the old
/// profile has to be copied in before WebView2 opens it (see `legacy_profile`).
fn build_main_window(app: &tauri::App) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or(tauri::Error::WindowNotFound)?
        .clone();
    tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
    Ok(())
}

/// The window starts hidden, and the page shows it once its theme is painted
/// (components/theme/app-theme-provider.tsx), so a light theme never opens on
/// the dark default colour. If the page never does (it failed to load, say),
/// the window is shown anyway after this long.
const SHOW_WINDOW_FALLBACK: Duration = Duration::from_secs(3);

fn show_main_window_later(app: &tauri::App) {
    let app = app.handle().clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_WINDOW_FALLBACK);
        if let Some(window) = app.get_webview_window("main") {
            if !window.is_visible().unwrap_or(false) {
                let _ = window.show();
            }
        }
    });
}

/// Grants the frontend recursive access to a workspace folder, but only one the
/// user chose (see `workspace_access`). Checking the folder touches the disk
/// (slow on a network drive), so this runs off the window's main thread.
#[tauri::command(async)]
fn allow_workspace(
    app: tauri::AppHandle,
    access: tauri::State<'_, WorkspaceAccess>,
    path: String,
) -> Result<(), String> {
    let scope = app.fs_scope();
    access.approve(&path, |folder| scope.is_allowed(folder))?;
    scope
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

/// Gives the app's windows the taskbar ID (AppUserModelID) the installer puts on
/// its shortcuts. Without it, Windows only matches a window to a pinned icon
/// when the app was started from that shortcut. After an update the installer
/// starts the exe directly, so the window got a second taskbar button.
/// Must run before any window exists.
///
/// Not called yet: shortcuts (and pins made from them) migrated by the 1.4.1
/// rename still carry the old ID, so setting this now would split every launch
/// from them off their pin. Call it at the top of `run()`, for release builds
/// only, once the installer re-tags existing shortcuts with the new ID.
#[cfg(all(windows, any(test, not(debug_assertions))))]
#[cfg_attr(not(test), allow(dead_code))]
fn set_taskbar_id(identifier: &str) {
    #[link(name = "shell32")]
    extern "system" {
        fn SetCurrentProcessExplicitAppUserModelID(app_id: *const u16) -> i32;
    }
    let id: Vec<u16> = identifier.encode_utf16().chain([0]).collect();
    // SAFETY: `id` is a NUL-terminated UTF-16 string that outlives the call.
    let result = unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
    if result < 0 {
        eprintln!("Could not set the taskbar ID (error {result:#x}).");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    crash_report::install(&context.config().identifier);

    let result = tauri::Builder::default()
        // Keep this the first plugin: a second launch must quit before anything
        // else starts, and before setup opens the store files. Two copies would
        // overwrite each other's recent folders, tabs and kept unsaved edits.
        // A second launch focuses the window that is already open instead.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(PendingUpdate(Mutex::new(None)))
        .manage(CloseWatchdog::default())
        .plugin(tauri_plugin_process::init())
        .plugin(prevent_browser_shortcuts::plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            // First: the copied workspace.json must be there before the stores
            // and the folder list read it, and the copied localStorage before
            // the window opens its WebView2 profile.
            legacy_profile::migrate(app);
            open_stores(app.handle());
            let data_dir = app.path().app_data_dir().ok();
            app.manage(WorkspaceAccess::load(data_dir.as_deref()));
            build_main_window(app)?;
            show_main_window_later(app);
            #[cfg(windows)]
            close_watchdog::watch_page_process(app);
            crash_report::mark_started();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    close_watchdog::on_close_requested(window);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            allow_workspace,
            atomic_write::save_workspace_file,
            close_watchdog::close_ack,
            pdf_export::export_html_to_pdf,
            pdf_export::read_export_image,
            system_fonts::list_system_fonts,
            updater::check_for_app_update,
            updater::install_app_update,
            updater::take_update_attempt,
        ])
        .run(context);
    if let Err(err) = result {
        crash_report::startup_failed(&err.to_string());
        std::process::exit(1);
    }
}

#[cfg(test)]
mod config_tests {
    fn permissions() -> Vec<String> {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        capability["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p.as_str().map(str::to_owned))
            .collect()
    }

    #[test]
    fn the_webview_cannot_open_a_store_file_at_a_path_of_its_choosing() {
        let permissions = permissions();
        // store:default includes allow-load, which takes any path (S02).
        assert!(!permissions.iter().any(|p| p == "store:default"));
        assert!(!permissions.iter().any(|p| p == "store:allow-load"));
        // It still reaches the stores the app opened at startup.
        for granted in ["store:allow-get-store", "store:allow-save"] {
            assert!(permissions.contains(&granted.to_owned()), "{granted}");
        }
    }

    #[test]
    fn the_main_window_is_left_for_setup_to_build() {
        // Built by build_main_window after the old profile is copied in. Tauri
        // would otherwise build it first, and setup would then fail to start.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["label"], "main");
        assert_eq!(windows[0]["create"], false);
        // The page shows it once its theme is on (show_main_window_later if not).
        assert_eq!(windows[0]["visible"], false);
    }
}

#[cfg(all(test, windows))]
mod tests {
    use std::ffi::c_void;

    #[link(name = "shell32")]
    extern "system" {
        fn GetCurrentProcessExplicitAppUserModelID(app_id: *mut *mut u16) -> i32;
    }
    #[link(name = "ole32")]
    extern "system" {
        fn CoTaskMemFree(memory: *const c_void);
    }

    fn taskbar_id() -> Option<String> {
        let mut id: *mut u16 = std::ptr::null_mut();
        // SAFETY: on success `id` is a NUL-terminated string the caller frees.
        unsafe {
            if GetCurrentProcessExplicitAppUserModelID(&mut id) < 0 || id.is_null() {
                return None;
            }
            let len = (0..).take_while(|&i| *id.add(i) != 0).count();
            let text = String::from_utf16_lossy(std::slice::from_raw_parts(id, len));
            CoTaskMemFree(id as *const c_void);
            Some(text)
        }
    }

    #[test]
    fn windows_get_the_taskbar_id_of_the_installer_shortcuts() {
        // The installers put the bundle identifier on their shortcuts.
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let identifier = config["identifier"].as_str().unwrap();

        super::set_taskbar_id(identifier);

        assert_eq!(taskbar_id().as_deref(), Some(identifier));
    }
}
