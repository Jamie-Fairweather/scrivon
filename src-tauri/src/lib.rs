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
/// user chose (see `workspace_access`).
#[tauri::command]
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            allow_workspace,
            pdf_export::export_html_to_pdf,
            pdf_export::read_export_image,
            system_fonts::list_system_fonts,
            updater::check_for_app_update,
            updater::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
