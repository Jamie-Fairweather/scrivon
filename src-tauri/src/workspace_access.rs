//! Which folders the frontend may open as a workspace.
//!
//! The fs plugin only lets the webview touch paths in its runtime scope, so
//! `allow_workspace` must not add whatever path it is handed: a script in the
//! webview could then grant itself the whole disk. A folder is accepted only
//! when the user chose it. Either the folder dialog has just added it to the
//! scope, or the user chose it in an earlier session (a recent folder or a
//! restored session). Those folders are kept in `workspace-access.json` in the
//! app data folder, which the webview cannot write, unlike the store's list of
//! recent folders.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

const ACCESS_FILE: &str = "workspace-access.json";
/// The frontend's plugin-store file and its recent-folders key (lib/tauri/store.ts).
const STORE_FILE: &str = "workspace.json";
const RECENT_KEY: &str = "recent-workspaces";
/// Entries kept (up to two per folder). Older folders must be chosen again.
const MAX_ENTRIES: usize = 200;

#[derive(serde::Serialize, serde::Deserialize)]
struct AccessFile {
    folders: Vec<String>,
}

#[derive(Default)]
pub struct WorkspaceAccess {
    file: Option<PathBuf>,
    folders: Mutex<Vec<String>>,
}

impl WorkspaceAccess {
    /// Loads the folders chosen in earlier sessions. When the list doesn't exist
    /// yet (the first run with this check), it starts from the recent folders so
    /// they keep opening after the update.
    pub fn load(data_dir: Option<&Path>) -> Self {
        let Some(dir) = data_dir else {
            return Self::default();
        };
        let file = dir.join(ACCESS_FILE);
        let folders = match read_access_file(&file) {
            Some(folders) => folders,
            None => {
                let mut seeded = read_recent_workspaces(&dir.join(STORE_FILE));
                seeded.truncate(MAX_ENTRIES);
                if let Err(err) = write_access_file(&file, &seeded) {
                    eprintln!("Could not save the workspace folder list: {err}");
                }
                seeded
            }
        };
        Self {
            file: Some(file),
            folders: Mutex::new(folders),
        }
    }

    /// True when `path` is a folder the user chose in an earlier session.
    fn is_remembered(&self, path: &str) -> bool {
        let folders = self.folders.lock().unwrap();
        if folders.iter().any(|folder| folder == path) {
            return true;
        }
        canonical_string(Path::new(path)).is_some_and(|canonical| folders.contains(&canonical))
    }

    /// Records `path` (and its canonical form) as chosen by the user, newest first.
    fn remember(&self, path: &str) {
        let mut entries = vec![path.to_string()];
        if let Some(canonical) = canonical_string(Path::new(path)) {
            if canonical != path {
                entries.push(canonical);
            }
        }

        let snapshot = {
            let mut folders = self.folders.lock().unwrap();
            if folders.starts_with(&entries) {
                return;
            }
            let older = std::mem::take(&mut *folders);
            let older = older.into_iter().filter(|folder| !entries.contains(folder));
            *folders = entries
                .iter()
                .cloned()
                .chain(older)
                .take(MAX_ENTRIES)
                .collect();
            folders.clone()
        };

        if let Some(file) = &self.file {
            if let Err(err) = write_access_file(file, &snapshot) {
                eprintln!("Could not save the workspace folder list: {err}");
            }
        }
    }

    /// Accepts `path` as a workspace when the user chose it: `in_scope` (the fs
    /// scope, which the folder dialog adds the picked folder to) allows it, or it
    /// was chosen in an earlier session. Accepted folders are remembered so they
    /// can be reopened after a restart.
    pub fn approve(&self, path: &str, in_scope: impl Fn(&Path) -> bool) -> Result<(), String> {
        let folder = Path::new(path);
        if !folder.is_absolute() || !folder.is_dir() {
            return Err(format!("Folder not found: {path}"));
        }
        if !in_scope(folder) && !self.is_remembered(path) {
            return Err(format!(
                "Scrivon can only open folders you choose. Use Open Folder to choose {path} again."
            ));
        }
        self.remember(path);
        Ok(())
    }
}

fn canonical_string(path: &Path) -> Option<String> {
    std::fs::canonicalize(path)
        .ok()
        .map(|canonical| canonical.to_string_lossy().into_owned())
}

fn read_access_file(file: &Path) -> Option<Vec<String>> {
    let bytes = std::fs::read(file).ok()?;
    let parsed: AccessFile = serde_json::from_slice(&bytes).ok()?;
    Some(parsed.folders)
}

fn write_access_file(file: &Path, folders: &[String]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(&AccessFile {
        folders: folders.to_vec(),
    })?;
    // Write a temporary file and swap it in, so a failed write never leaves a
    // half-written list behind.
    let temp = file.with_extension("json.tmp");
    std::fs::write(&temp, json)?;
    std::fs::rename(&temp, file)
}

fn read_recent_workspaces(store_file: &Path) -> Vec<String> {
    let Ok(bytes) = std::fs::read(store_file) else {
        return Vec::new();
    };
    let Ok(store) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Vec::new();
    };
    store
        .get(RECENT_KEY)
        .and_then(|recents| recents.as_array())
        .map(|recents| {
            recents
                .iter()
                .filter_map(|path| path.as_str())
                .filter(|path| !path.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "scrivon-workspace-access-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn folder(&self, name: &str) -> String {
            let folder = self.0.join(name);
            std::fs::create_dir_all(&folder).unwrap();
            folder.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn never_in_scope(_: &Path) -> bool {
        false
    }

    #[test]
    fn refuses_a_folder_the_user_never_chose() {
        let temp = TempDir::new("refuse");
        let folder = temp.folder("project");
        let access = WorkspaceAccess::load(Some(&temp.0.join("data")));

        let err = access.approve(&folder, never_in_scope).unwrap_err();
        assert!(err.contains("Open Folder"), "{err}");
    }

    #[test]
    fn accepts_a_folder_the_dialog_just_added_and_remembers_it_after_restart() {
        let temp = TempDir::new("dialog");
        let data = temp.0.join("data");
        let folder = temp.folder("project");

        let access = WorkspaceAccess::load(Some(&data));
        access
            .approve(&folder, |path| path == Path::new(&folder))
            .unwrap();

        let restarted = WorkspaceAccess::load(Some(&data));
        restarted.approve(&folder, never_in_scope).unwrap();
    }

    #[test]
    fn a_chosen_folder_does_not_unlock_its_parent() {
        let temp = TempDir::new("parent");
        let data = temp.0.join("data");
        let folder = temp.folder("project");
        let parent = temp.0.to_string_lossy().into_owned();
        let dotted = format!("{folder}{}..", std::path::MAIN_SEPARATOR);

        let access = WorkspaceAccess::load(Some(&data));
        access
            .approve(&folder, |path| path == Path::new(&folder))
            .unwrap();

        assert!(access.approve(&parent, never_in_scope).is_err());
        assert!(access.approve(&dotted, never_in_scope).is_err());
    }

    #[test]
    fn refuses_missing_and_relative_folders() {
        let temp = TempDir::new("missing");
        let access = WorkspaceAccess::load(Some(&temp.0.join("data")));
        let missing = temp.0.join("gone").to_string_lossy().into_owned();

        assert!(access
            .approve(&missing, |_| true)
            .unwrap_err()
            .starts_with("Folder not found"));
        assert!(access.approve(".", |_| true).is_err());
    }

    #[test]
    fn first_run_keeps_the_existing_recent_folders_working() {
        let temp = TempDir::new("seed");
        let data = temp.0.join("data");
        let recent = temp.folder("recent");
        let other = temp.folder("other");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(
            data.join(STORE_FILE),
            serde_json::to_vec(&serde_json::json!({ RECENT_KEY: [recent, 42, ""] })).unwrap(),
        )
        .unwrap();

        let access = WorkspaceAccess::load(Some(&data));
        access.approve(&recent, never_in_scope).unwrap();
        assert!(access.approve(&other, never_in_scope).is_err());

        // Later edits to the store's recents (which the webview can write) are ignored.
        std::fs::write(
            data.join(STORE_FILE),
            serde_json::to_vec(&serde_json::json!({ RECENT_KEY: [other] })).unwrap(),
        )
        .unwrap();
        let restarted = WorkspaceAccess::load(Some(&data));
        assert!(restarted.approve(&other, never_in_scope).is_err());
        restarted.approve(&recent, never_in_scope).unwrap();
    }

    #[test]
    fn keeps_the_newest_folders_when_the_list_is_full() {
        let access = WorkspaceAccess::default();
        for i in 0..MAX_ENTRIES + 5 {
            access.remember(&format!("missing-folder-{i}"));
        }
        let folders = access.folders.lock().unwrap();
        assert_eq!(folders.len(), MAX_ENTRIES);
        assert_eq!(folders[0], format!("missing-folder-{}", MAX_ENTRIES + 4));
    }
}
