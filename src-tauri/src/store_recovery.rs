//! Keeps a damaged `workspace.json` aside instead of letting it be overwritten (D24).
//!
//! The store plugin quietly starts empty when it can't parse a store file, and
//! its next save replaces the file. The frontend then refills the store from
//! `workspace.backup.json` (lib/tauri/store.ts), so anything newer than that
//! copy would be gone with no way to look at it. The webview can't reach the
//! app data folder, so this moves the file aside at startup, before the store
//! or the folder list reads it, and tells the frontend its new name once.

use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const STORE_FILE: &str = "workspace.json";
/// Damaged copies are named this plus the Unix time they were set aside.
const KEPT_PREFIX: &str = "workspace.json.corrupt-";
/// How many damaged copies are kept; older ones are deleted.
const KEEP: usize = 3;

/// The name a damaged `workspace.json` was given at this launch, until the
/// frontend takes it.
#[derive(Default)]
pub struct StoreRecovery(Mutex<Option<String>>);

impl StoreRecovery {
    /// Sets `workspace.json` in `data_dir` aside when it is there but isn't
    /// something the store plugin can read. Must run before the store opens.
    pub fn set_aside_damaged(data_dir: Option<&Path>) -> Self {
        Self(Mutex::new(
            data_dir.and_then(|dir| set_aside_if_damaged(dir, unix_time())),
        ))
    }
}

/// The name a damaged `workspace.json` was kept as at startup, the first time
/// it is asked for (so a reload of the window doesn't say it again).
#[tauri::command]
pub fn take_store_recovery(state: tauri::State<'_, StoreRecovery>) -> Option<String> {
    state.0.lock().unwrap().take()
}

fn unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// What the store plugin can load: a JSON object (its default deserializer).
fn is_readable_store(bytes: &[u8]) -> bool {
    serde_json::from_slice::<HashMap<String, serde_json::Value>>(bytes).is_ok()
}

/// Moves a damaged `workspace.json` to `workspace.json.corrupt-<now>` and
/// returns that name. A missing file, one that reads fine, or one that can't
/// be read just now (locked, say) is left where it is.
fn set_aside_if_damaged(dir: &Path, now: u64) -> Option<String> {
    let file = dir.join(STORE_FILE);
    let bytes = match fs::read(&file) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == ErrorKind::NotFound => return None,
        Err(err) => {
            eprintln!("Could not check {STORE_FILE}: {err}");
            return None;
        }
    };
    if is_readable_store(&bytes) {
        return None;
    }
    // Never over an earlier copy: rename replaces an existing file.
    let name = (now..)
        .map(|time| format!("{KEPT_PREFIX}{time}"))
        .find(|name| !dir.join(name).exists())?;
    if let Err(err) = fs::rename(&file, dir.join(&name)) {
        eprintln!("Could not keep the damaged {STORE_FILE} aside: {err}");
        return None;
    }
    remove_old_copies(dir);
    Some(name)
}

/// Deletes all but the newest `KEEP` damaged copies.
fn remove_old_copies(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut copies: Vec<(u64, std::path::PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name();
            let time = name.to_str()?.strip_prefix(KEPT_PREFIX)?.parse().ok()?;
            Some((time, entry.path()))
        })
        .collect();
    copies.sort_unstable_by_key(|(time, _)| std::cmp::Reverse(*time));
    for (_, path) in copies.into_iter().skip(KEEP) {
        if let Err(err) = fs::remove_file(&path) {
            eprintln!("Could not delete {}: {err}", path.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir()
                .join(format!("scrivon-store-recovery-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .collect();
            names.sort();
            names
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_file_that_is_not_a_json_object_is_kept_aside_under_a_new_name() {
        for damaged in [
            "",
            "\0\0\0\0",
            "{\"recent-workspaces\": [",
            "[1, 2]",
            "null",
        ] {
            let dir = TempDir::new();
            fs::write(dir.0.join(STORE_FILE), damaged).unwrap();

            let kept = set_aside_if_damaged(&dir.0, 1_700_000_000);

            assert_eq!(kept.as_deref(), Some("workspace.json.corrupt-1700000000"));
            assert_eq!(dir.names(), ["workspace.json.corrupt-1700000000"]);
            let moved = fs::read_to_string(dir.0.join("workspace.json.corrupt-1700000000"));
            assert_eq!(moved.unwrap(), damaged);
        }
    }

    #[test]
    fn a_readable_or_missing_file_is_left_alone() {
        let dir = TempDir::new();
        assert_eq!(set_aside_if_damaged(&dir.0, 1), None);

        fs::write(
            dir.0.join(STORE_FILE),
            r#"{"recent-workspaces":["C:\\notes"]}"#,
        )
        .unwrap();
        assert_eq!(set_aside_if_damaged(&dir.0, 1), None);
        assert_eq!(dir.names(), [STORE_FILE]);
    }

    #[test]
    fn an_earlier_copy_with_the_same_time_is_not_replaced() {
        let dir = TempDir::new();
        fs::write(dir.0.join("workspace.json.corrupt-5"), "first").unwrap();
        fs::write(dir.0.join(STORE_FILE), "second").unwrap();

        assert_eq!(
            set_aside_if_damaged(&dir.0, 5).as_deref(),
            Some("workspace.json.corrupt-6")
        );
        let first = fs::read_to_string(dir.0.join("workspace.json.corrupt-5"));
        assert_eq!(first.unwrap(), "first");
    }

    #[test]
    fn only_the_newest_copies_are_kept() {
        let dir = TempDir::new();
        for time in [100, 300, 200, 400] {
            fs::write(dir.0.join(format!("{KEPT_PREFIX}{time}")), "old").unwrap();
        }
        fs::write(dir.0.join("workspace.json.corrupt-notes"), "mine").unwrap();
        fs::write(dir.0.join(STORE_FILE), "damaged").unwrap();

        set_aside_if_damaged(&dir.0, 500);

        assert_eq!(
            dir.names(),
            [
                "workspace.json.corrupt-300",
                "workspace.json.corrupt-400",
                "workspace.json.corrupt-500",
                "workspace.json.corrupt-notes",
            ]
        );
    }

    #[test]
    fn the_new_name_is_kept_for_the_frontend() {
        let dir = TempDir::new();
        fs::write(dir.0.join(STORE_FILE), "damaged").unwrap();

        let recovery = StoreRecovery::set_aside_damaged(Some(&dir.0));

        let kept = recovery.0.lock().unwrap().clone().unwrap();
        assert!(kept.starts_with(KEPT_PREFIX), "{kept}");
        assert!(dir.0.join(&kept).exists());
        assert!(!dir.0.join(STORE_FILE).exists());
        assert!(StoreRecovery::set_aside_damaged(None)
            .0
            .lock()
            .unwrap()
            .is_none());
    }
}
