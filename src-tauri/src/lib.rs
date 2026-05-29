mod pdf_export;
mod updater;

use std::sync::Mutex;

use tauri_plugin_fs::FsExt;

use updater::PendingUpdate;

#[tauri::command]
fn allow_workspace(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(PendingUpdate(Mutex::new(None)))
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            allow_workspace,
            pdf_export::export_html_to_pdf,
            updater::check_for_app_update,
            updater::install_app_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
