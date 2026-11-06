use std::future::Future;
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
    use std::sync::Mutex;

    use super::{install_error_message, install_pending, is_prerelease_build};

    #[test]
    fn prerelease_versions_contain_hyphen() {
        assert!(is_prerelease_build("1.3.0-rc.1"));
        assert!(is_prerelease_build("2.0.0-beta"));
        assert!(!is_prerelease_build("1.3.0"));
        assert!(!is_prerelease_build("1.3.0+build-1"));
    }

    #[test]
    fn a_failed_install_keeps_the_update_for_a_retry() {
        let pending = Mutex::new(Some("1.5.0".to_string()));
        let install = |fails: bool| {
            tauri::async_runtime::block_on(install_pending(&pending, |version| async move {
                assert_eq!(version, "1.5.0");
                if fails {
                    Err("The update couldn't be downloaded.".to_string())
                } else {
                    Ok(())
                }
            }))
        };

        assert!(install(true).is_err());
        assert_eq!(pending.lock().unwrap().as_deref(), Some("1.5.0"));

        assert!(install(false).is_ok());
        assert!(pending.lock().unwrap().is_none());
        assert_eq!(
            install(false).unwrap_err(),
            "No update is ready to install."
        );
    }

    #[test]
    fn download_errors_read_as_plain_sentences() {
        let error = tauri_plugin_updater::Error::Network(
            "Download request failed with status: 503 Service Unavailable".into(),
        );
        let message = install_error_message(&error);
        assert!(
            message.starts_with("The update couldn't be downloaded"),
            "{message}"
        );
        assert!(message.contains("503"), "{message}");
        assert!(!message.contains('`'), "{message}");
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

/// Installs a copy of the pending update and only clears it once that worked,
/// so a failed download (dropped connection, bad signature) can be retried.
async fn install_pending<T, F, Fut>(pending: &Mutex<Option<T>>, install: F) -> Result<(), String>
where
    T: Clone,
    F: FnOnce(T) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    let Some(update) = pending.lock().unwrap().clone() else {
        return Err("No update is ready to install.".into());
    };
    install(update).await?;
    *pending.lock().unwrap() = None;
    Ok(())
}

/// A plain message for a failed update download or install.
fn install_error_message(err: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match err {
        Error::Reqwest(_) => {
            "The update couldn't be downloaded. Check your internet connection and try again."
                .into()
        }
        Error::Network(detail) => {
            format!("The update couldn't be downloaded ({detail}). Try again later.")
        }
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) => {
            "The downloaded update failed its security check, so it wasn't installed.".into()
        }
        other => other.to_string(),
    }
}

#[tauri::command]
pub async fn install_app_update(pending: State<'_, PendingUpdate>) -> Result<(), String> {
    install_pending(&pending.0, |update: Update| async move {
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(|e| install_error_message(&e))
    })
    .await
}
