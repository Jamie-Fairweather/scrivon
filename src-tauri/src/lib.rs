mod atomic_write;
mod close_watchdog;
mod crash_report;
mod launch_paths;
mod legacy_profile;
mod page_numbers;
mod pdf_export;
mod prevent_browser_shortcuts;
mod store_recovery;
mod system_fonts;
mod system_menu;
mod updater;
mod window_state;
mod workspace_access;
mod workspace_image;
mod workspace_trash;

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

use close_watchdog::CloseWatchdog;
use launch_paths::{LaunchPath, LaunchPaths};
use store_recovery::StoreRecovery;
use updater::PendingUpdate;
use window_state::WindowStateFile;
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
/// damaged workspace.json has already been set aside (`store_recovery`); any
/// other damaged file is ignored here and its store starts empty.
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
fn build_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .ok_or(tauri::Error::WindowNotFound)?
        .clone();
    tauri::WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

/// Builds the main window and starts what looks after it.
fn open_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    build_main_window(app)?;
    window_state::restore(app);
    show_main_window_later(app);
    #[cfg(windows)]
    close_watchdog::watch_page_process(app);
    Ok(())
}

/// The window starts hidden, and the page shows it once its theme is painted
/// (components/theme/app-theme-provider.tsx), so a light theme never opens on
/// the dark default colour. If the page never does (it failed to load, say),
/// the window is shown anyway after this long.
const SHOW_WINDOW_FALLBACK: Duration = Duration::from_secs(3);

fn show_main_window_later(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_WINDOW_FALLBACK);
        if let Some(window) = app.get_webview_window("main") {
            if !window.is_visible().unwrap_or(false) {
                let _ = window.show();
            }
        }
    });
}

/// True once the main window was closed (destroyed), until a second launch
/// builds it again. It is false while setup is still building the first
/// window: that window isn't in the app's window list yet, and WebView2 handles
/// a second launch's message while it starts.
static MAIN_CLOSED: AtomicBool = AtomicBool::new(false);

/// Brings the main window to the front with `focus` when `main` has it, and
/// has `open` open it again when it is gone because it was `closed`. When it
/// isn't there yet, setup is still building it and shows it once the page has
/// painted, so nothing is done: building another would make two windows.
fn focus_or_open<W>(main: Option<W>, closed: bool, focus: impl FnOnce(W), open: impl FnOnce()) {
    match main {
        Some(window) => focus(window),
        None if closed => open(),
        None => {}
    }
}

fn focus_main_window(window: tauri::WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// A second launch brings the open window to the front. The window can be
/// gone while the app still runs: closed during a PDF export, whose hidden
/// window keeps the app running until the PDF is saved. The launch then opens
/// it again, rather than doing nothing, but only once it was really closed: at
/// startup it is missing too, while setup builds it. Building a window waits
/// for the main thread, which runs this, so that is done on another thread.
fn on_second_launch(app: &tauri::AppHandle) {
    focus_or_open(
        app.get_webview_window("main"),
        MAIN_CLOSED.load(Ordering::SeqCst),
        focus_main_window,
        || {
            let app = app.clone();
            std::thread::spawn(move || reopen_main_window(&app));
        },
    );
}

fn reopen_main_window(app: &tauri::AppHandle) {
    // Two launches at once: the second finds the window the first one built.
    static REOPENING: Mutex<()> = Mutex::new(());
    let _one_at_a_time = REOPENING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    focus_or_open(
        app.get_webview_window("main"),
        MAIN_CLOSED.load(Ordering::SeqCst),
        focus_main_window,
        || {
            MAIN_CLOSED.store(false, Ordering::SeqCst);
            match open_main_window(app) {
                Ok(()) => focus_once_shown(app),
                Err(err) => {
                    // Still gone, so the next launch tries again.
                    MAIN_CLOSED.store(true, Ordering::SeqCst);
                    eprintln!("Could not open the window again: {err}");
                }
            }
        },
    );
}

/// Brings the reopened window to the front once it is shown (by the page, or
/// by `show_main_window_later`): a hidden window can't take the focus, and
/// this copy of Scrivon isn't the one the user just started, so Windows may
/// leave it behind other windows.
fn focus_once_shown(app: &tauri::AppHandle) {
    let deadline = std::time::Instant::now() + SHOW_WINDOW_FALLBACK + Duration::from_secs(1);
    while std::time::Instant::now() < deadline {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if window.is_visible().unwrap_or(false) {
            let _ = window.set_focus();
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

/// Queues the files and folders a launch asked Scrivon to open, for the page to
/// open (see `launch_paths`). True when there were any.
fn receive_launch_paths(app: &tauri::AppHandle, paths: Vec<LaunchPath>) -> bool {
    let scope = app.fs_scope();
    app.state::<LaunchPaths>().add(paths, |folder| {
        scope
            .allow_directory(folder, true)
            .map_err(|e| e.to_string())
    })
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

/// Stops a folder the user removed from Recent opening again without the
/// folder dialog (see `workspace_access`). It only takes access away, so any
/// caller may use it. A folder opened in this session stays in the fs scope
/// until Scrivon closes: forbidding it would also stop the user choosing it
/// again with Open Folder.
#[tauri::command(async)]
fn forget_workspace(access: tauri::State<'_, WorkspaceAccess>, path: String) -> Result<(), String> {
    access.forget(&path);
    Ok(())
}

/// Gives the app's windows the taskbar ID (AppUserModelID) the installer puts on
/// its shortcuts. Without it, Windows only matches a window to a pinned icon
/// when the app was started from that shortcut. After an update the installer
/// starts the exe directly, so the window got a second taskbar button (U91).
/// Must run before any window exists.
///
/// Each install also puts the ID on the existing shortcuts and the taskbar pin
/// (SCRIVON_TAG_SHORTCUT in windows/installer-hooks.nsh), including ones made
/// before this was used, so they stay matched to the window.
#[cfg(all(windows, any(test, not(debug_assertions))))]
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
    // Release builds only: a dev build keeps its own taskbar button.
    #[cfg(all(windows, not(debug_assertions)))]
    set_taskbar_id(&context.config().identifier);
    crash_report::install(&context.config().identifier);

    let result = tauri::Builder::default()
        // Keep this the first plugin: a second launch must quit before anything
        // else starts, and before setup opens the store files. Two copies would
        // overwrite each other's recent folders, tabs and kept unsaved edits.
        // A second launch focuses the window that is already open instead, and
        // hands it the files it was asked to open.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // Looking at the paths touches the disk (slow on a network drive),
            // so it runs off the main thread. argv[0] is the program.
            let handle = app.clone();
            std::thread::spawn(move || {
                let paths = launch_paths::parse_args(argv.iter().skip(1), Path::new(&cwd));
                if receive_launch_paths(&handle, paths) {
                    let _ = handle.emit(launch_paths::EVENT, ());
                }
            });
            on_second_launch(app)
        }))
        .manage(LaunchPaths::default())
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
            let data_dir = app.path().app_data_dir().ok();
            // Before the store and the folder list read workspace.json (D24).
            app.manage(StoreRecovery::set_aside_damaged(data_dir.as_deref()));
            open_stores(app.handle());
            app.manage(WorkspaceAccess::load(data_dir.as_deref()));
            app.manage(WindowStateFile::new(data_dir.as_deref()));
            // After an in-app update the installer restarts Scrivon with the
            // arguments it was first started with (tauri-plugin-updater passes
            // them on). Those were opened back then, so skip them and let the
            // last folder reopen. If the update failed, this skips one launch's
            // files, and the page then says the update didn't install.
            if !data_dir.as_deref().is_some_and(updater::attempt_waiting) {
                // Checked here, though it touches the disk, because the page asks
                // for them as it starts. Any later, it would reopen the last
                // folder first and then switch. Explorer has usually just read
                // the file, so this is quick.
                let cwd = std::env::current_dir().unwrap_or_default();
                let paths = launch_paths::parse_args(std::env::args_os().skip(1), &cwd);
                // Waits for the page, which takes them as it starts.
                receive_launch_paths(app.handle(), paths);
            }
            open_main_window(app.handle())?;
            crash_report::mark_started();
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    // Saved even if the page then keeps the window open: it is where the window is now.
                    window_state::save(window);
                    close_watchdog::on_close_requested(window);
                }
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    window_state::save_soon(window);
                }
                tauri::WindowEvent::Destroyed => MAIN_CLOSED.store(true, Ordering::SeqCst),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            allow_workspace,
            forget_workspace,
            atomic_write::rename_workspace_path,
            atomic_write::save_workspace_file,
            close_watchdog::close_ack,
            launch_paths::take_launch_paths,
            pdf_export::export_html_to_pdf,
            pdf_export::read_export_image,
            pdf_export::remember_export_image,
            pdf_export::adopt_export_images,
            store_recovery::take_store_recovery,
            system_fonts::list_system_fonts,
            system_menu::show_system_menu,
            updater::check_for_app_update,
            updater::install_app_update,
            updater::take_update_attempt,
            workspace_image::read_workspace_image,
            workspace_trash::trash_workspace_path,
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
    fn the_webview_cannot_write_into_the_app_data_folder() {
        let permissions = permissions();
        // fs:default gives every fs command, writes and removes included, the
        // app's own folders, so the page could rewrite workspace-access.json.
        assert!(!permissions.iter().any(|p| p == "fs:default"));
        // Its block on the WebView2 profile folder stays.
        assert!(permissions.iter().any(|p| p == "fs:deny-default"));
    }

    #[test]
    fn the_webview_cannot_erase_files_only_move_them_to_the_recycle_bin() {
        // Deletes go through workspace_trash, so a mistake can be undone (F01).
        assert!(!permissions().iter().any(|p| p == "fs:allow-remove"));
    }

    #[test]
    fn the_installer_opens_every_kind_of_document_with_scrivon() {
        // Double-clicking one in File Explorer then opens it (launch_paths).
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut registered: Vec<&str> = config["bundle"]["fileAssociations"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|association| association["ext"].as_array().unwrap())
            .map(|ext| ext.as_str().unwrap())
            .collect();
        registered.sort_unstable();
        let mut opened = super::launch_paths::DOCUMENT_EXTENSIONS;
        opened.sort_unstable();
        assert_eq!(registered, opened);
    }

    const INSTALLER_HOOKS: &str = include_str!("../windows/installer-hooks.nsh");

    /// The lines of one `!macro name` ... `!macroend` in the installer hooks, trimmed.
    fn installer_hook(name: &str) -> Vec<&'static str> {
        let mut lines = INSTALLER_HOOKS.lines().map(str::trim);
        let start = format!("!macro {name}");
        lines
            .find(|line| {
                line.strip_prefix(&start)
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
            })
            .unwrap_or_else(|| panic!("{name} is not in installer-hooks.nsh"));
        lines.take_while(|line| *line != "!macroend").collect()
    }

    #[test]
    fn the_installer_keeps_the_app_each_file_type_opened_with_before() {
        // The template's APP_ASSOCIATE overwrites that on every install after
        // the first (see SCRIVON_FILE_TYPES in installer-hooks.nsh).
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mut registered: Vec<String> = config["bundle"]["fileAssociations"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|association| {
                let class = association["name"].as_str().unwrap();
                association["ext"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(move |ext| format!("\"{}\" \"{class}\"", ext.as_str().unwrap()))
            })
            .collect();
        let mut kept: Vec<String> = installer_hook("SCRIVON_FILE_TYPES")
            .iter()
            .map(|line| {
                let args = line.strip_prefix("!insertmacro ${do} ").unwrap();
                args.rsplit_once(' ').unwrap().0.to_string()
            })
            .collect();
        registered.sort_unstable();
        kept.sort_unstable();
        assert_eq!(kept, registered);

        assert!(installer_hook("NSIS_HOOK_PREINSTALL")
            .contains(&"!insertmacro SCRIVON_FILE_TYPES SCRIVON_READ_ASSOC_BACKUP"));
        assert!(installer_hook("NSIS_HOOK_POSTINSTALL")
            .contains(&"!insertmacro SCRIVON_FILE_TYPES SCRIVON_KEEP_ASSOC_BACKUP"));
    }

    #[test]
    fn file_explorer_hears_when_the_file_types_change() {
        for hook in ["NSIS_HOOK_POSTINSTALL", "NSIS_HOOK_POSTUNINSTALL"] {
            assert!(
                installer_hook(hook).contains(&"!insertmacro UPDATEFILEASSOC"),
                "{hook}"
            );
        }
    }

    #[test]
    fn each_installer_hook_is_defined_once() {
        // makensis stops on a macro defined twice, which a merge could leave.
        for hook in [
            "NSIS_HOOK_PREINSTALL",
            "NSIS_HOOK_POSTINSTALL",
            "NSIS_HOOK_PREUNINSTALL",
            "NSIS_HOOK_POSTUNINSTALL",
        ] {
            let start = format!("!macro {hook}");
            let defined = INSTALLER_HOOKS
                .lines()
                .filter(|line| line.trim() == start)
                .count();
            assert!(defined <= 1, "{hook} is defined {defined} times");
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

#[cfg(test)]
mod second_launch_tests {
    use std::cell::Cell;

    use super::focus_or_open;

    /// Which window `focus_or_open` focused, and whether it opened one.
    fn second_launch(main: Option<&'static str>, closed: bool) -> (Option<&'static str>, bool) {
        let (focused, opened) = (Cell::new(None), Cell::new(false));
        focus_or_open(
            main,
            closed,
            |window| focused.set(Some(window)),
            || opened.set(true),
        );
        (focused.get(), opened.get())
    }

    #[test]
    fn a_second_launch_focuses_the_open_window() {
        assert_eq!(second_launch(Some("main"), false), (Some("main"), false));
    }

    #[test]
    fn a_second_launch_opens_the_window_again_once_it_was_closed() {
        // Closed during a PDF export, whose hidden window keeps the app running.
        assert_eq!(second_launch(None, true), (None, true));
    }

    #[test]
    fn a_second_launch_during_startup_leaves_the_window_to_setup() {
        // Setup is still building it, so it isn't in the window list yet.
        // Building one too would leave two windows, one of them hidden for good.
        assert_eq!(second_launch(None, false), (None, false));
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
