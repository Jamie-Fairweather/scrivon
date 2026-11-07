mod crash_report;
mod page_numbers;
mod pdf_export;
mod prevent_browser_shortcuts;
mod system_fonts;
mod updater;
mod workspace_access;

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_fs::FsExt;

use updater::PendingUpdate;
use workspace_access::WorkspaceAccess;

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
        .manage(PendingUpdate(Mutex::new(None)))
        .plugin(tauri_plugin_process::init())
        .plugin(prevent_browser_shortcuts::plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().ok();
            app.manage(WorkspaceAccess::load(data_dir.as_deref()));
            // The main window was created before this runs.
            crash_report::mark_started();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            allow_workspace,
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
