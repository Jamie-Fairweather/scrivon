use std::future::Future;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// How long to wait for the update server to answer, and then for each piece
/// of the download. Without these a stalled connection waits for ever (reqwest
/// has no default). They limit each wait, not the whole download, so a slow
/// download that is still moving is never cut off.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Written to the app data folder just before the installer starts. On Windows
/// the app exits as soon as it has launched the installer, so it can't tell
/// whether the install worked (a declined permission prompt, a blocked
/// installer). The next launch reads it to say how the update went.
const ATTEMPT_FILE: &str = "update-attempt.json";

pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AttemptRecord {
    from: String,
    to: String,
}

impl AttemptRecord {
    /// The record waiting in `dir`, if there is one and it can be read.
    fn read(dir: &Path) -> Option<Self> {
        let bytes = std::fs::read(dir.join(ATTEMPT_FILE)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// True when the version has changed since the update started. Updates
    /// are always newer, so then it installed. The page's message and the
    /// choice of which files to open both use this, so they always agree.
    fn installed(&self, current_version: &str) -> bool {
        self.from != current_version
    }
}

/// How the last in-app update went, for the first launch after it.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAttempt {
    /// The version running now when it installed (which may be a newer one
    /// the user installed by hand), or else the one the update was going to
    /// install.
    pub version: String,
    /// False when the app is still on the version it had before the update.
    pub installed: bool,
}

/// What install_app_update tells the page while it works, so the update
/// dialog can show the download moving instead of a still "Installing…".
/// `total` is the download's size in bytes, when the server says it.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum UpdateProgress {
    Started { total: Option<u64> },
    Progress { downloaded: u64, total: Option<u64> },
    Installing,
}

/// Lets through at most one progress message per 100 ms or per 1% of the
/// download (a download arrives in thousands of small pieces), and always the
/// last piece.
#[derive(Default)]
struct ProgressThrottle {
    last_sent: Option<(Instant, u64)>,
}

const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

impl ProgressThrottle {
    fn should_send(&mut self, now: Instant, downloaded: u64, total: Option<u64>) -> bool {
        let due = match self.last_sent {
            None => true,
            Some((at, bytes)) => {
                total == Some(downloaded)
                    || now.duration_since(at) >= PROGRESS_INTERVAL
                    || total.is_some_and(|total| (downloaded - bytes).saturating_mul(100) >= total)
            }
        };
        if due {
            self.last_sent = Some((now, downloaded));
        }
        due
    }
}

fn is_prerelease_build(version: &str) -> bool {
    let version = version.split('+').next().unwrap_or(version);
    version.contains('-')
}

/// The stable update manifest. It is also in plugins.updater.endpoints in tauri.conf.json.
const STABLE_MANIFEST_URL: &str =
    "https://github.com/Jamie-Fairweather/scrivon/releases/latest/download/latest.json";
const RELEASE_DOWNLOADS_URL: &str =
    "https://github.com/Jamie-Fairweather/scrivon/releases/download";

/// A release tag such as `v1.6.0` or `v1.6.0-rc.2`, with nothing that could change the URL it goes in.
fn is_release_tag(tag: &str) -> bool {
    let Some(version) = tag.strip_prefix('v') else {
        return false;
    };
    let (core, pre) = match version.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    let core_ok = parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()));
    let pre_ok = pre.is_none_or(|pre| {
        !pre.is_empty()
            && pre
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    });
    core_ok && pre_ok
}

/// Where an update check looks. The stable manifest never lists a pre-release, so a pre-release (rc)
/// build first looks at the manifest of `release_tag`, the newest release on GitHub (which the page
/// finds, and may be a newer rc), and then at the stable one. The updater uses the first that answers
/// and only offers a version newer than this one. None keeps the endpoints in tauri.conf.json.
fn manifest_endpoints(current_version: &str, release_tag: Option<&str>) -> Option<Vec<url::Url>> {
    if !is_prerelease_build(current_version) {
        return None;
    }
    let tag = release_tag.filter(|tag| is_release_tag(tag))?;
    Some(vec![
        url::Url::parse(&format!("{RELEASE_DOWNLOADS_URL}/{tag}/latest.json")).ok()?,
        url::Url::parse(STABLE_MANIFEST_URL).ok()?,
    ])
}

/// A plain message for a failed update check.
fn check_error_message(err: &tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error;
    match err {
        Error::Reqwest(_) => {
            "Couldn't reach the update server. Check your internet connection and try again.".into()
        }
        Error::Network(detail) => {
            format!("Couldn't reach the update server ({detail}). Try again later.")
        }
        Error::ReleaseNotFound | Error::Serialization(_) => {
            "The update server didn't say which version is newest. Try again later.".into()
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use std::time::{Duration, Instant};

    use super::{
        check_error_message, count_other_instances, install_error_message, install_pending,
        install_with_record, is_prerelease_build, manifest_endpoints, restarted_after_update,
        take_attempt, ProgressThrottle, UpdateAttempt, UpdateProgress, STABLE_MANIFEST_URL,
    };

    #[test]
    fn progress_is_sent_at_most_every_100_ms_or_1_percent_and_always_at_the_end() {
        let start = Instant::now();
        let ms = |n: u64| start + Duration::from_millis(n);
        let mut throttle = ProgressThrottle::default();
        let total = Some(10_000);

        assert!(throttle.should_send(ms(0), 16, total));
        // Less than 1% more, only 10 ms later.
        assert!(!throttle.should_send(ms(10), 80, total));
        // 1% more.
        assert!(throttle.should_send(ms(20), 116, total));
        // 100 ms on, however little arrived.
        assert!(!throttle.should_send(ms(60), 120, total));
        assert!(throttle.should_send(ms(120), 130, total));
        // The last piece, straight away.
        assert!(throttle.should_send(ms(121), 10_000, total));

        // An unknown size: by time only.
        let mut unknown = ProgressThrottle::default();
        assert!(unknown.should_send(ms(0), 1_000_000, None));
        assert!(!unknown.should_send(ms(50), 9_000_000, None));
        assert!(unknown.should_send(ms(100), 9_500_000, None));
    }

    #[test]
    fn progress_messages_have_the_shape_the_page_reads() {
        let json = |p: UpdateProgress| serde_json::to_value(p).unwrap();
        assert_eq!(
            json(UpdateProgress::Started { total: Some(12) }),
            serde_json::json!({ "event": "started", "total": 12 })
        );
        assert_eq!(
            json(UpdateProgress::Progress {
                downloaded: 5,
                total: None
            }),
            serde_json::json!({ "event": "progress", "downloaded": 5, "total": null })
        );
        assert_eq!(
            json(UpdateProgress::Installing),
            serde_json::json!({ "event": "installing" })
        );
    }

    fn temp_data_dir() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("scrivon-update-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn the_next_launch_hears_that_an_update_never_installed() {
        // The installer was started (the app exits), but permission was declined.
        let dir = temp_data_dir();
        install_with_record(Some(&dir), "1.4.2", "1.5.0", || Ok(())).unwrap();

        assert_eq!(
            take_attempt(&dir, "1.4.2"),
            Some(UpdateAttempt {
                version: "1.5.0".into(),
                installed: false,
            })
        );
        // Only once.
        assert_eq!(take_attempt(&dir, "1.4.2"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_next_launch_hears_that_an_update_installed() {
        let dir = temp_data_dir();
        install_with_record(Some(&dir), "1.4.2", "1.5.0", || Ok(())).unwrap();

        assert_eq!(
            take_attempt(&dir, "1.5.0"),
            Some(UpdateAttempt {
                version: "1.5.0".into(),
                installed: true,
            })
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_next_launch_names_the_version_running_after_one_installed_by_hand() {
        // The in-app update to 1.5.0 didn't install; the user then installed
        // 1.5.1 from the releases page.
        let dir = temp_data_dir();
        install_with_record(Some(&dir), "1.4.2", "1.5.0", || Ok(())).unwrap();

        assert_eq!(
            take_attempt(&dir, "1.5.1"),
            Some(UpdateAttempt {
                version: "1.5.1".into(),
                installed: true,
            })
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_launch_after_an_update_knows_it_until_the_page_takes_the_record() {
        // So it doesn't reopen the files the installer passes back (see setup in lib.rs).
        let dir = temp_data_dir();
        assert!(!restarted_after_update(&dir, "1.5.0"));

        install_with_record(Some(&dir), "1.4.2", "1.5.0", || Ok(())).unwrap();
        assert!(restarted_after_update(&dir, "1.5.0"));

        take_attempt(&dir, "1.5.0");
        assert!(!restarted_after_update(&dir, "1.5.0"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_launch_after_an_update_that_never_installed_is_the_users_own() {
        // The installer was cancelled, so nothing restarted Scrivon. The user
        // then double-clicked a file, and that file should open.
        let dir = temp_data_dir();
        install_with_record(Some(&dir), "1.4.2", "1.5.0", || Ok(())).unwrap();

        assert!(!restarted_after_update(&dir, "1.4.2"));
        // The page still hears that the update didn't install.
        assert_eq!(
            take_attempt(&dir, "1.4.2"),
            Some(UpdateAttempt {
                version: "1.5.0".into(),
                installed: false,
            })
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn skipping_files_and_the_pages_message_always_agree() {
        // Not installed, installed, and a newer one installed by hand.
        for running in ["1.4.2", "1.5.0", "1.5.1"] {
            let dir = temp_data_dir();
            install_with_record(Some(&dir), "1.4.2", "1.5.0", || Ok(())).unwrap();

            let skipped = restarted_after_update(&dir, running);
            let attempt = take_attempt(&dir, running).unwrap();
            assert_eq!(skipped, attempt.installed, "running {running}");
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn a_broken_record_opens_the_files_and_is_cleared() {
        let dir = temp_data_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(super::ATTEMPT_FILE);
        std::fs::write(&file, b"not json").unwrap();

        assert!(!restarted_after_update(&dir, "1.5.0"));
        assert_eq!(take_attempt(&dir, "1.5.0"), None);
        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_install_error_shown_right_away_leaves_no_record() {
        let dir = temp_data_dir();
        let result = install_with_record(Some(&dir), "1.4.2", "1.5.0", || {
            Err("The update couldn't be unpacked.".into())
        });

        assert!(result.is_err());
        assert_eq!(take_attempt(&dir, "1.4.2"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn installs_even_when_the_record_cannot_be_written() {
        let blocker = temp_data_dir();
        std::fs::write(&blocker, b"not a folder").unwrap();
        let mut installed = false;

        let result = install_with_record(Some(&blocker), "1.4.2", "1.5.0", || {
            installed = true;
            Ok(())
        });

        let _ = std::fs::remove_file(&blocker);
        assert!(result.is_ok());
        assert!(installed);
    }

    #[test]
    fn update_checks_use_the_stable_manifest_in_tauri_conf() {
        // check_for_app_update has no URL of its own: without this entry every
        // check fails with "the updater endpoints are empty".
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let endpoints = config["plugins"]["updater"]["endpoints"]
            .as_array()
            .expect("tauri.conf.json needs plugins.updater.endpoints");
        assert_eq!(endpoints, &[serde_json::json!(STABLE_MANIFEST_URL)]);
        assert_eq!(
            STABLE_MANIFEST_URL,
            "https://github.com/Jamie-Fairweather/scrivon/releases/latest/download/latest.json"
        );
    }

    #[test]
    fn prerelease_versions_contain_hyphen() {
        assert!(is_prerelease_build("1.3.0-rc.1"));
        assert!(is_prerelease_build("2.0.0-beta"));
        assert!(!is_prerelease_build("1.3.0"));
        assert!(!is_prerelease_build("1.3.0+build-1"));
    }

    #[test]
    fn an_rc_build_looks_at_the_newest_release_then_the_stable_one() {
        let urls = manifest_endpoints("1.6.0-rc.1", Some("v1.6.0-rc.2")).unwrap();
        let urls: Vec<&str> = urls.iter().map(|url| url.as_str()).collect();
        assert_eq!(
            urls,
            [
                "https://github.com/Jamie-Fairweather/scrivon/releases/download/v1.6.0-rc.2/latest.json",
                STABLE_MANIFEST_URL,
            ]
        );
    }

    #[test]
    fn stable_builds_and_odd_tags_keep_the_stable_manifest() {
        // A stable build never moves onto a pre-release.
        assert_eq!(manifest_endpoints("1.5.0", Some("v1.6.0-rc.1")), None);
        assert_eq!(manifest_endpoints("1.6.0-rc.1", None), None);
        for tag in [
            "v1.6.0-rc.2/../../evil",
            "1.6.0",
            "v1.6",
            "v1.6.0-",
            "v1.6.0-rc?x=1",
            "v1.6.0-rc 2",
        ] {
            assert_eq!(manifest_endpoints("1.6.0-rc.1", Some(tag)), None, "{tag}");
        }
    }

    #[test]
    fn check_errors_read_as_plain_sentences() {
        let message = check_error_message(&tauri_plugin_updater::Error::ReleaseNotFound);
        assert!(message.contains("Try again later"), "{message}");
        let message = check_error_message(&tauri_plugin_updater::Error::Network("503".into()));
        assert!(message.contains("503"), "{message}");
        assert!(!message.contains('`'), "{message}");
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

    #[test]
    fn a_signature_for_another_version_reads_as_a_failed_security_check() {
        let errors = [
            tauri_plugin_updater::Error::SignedVersionMismatch {
                signed: "1.4.0".into(),
                announced: "1.5.0".into(),
            },
            tauri_plugin_updater::Error::MissingSignedVersion,
        ];
        for error in &errors {
            let message = install_error_message(error);
            assert!(message.contains("failed its security check"), "{message}");
            assert!(!message.contains('`'), "{message}");
        }
    }

    #[test]
    fn an_installer_that_cannot_start_reads_as_a_plain_sentence() {
        let error = tauri_plugin_updater::Error::Io(std::io::Error::from(
            std::io::ErrorKind::PermissionDenied,
        ));
        let message = install_error_message(&error);
        assert!(
            message.starts_with("The update couldn't be installed"),
            "{message}"
        );
    }

    #[test]
    fn counts_other_copies_in_the_same_session() {
        let own = "\"Scrivon.exe\",\"4100\",\"Console\",\"1\",\"210,512 K\"";
        let other = "\"Scrivon.exe\",\"5200\",\"Console\",\"1\",\"180,004 K\"";
        let other_user = "\"Scrivon.exe\",\"6300\",\"RDP-Tcp#0\",\"2\",\"150,000 K\"";

        assert_eq!(count_other_instances(own, 4100), 0);
        assert_eq!(
            count_other_instances(&format!("{own}\r\n{other}\r\n"), 4100),
            1
        );
        assert_eq!(
            count_other_instances(&format!("{own}\r\n{other_user}"), 4100),
            0
        );
        assert_eq!(
            count_other_instances(
                "INFO: No tasks are running which match the specified criteria.",
                4100
            ),
            0
        );
        // Own row missing: count every other copy.
        assert_eq!(
            count_other_instances(&format!("{other}\n{other_user}"), 4100),
            2
        );
    }
}

/// Looks for a newer version. `release_tag` is the newest release on GitHub, which only a
/// pre-release build uses (see `manifest_endpoints`).
#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    release_tag: Option<String>,
) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();

    // The manifest URL comes from plugins.updater.endpoints in tauri.conf.json, unless this is
    // a pre-release build. The client settings carry over to the download (`Update::download`).
    let mut builder = app.updater_builder().configure_client(|client| {
        client
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
    });
    if let Some(endpoints) = manifest_endpoints(&current, release_tag.as_deref()) {
        builder = builder.endpoints(endpoints).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| check_error_message(&e))? {
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
        // Since updater 2.14 the version inside the signature must also match the one announced,
        // so a release can't be swapped for an older signed one.
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => {
            "The downloaded update failed its security check, so it wasn't installed.".into()
        }
        // Since updater 2.11 this includes the installer failing to start, which used to close the app.
        Error::Io(detail) => format!("The update couldn't be installed ({detail}). Try again."),
        other => other.to_string(),
    }
}

/// Other running copies of this app in the same Windows session, from
/// `tasklist /FO CSV /NH` rows (`"name","pid","session name","session #","memory"`).
#[cfg(any(windows, test))]
fn count_other_instances(tasklist_csv: &str, own_pid: u32) -> usize {
    let rows: Vec<(u32, &str)> = tasklist_csv
        .lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line
                .trim()
                .strip_prefix('"')?
                .strip_suffix('"')?
                .split("\",\"")
                .collect();
            Some((fields.get(1)?.parse().ok()?, *fields.get(3)?))
        })
        .collect();
    let own_session = rows
        .iter()
        .find(|(pid, _)| *pid == own_pid)
        .map(|(_, session)| *session);
    rows.iter()
        .filter(|(pid, session)| *pid != own_pid && own_session.is_none_or(|own| own == *session))
        .count()
}

/// True when another copy of Scrivon is running for this user. In passive mode
/// the NSIS installer kills every copy without asking, which would throw away
/// any unsaved edits in the others.
#[cfg(windows)]
fn other_instances_running() -> bool {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let Some(image) = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.file_name()?.to_string_lossy().into_owned()))
    else {
        return false;
    };
    let tasklist = std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join(r"System32\tasklist.exe"))
        .unwrap_or_else(|| PathBuf::from("tasklist.exe"));
    let output = Command::new(tasklist)
        .args(["/FO", "CSV", "/NH", "/FI"])
        .arg(format!("IMAGENAME eq {image}"))
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    match output {
        Ok(output) if output.status.success() => {
            count_other_instances(&String::from_utf8_lossy(&output.stdout), std::process::id()) > 0
        }
        // Can't tell: don't block the update.
        _ => false,
    }
}

#[cfg(not(windows))]
fn other_instances_running() -> bool {
    false
}

async fn ensure_no_other_instances() -> Result<(), String> {
    let others = tauri::async_runtime::spawn_blocking(other_instances_running)
        .await
        .unwrap_or(false);
    if others {
        return Err(
            "Scrivon is open in another window. Save your work there and close it, \
            then install the update."
                .into(),
        );
    }
    Ok(())
}

fn record_attempt(dir: &Path, from: &str, to: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let record = AttemptRecord {
        from: from.into(),
        to: to.into(),
    };
    std::fs::write(dir.join(ATTEMPT_FILE), serde_json::to_vec(&record)?)
}

/// Runs `install` with a record of the attempt left in `dir` for the next
/// launch. The record is removed again if `install` fails here, because then
/// the error is shown straight away. On Windows a working `install` never
/// returns: the plugin starts the installer and exits the app.
fn install_with_record(
    dir: Option<&Path>,
    from: &str,
    to: &str,
    install: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if let Some(dir) = dir {
        if let Err(err) = record_attempt(dir, from, to) {
            log::warn!("Could not record the update attempt: {err}");
        }
    }
    let result = install();
    if result.is_err() {
        if let Some(dir) = dir {
            let _ = std::fs::remove_file(dir.join(ATTEMPT_FILE));
        }
    }
    result
}

/// Reads and removes the record of the last update attempt, if there is one.
fn take_attempt(dir: &Path, current_version: &str) -> Option<UpdateAttempt> {
    let record = AttemptRecord::read(dir);
    // Removed even when it can't be read, so a broken file isn't read again.
    let _ = std::fs::remove_file(dir.join(ATTEMPT_FILE));
    let record = record?;
    let installed = record.installed(current_version);
    Some(UpdateAttempt {
        version: if installed {
            current_version.to_string()
        } else {
            record.to
        },
        installed,
    })
}

/// True when this launch is the installer restarting Scrivon after an in-app
/// update: a record is waiting for the page (`take_update_attempt`) and the
/// update installed. The installer only restarts Scrivon when it worked, so
/// otherwise the user started this launch.
pub fn restarted_after_update(dir: &Path, current_version: &str) -> bool {
    AttemptRecord::read(dir).is_some_and(|record| record.installed(current_version))
}

/// Downloads and installs the pending update, telling `on_progress` how the
/// download goes (see `UpdateProgress`).
#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().ok();
    install_pending(&pending.0, |update: Update| async move {
        ensure_no_other_instances().await?;
        let mut downloaded: u64 = 0;
        let mut throttle = ProgressThrottle::default();
        let finished = on_progress.clone();
        // A page that stopped listening doesn't stop the update.
        let bytes = update
            .download(
                |chunk, total| {
                    if downloaded == 0 {
                        let _ = on_progress.send(UpdateProgress::Started { total });
                    }
                    downloaded += chunk as u64;
                    if throttle.should_send(Instant::now(), downloaded, total) {
                        let _ = on_progress.send(UpdateProgress::Progress { downloaded, total });
                    }
                },
                move || {
                    let _ = finished.send(UpdateProgress::Installing);
                },
            )
            .await
            .map_err(|e| {
                // The message is for the user; the log keeps the technical reason.
                log::error!("The update download failed: {e}");
                install_error_message(&e)
            })?;
        // Again, in case another window was opened during the download.
        ensure_no_other_instances().await?;
        install_with_record(
            data_dir.as_deref(),
            &update.current_version,
            &update.version,
            || {
                update.install(bytes).map_err(|e| {
                    log::error!("The update install failed: {e}");
                    install_error_message(&e)
                })
            },
        )
    })
    .await
}

/// How the last in-app update went (once: the record is removed). The frontend
/// asks on launch, so a failed install doesn't just look like the app vanished.
#[tauri::command]
pub fn take_update_attempt(app: AppHandle) -> Option<UpdateAttempt> {
    let dir = app.path().app_data_dir().ok()?;
    take_attempt(&dir, &app.package_info().version.to_string())
}
