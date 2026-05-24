use std::sync::Mutex;

use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const STABLE_MANIFEST: &str =
    "https://github.com/Jamie-Fairweather/scrivon/releases/latest/download/latest.json";
const RC_MANIFEST: &str =
    "https://github.com/Jamie-Fairweather/scrivon/releases/download/updater-rc/latest-rc.json";

pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
    pub channel: String,
}

fn manifest_url_for(version: &str) -> (&'static str, &'static str) {
    if version.contains('-') {
        (RC_MANIFEST, "rc")
    } else {
        (STABLE_MANIFEST, "stable")
    }
}

#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    let (endpoint, channel) = manifest_url_for(&current);

    let manifest_url = Url::parse(endpoint).map_err(|e| e.to_string())?;

    let updater = app
        .updater_builder()
        .endpoints(vec![manifest_url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let info = UpdateInfo {
                version: update.version.clone(),
                notes: update.body.clone(),
                channel: channel.to_string(),
            };
            *pending.0.lock().unwrap() = Some(update);
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn install_app_update(pending: State<'_, PendingUpdate>) -> Result<(), String> {
    let Some(update) = pending.0.lock().unwrap().take() else {
        return Err("No update is ready to install.".into());
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
