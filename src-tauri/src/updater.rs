use std::sync::Mutex;

use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const STABLE_MANIFEST: &str =
    "https://github.com/Jamie-Fairweather/scrivon/releases/latest/download/latest.json";

pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

fn is_prerelease_build(version: &str) -> bool {
    let version = version.split('+').next().unwrap_or(version);
    version.contains('-')
}

#[cfg(test)]
mod tests {
    use super::is_prerelease_build;

    #[test]
    fn prerelease_versions_contain_hyphen() {
        assert!(is_prerelease_build("1.3.0-rc.1"));
        assert!(is_prerelease_build("2.0.0-beta"));
        assert!(!is_prerelease_build("1.3.0"));
        assert!(!is_prerelease_build("1.3.0+build-1"));
    }
}

#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();
    if is_prerelease_build(&current) {
        return Ok(None);
    }

    let manifest_url = Url::parse(STABLE_MANIFEST).map_err(|e| e.to_string())?;

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
