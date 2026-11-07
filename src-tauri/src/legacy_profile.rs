//! Brings settings and recent folders over from before the 1.4.1 rename (D19).
//!
//! Tauri names the app's data folders after the bundle identifier, and 1.4.1
//! changed it from `com.diagram.app` to `io.github.jamie-fairweather.scrivon`.
//! Nothing moved the old data, so anyone updating from 1.4.0 or older started
//! with default settings and shortcuts (the webview's localStorage, in the
//! WebView2 profile under the local app data folder) and with no recent folders
//! or open tabs (`workspace.json`, under the roaming one).
//!
//! This copies both across once. It runs before the store files are opened and
//! before the window is built, because WebView2 opens its profile then. It
//! never replaces anything already in the new folders and leaves the old ones
//! as they are.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::Manager;

const OLD_IDENTIFIER: &str = "com.diagram.app";
/// Written once everything was copied (or there was nothing to copy).
const MARKER: &str = ".migrated-from-com.diagram.app";
const STORE_FILE: &str = "workspace.json";
/// Where WebView2 keeps localStorage inside the app's local data folder. The
/// page's origin (http://tauri.localhost) didn't change, so its keys still match.
const LOCAL_STORAGE: [&str; 3] = ["EBWebView", "Default", "Local Storage"];
/// The old version's window may still be closing, and holding the settings
/// files, when this one starts (right after an update, say). Their copy is
/// tried a few times, since it can only happen before this window opens:
/// WebView2 then starts a new profile, which is never replaced.
const SETTINGS_COPY_ATTEMPTS: u32 = 5;
const SETTINGS_COPY_RETRY: Duration = Duration::from_millis(200);

/// The data folders before and after the rename: roaming (the store files) and
/// local (the WebView2 profile).
struct Folders {
    old_roaming: PathBuf,
    old_local: PathBuf,
    new_roaming: PathBuf,
    new_local: PathBuf,
}

/// Copies the old folders' data in, the first time this version runs. Errors
/// are logged and startup carries on.
pub fn migrate(app: &tauri::App) {
    let path = app.path();
    let folders = (|| {
        Some(Folders {
            old_roaming: path.data_dir().ok()?.join(OLD_IDENTIFIER),
            old_local: path.local_data_dir().ok()?.join(OLD_IDENTIFIER),
            new_roaming: path.app_data_dir().ok()?,
            new_local: path.app_local_data_dir().ok()?,
        })
    })();
    if let Some(folders) = folders {
        migrate_folders(&folders, SETTINGS_COPY_RETRY);
    }
}

fn migrate_folders(folders: &Folders, settings_retry: Duration) {
    let marker = folders.new_roaming.join(MARKER);
    if marker.exists() {
        return;
    }
    let mut copied_all = true;

    let old_store = folders.old_roaming.join(STORE_FILE);
    let new_store = folders.new_roaming.join(STORE_FILE);
    if old_store.is_file() && !new_store.exists() {
        if let Err(err) = copy_into_place(&old_store, &new_store, copy_file) {
            eprintln!("Could not copy the recent folders from {OLD_IDENTIFIER}: {err}");
            copied_all = false;
        }
    }

    let old_storage = local_storage(&folders.old_local);
    let new_storage = local_storage(&folders.new_local);
    if old_storage.is_dir() && is_missing_or_empty(&new_storage) {
        let copied = retried(SETTINGS_COPY_ATTEMPTS, settings_retry, || {
            copy_into_place(&old_storage, &new_storage, copy_dir)
        });
        if let Err(err) = copied {
            eprintln!("Could not copy the settings from {OLD_IDENTIFIER}: {err}");
            copied_all = false;
        }
    }

    // After a failed copy the next launch tries again, but only for what is
    // still missing then, since it never replaces data. That usually still
    // includes the recent folders, but not the settings: WebView2 starts a new
    // profile as soon as the window opens.
    if copied_all {
        if let Err(err) =
            fs::create_dir_all(&folders.new_roaming).and_then(|()| fs::write(&marker, b""))
        {
            eprintln!("Could not note that the old settings were copied: {err}");
        }
    }
}

/// Runs `step` up to `attempts` times, `wait` apart, until it works.
fn retried(
    attempts: u32,
    wait: Duration,
    mut step: impl FnMut() -> io::Result<()>,
) -> io::Result<()> {
    let mut attempt = 1;
    loop {
        match step() {
            Err(_) if attempt < attempts => {
                attempt += 1;
                std::thread::sleep(wait);
            }
            result => return result,
        }
    }
}

fn local_storage(local_data: &Path) -> PathBuf {
    LOCAL_STORAGE
        .iter()
        .fold(local_data.to_path_buf(), |path, part| path.join(part))
}

/// True when `path` doesn't exist or is an empty folder. Any other problem
/// reading it counts as "has data", so it is left alone.
fn is_missing_or_empty(path: &Path) -> bool {
    match fs::read_dir(path) {
        Ok(mut entries) => entries.next().is_none(),
        Err(err) => err.kind() == ErrorKind::NotFound,
    }
}

/// Copies `from` next to `to` first and then moves it into place, so a copy
/// that is cut off never leaves half a file or half a localStorage database.
fn copy_into_place(
    from: &Path,
    to: &Path,
    copy: fn(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let parent = to.parent().ok_or(ErrorKind::InvalidInput)?;
    let name = to.file_name().ok_or(ErrorKind::InvalidInput)?;
    let staging = parent.join(format!("{}.migrating", name.to_string_lossy()));
    fs::create_dir_all(parent)?;
    remove_any(&staging);
    let result = copy(from, &staging).and_then(|()| {
        // Only an empty folder gets here, and remove_dir never removes anything else.
        if to.is_dir() {
            fs::remove_dir(to)?;
        }
        fs::rename(&staging, to)
    });
    if result.is_err() {
        remove_any(&staging);
    }
    result
}

fn copy_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::copy(from, to).map(|_| ())
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &target)?;
        }
        // WebView2 doesn't make links, so any found here are skipped.
    }
    Ok(())
}

fn remove_any(path: &Path) {
    let _ = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir()
                .join(format!("scrivon-legacy-profile-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn folders(&self) -> Folders {
            Folders {
                old_roaming: self.0.join("Roaming").join(OLD_IDENTIFIER),
                old_local: self.0.join("Local").join(OLD_IDENTIFIER),
                new_roaming: self.0.join("Roaming").join("new"),
                new_local: self.0.join("Local").join("new"),
            }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, text: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }

    fn read(path: &Path) -> Option<String> {
        fs::read_to_string(path).ok()
    }

    /// An old install: recent folders and a localStorage database.
    fn old_install(folders: &Folders) {
        write(
            &folders.old_roaming.join(STORE_FILE),
            r#"{"recent-workspaces":["C:\\notes"]}"#,
        );
        write(
            &local_storage(&folders.old_local)
                .join("leveldb")
                .join("000003.log"),
            "settings",
        );
        write(
            &local_storage(&folders.old_local)
                .join("leveldb")
                .join("CURRENT"),
            "MANIFEST-000001",
        );
    }

    #[test]
    fn copies_the_old_settings_and_recent_folders_when_the_new_folders_have_none() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);

        migrate_folders(&folders, Duration::ZERO);

        assert_eq!(
            read(&folders.new_roaming.join(STORE_FILE)).as_deref(),
            Some(r#"{"recent-workspaces":["C:\\notes"]}"#)
        );
        let leveldb = local_storage(&folders.new_local).join("leveldb");
        assert_eq!(
            read(&leveldb.join("000003.log")).as_deref(),
            Some("settings")
        );
        assert_eq!(
            read(&leveldb.join("CURRENT")).as_deref(),
            Some("MANIFEST-000001")
        );
        assert!(folders.new_roaming.join(MARKER).exists());
        // The old folders are left as they were.
        assert!(folders.old_roaming.join(STORE_FILE).exists());
        assert!(local_storage(&folders.old_local)
            .join("leveldb")
            .join("CURRENT")
            .exists());
        // Nothing is left half-copied next to them.
        assert!(!local_storage(&folders.new_local)
            .with_file_name("Local Storage.migrating")
            .exists());
    }

    #[test]
    fn copies_settings_into_an_empty_local_storage_folder() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);
        fs::create_dir_all(local_storage(&folders.new_local)).unwrap();

        migrate_folders(&folders, Duration::ZERO);

        assert_eq!(
            read(
                &local_storage(&folders.new_local)
                    .join("leveldb")
                    .join("000003.log")
            )
            .as_deref(),
            Some("settings")
        );
    }

    #[test]
    fn never_replaces_what_the_new_folders_already_hold() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);
        write(&folders.new_roaming.join(STORE_FILE), "{}");
        write(
            &local_storage(&folders.new_local)
                .join("leveldb")
                .join("CURRENT"),
            "new",
        );

        migrate_folders(&folders, Duration::ZERO);

        assert_eq!(
            read(&folders.new_roaming.join(STORE_FILE)).as_deref(),
            Some("{}")
        );
        let leveldb = local_storage(&folders.new_local).join("leveldb");
        assert_eq!(read(&leveldb.join("CURRENT")).as_deref(), Some("new"));
        assert!(!leveldb.join("000003.log").exists());
    }

    #[test]
    fn runs_only_once() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);
        migrate_folders(&folders, Duration::ZERO);

        // The user cleared their recent folders, then started Scrivon again.
        fs::remove_file(folders.new_roaming.join(STORE_FILE)).unwrap();
        fs::remove_dir_all(local_storage(&folders.new_local)).unwrap();
        migrate_folders(&folders, Duration::ZERO);

        assert!(!folders.new_roaming.join(STORE_FILE).exists());
        assert!(!local_storage(&folders.new_local).exists());
    }

    #[test]
    fn notes_a_first_install_with_nothing_to_copy() {
        let temp = TempDir::new();
        let folders = temp.folders();

        migrate_folders(&folders, Duration::ZERO);

        assert!(folders.new_roaming.join(MARKER).exists());
        assert!(!folders.new_roaming.join(STORE_FILE).exists());
        assert!(!local_storage(&folders.new_local).exists());
    }

    #[test]
    fn a_copy_cut_off_part_way_leaves_nothing_behind() {
        let temp = TempDir::new();
        let from = temp.0.join("from");
        write(&from.join("a"), "a");
        let to = temp.0.join("new").join("Local Storage");
        fn fails_part_way(from: &Path, to: &Path) -> io::Result<()> {
            copy_dir(from, to)?;
            Err(io::Error::other("disk full"))
        }

        assert!(copy_into_place(&from, &to, fails_part_way).is_err());

        assert!(!to.exists());
        assert!(!to.with_file_name("Local Storage.migrating").exists());
    }

    /// Opens `path` the way a program does that lets nothing else read it.
    #[cfg(windows)]
    fn hold(path: &Path) -> fs::File {
        use std::os::windows::fs::OpenOptionsExt;
        fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(path)
            .unwrap()
    }

    #[cfg(windows)]
    #[test]
    fn copies_the_settings_once_the_old_window_closing_lets_go_of_them() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);
        let current = local_storage(&folders.old_local)
            .join("leveldb")
            .join("CURRENT");
        let held = hold(&current);
        let closing = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(held);
        });

        migrate_folders(&folders, Duration::from_millis(200));
        closing.join().unwrap();

        assert_eq!(
            read(
                &local_storage(&folders.new_local)
                    .join("leveldb")
                    .join("CURRENT")
            )
            .as_deref(),
            Some("MANIFEST-000001")
        );
        assert!(folders.new_roaming.join(MARKER).exists());
    }

    #[cfg(windows)]
    #[test]
    fn recent_folders_that_could_not_be_copied_are_tried_again_next_launch() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);
        let held = hold(&folders.old_roaming.join(STORE_FILE));

        migrate_folders(&folders, Duration::ZERO);

        assert!(!folders.new_roaming.join(MARKER).exists());
        assert!(!folders.new_roaming.join(STORE_FILE).exists());

        drop(held);
        migrate_folders(&folders, Duration::ZERO);

        assert_eq!(
            read(&folders.new_roaming.join(STORE_FILE)).as_deref(),
            Some(r#"{"recent-workspaces":["C:\\notes"]}"#)
        );
        assert!(folders.new_roaming.join(MARKER).exists());
    }

    // On Windows a path through a file reads as missing, so the copy is tried
    // and fails; elsewhere it reads as "has data" and is skipped.
    #[cfg(windows)]
    #[test]
    fn settings_that_could_not_be_copied_never_replace_the_profile_started_since() {
        let temp = TempDir::new();
        let folders = temp.folders();
        old_install(&folders);
        // A file where the new profile's folder should be makes the copy fail.
        write(&folders.new_local.join("EBWebView"), "in the way");

        migrate_folders(&folders, Duration::ZERO);

        assert!(!folders.new_roaming.join(MARKER).exists());
        // The other copy still happened.
        assert!(folders.new_roaming.join(STORE_FILE).exists());

        // The window opened, and WebView2 started a profile of its own, which
        // holds whatever the user has set since.
        fs::remove_file(folders.new_local.join("EBWebView")).unwrap();
        let leveldb = local_storage(&folders.new_local).join("leveldb");
        write(&leveldb.join("CURRENT"), "new");
        migrate_folders(&folders, Duration::ZERO);

        assert_eq!(read(&leveldb.join("CURRENT")).as_deref(), Some("new"));
        assert!(!leveldb.join("000003.log").exists());
        assert!(folders.new_roaming.join(MARKER).exists());
    }

    #[test]
    fn gives_up_on_a_step_that_keeps_failing() {
        let mut tries = 0;

        let result = retried(5, Duration::ZERO, || {
            tries += 1;
            Err(io::Error::other("still held"))
        });

        assert!(result.is_err());
        assert_eq!(tries, 5);
    }
}
