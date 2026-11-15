//! Which folders the frontend may open as a workspace.
//!
//! The fs plugin only lets the webview touch paths in its runtime scope, so
//! `allow_workspace` must not add whatever path it is handed: a script in the
//! webview could then grant itself the whole disk. A folder is accepted only
//! when the user chose it. Either the folder dialog has just added it to the
//! scope, or the user chose it in an earlier session (a recent folder or a
//! restored session).
//!
//! Those folders are kept in `workspace-access.json` in the app data folder.
//! The webview can't create store files: it only reaches the few the app opens
//! at startup (`open_stores` in lib.rs), so it can't write this one. The fs
//! plugin isn't given the app data folder either (capabilities/default.json has
//! `fs:deny-default`, not `fs:default`), so it can only write here if the user
//! opens or drops a folder that contains the app data folder. Even a
//! file forged some other way can't add a folder: the store only ever writes a
//! JSON object, and this list is a bare JSON array, so such a file is cleared
//! and the user picks the folders again. The store's recent folders, which the
//! webview can write, are only copied in when the list doesn't exist yet (the
//! first run with this check), never because it can't be read.

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const ACCESS_FILE: &str = "workspace-access.json";
/// The frontend's plugin-store file and its recent-folders key (lib/tauri/store.ts).
const STORE_FILE: &str = "workspace.json";
const RECENT_KEY: &str = "recent-workspaces";
/// Entries kept (up to two per folder). Older folders must be chosen again.
const MAX_ENTRIES: usize = 200;

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
            Ok(folders) => folders,
            Err(err) if err.kind() == ErrorKind::NotFound => {
                let mut seeded = read_recent_workspaces(&dir.join(STORE_FILE));
                seeded.truncate(MAX_ENTRIES);
                save_access_file(&file, &seeded);
                seeded
            }
            // Not a list Scrivon wrote: broken, or written through the store
            // plugin. Start empty and put a valid list back; the user picks the
            // folders again.
            Err(err) if err.kind() == ErrorKind::InvalidData => {
                log::warn!("The workspace folder list wasn't valid, so it was cleared: {err}");
                save_access_file(&file, &[]);
                Vec::new()
            }
            // Couldn't be read just now (locked, say): start empty but leave the
            // file alone. `remember` merges it back in.
            Err(err) => {
                log::warn!("Could not read the workspace folder list: {err}");
                Vec::new()
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

        // Read and write under the lock, so two calls can't undo each other.
        let mut folders = self.folders.lock().unwrap();
        // Another Scrivon window may have saved folders since this one started:
        // keep them, or they'd stop opening after a restart.
        let saved = self
            .file
            .as_deref()
            .and_then(|file| read_access_file(file).ok());
        let merged = merge_newest_first(&[
            entries.as_slice(),
            saved.as_deref().unwrap_or_default(),
            folders.as_slice(),
        ]);
        let unchanged = saved.as_ref() == Some(&merged);
        *folders = merged;
        if unchanged {
            return;
        }
        if let Some(file) = &self.file {
            save_access_file(file, &folders);
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

    /// Stops `path` opening without the folder dialog (the user removed it
    /// from Recent), and takes it out of the saved list in each spelling it was
    /// recorded under, so its name no longer stays in the app data either.
    ///
    /// When `path` leads to another folder (a `subst` drive or a link), its
    /// canonical form names that folder. Only the canonical spelling `remember`
    /// recorded goes, not that folder's own entry: removing the link from
    /// Recent mustn't stop the folder itself opening from Recent.
    pub fn forget(&self, path: &str) {
        let canonical = canonical_or_parent(Path::new(path));
        let forgotten = |folder: &str| {
            same_folder(folder, path)
                || canonical.as_deref().is_some_and(|canonical| {
                    is_canonical_spelling(folder) && same_folder(folder, canonical)
                })
        };

        // Read and write under the lock, as `remember` does.
        let mut folders = self.folders.lock().unwrap();
        let saved = self
            .file
            .as_deref()
            .and_then(|file| read_access_file(file).ok());
        let kept: Vec<String> =
            merge_newest_first(&[saved.as_deref().unwrap_or_default(), folders.as_slice()])
                .into_iter()
                .filter(|folder| !forgotten(folder))
                .collect();
        let unchanged = saved.as_ref() == Some(&kept);
        *folders = kept;
        if unchanged {
            return;
        }
        if let Some(file) = &self.file {
            save_access_file(file, &folders);
        }
    }
}

fn canonical_string(path: &Path) -> Option<String> {
    std::fs::canonicalize(path)
        .ok()
        .map(|canonical| canonical.to_string_lossy().into_owned())
}

/// The canonical form of `path`. For a folder that is gone (moved, or on a
/// drive that isn't there), that of the nearest folder above it that is still
/// there, with the rest of the path added back.
fn canonical_or_parent(path: &Path) -> Option<String> {
    let mut rest = Vec::new();
    let mut folder = path;
    loop {
        if let Ok(mut canonical) = std::fs::canonicalize(folder) {
            canonical.extend(rest.iter().rev());
            return Some(canonical.to_string_lossy().into_owned());
        }
        rest.push(folder.file_name()?);
        folder = folder.parent()?;
    }
}

/// True when `folder` is spelled as `std::fs::canonicalize` gives it, which on
/// Windows starts with `\\?\`. Elsewhere it looks like any other path, so
/// every folder counts.
fn is_canonical_spelling(folder: &str) -> bool {
    !cfg!(windows) || folder.starts_with(r"\\?\")
}

/// True when `a` and `b` name the same folder. On Windows letter case, either
/// slash, a trailing slash and the `\\?\` prefix of a canonical path don't
/// count.
fn same_folder(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        let key = |path: &str| {
            let path = path.replace('/', "\\");
            let local = if let Some(share) = path.strip_prefix(r"\\?\UNC\") {
                format!(r"\\{share}")
            } else {
                path.strip_prefix(r"\\?\").unwrap_or(&path).to_string()
            };
            local.trim_end_matches('\\').to_lowercase()
        };
        key(a) == key(b)
    } else {
        a.trim_end_matches('/') == b.trim_end_matches('/')
    }
}

/// The lists' folders in order, each once, at most `MAX_ENTRIES`.
fn merge_newest_first(lists: &[&[String]]) -> Vec<String> {
    let mut seen = HashSet::new();
    lists
        .iter()
        .flat_map(|list| list.iter())
        .filter(|folder| seen.insert(folder.as_str()))
        .take(MAX_ENTRIES)
        .cloned()
        .collect()
}

/// The saved list. Anything but a JSON array of strings (such as the object
/// the store plugin writes) is `ErrorKind::InvalidData`.
fn read_access_file(file: &Path) -> std::io::Result<Vec<String>> {
    let bytes = std::fs::read(file)?;
    serde_json::from_slice(&bytes).map_err(|err| std::io::Error::new(ErrorKind::InvalidData, err))
}

fn save_access_file(file: &Path, folders: &[String]) {
    if let Err(err) = write_access_file(file, folders) {
        log::warn!("Could not save the workspace folder list: {err}");
    }
}

fn write_access_file(file: &Path, folders: &[String]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // A bare array, never an object (see the module comment).
    let json = serde_json::to_vec_pretty(folders)?;
    // Write a temporary file and swap it in, so a failed write never leaves a
    // half-written list behind. Each write gets its own temporary file, so two
    // Scrivon windows saving at once don't trip over each other.
    let id = uuid::Uuid::new_v4().simple().to_string();
    let temp = file.with_extension(format!("json.{}.tmp", &id[..8]));
    let written = std::fs::write(&temp, json).and_then(|()| std::fs::rename(&temp, file));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
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

    /// A JSON object such as `{"folders": [...]}`: the only shape the store
    /// plugin can write, so a webview script can't plant a folder this way.
    #[test]
    fn a_list_written_through_the_store_plugin_unlocks_nothing() {
        let temp = TempDir::new("forged");
        let data = temp.0.join("data");
        let folder = temp.folder("planted");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(
            data.join(ACCESS_FILE),
            serde_json::to_vec(&serde_json::json!({ "folders": [folder] })).unwrap(),
        )
        .unwrap();
        // Planting it in the recents doesn't help either: they only seed a missing list.
        std::fs::write(
            data.join(STORE_FILE),
            serde_json::to_vec(&serde_json::json!({ RECENT_KEY: [folder] })).unwrap(),
        )
        .unwrap();

        let access = WorkspaceAccess::load(Some(&data));
        assert!(access.approve(&folder, never_in_scope).is_err());
        // The broken list was replaced with a valid, empty one.
        assert_eq!(
            read_access_file(&data.join(ACCESS_FILE)).unwrap(),
            Vec::<String>::new()
        );
        let restarted = WorkspaceAccess::load(Some(&data));
        assert!(restarted.approve(&folder, never_in_scope).is_err());
    }

    #[test]
    fn two_windows_keep_the_folders_each_other_opened() {
        let temp = TempDir::new("windows");
        let data = temp.0.join("data");
        let first = temp.folder("first");
        let second = temp.folder("second");
        let window_a = WorkspaceAccess::load(Some(&data));
        let window_b = WorkspaceAccess::load(Some(&data));

        window_a
            .approve(&first, |path| path == Path::new(&first))
            .unwrap();
        window_b
            .approve(&second, |path| path == Path::new(&second))
            .unwrap();

        let restarted = WorkspaceAccess::load(Some(&data));
        restarted.approve(&first, never_in_scope).unwrap();
        restarted.approve(&second, never_in_scope).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(&data)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
    }

    #[test]
    fn a_folder_removed_from_recent_needs_the_folder_dialog_again() {
        let temp = TempDir::new("forget");
        let data = temp.0.join("data");
        let private = temp.folder("private");
        let other = temp.folder("other");
        let access = WorkspaceAccess::load(Some(&data));
        for folder in [&private, &other] {
            access
                .approve(folder, |path| path == Path::new(folder))
                .unwrap();
        }

        access.forget(&private);

        let err = access.approve(&private, never_in_scope).unwrap_err();
        assert!(err.contains("Open Folder"), "{err}");
        // Neither spelling stays in the app data.
        let canonical = canonical_string(Path::new(&private)).unwrap();
        let saved = read_access_file(&data.join(ACCESS_FILE)).unwrap();
        assert!(
            !saved.iter().any(|f| *f == private || *f == canonical),
            "{saved:?}"
        );
        let restarted = WorkspaceAccess::load(Some(&data));
        assert!(restarted.approve(&private, never_in_scope).is_err());
        restarted.approve(&other, never_in_scope).unwrap();
    }

    #[test]
    fn forgets_a_folder_that_is_gone_in_every_spelling() {
        let temp = TempDir::new("forget-gone");
        let data = temp.0.join("data");
        let moved = temp.folder("moved");
        let access = WorkspaceAccess::load(Some(&data));
        access
            .approve(&moved, |path| path == Path::new(&moved))
            .unwrap();
        // Moved away, and then removed from Recent as the list spells it.
        std::fs::remove_dir(&moved).unwrap();
        let spelled = if cfg!(windows) {
            format!("{}/", moved.to_uppercase().replace('\\', "/"))
        } else {
            moved.clone()
        };

        access.forget(&spelled);

        assert_eq!(
            read_access_file(&data.join(ACCESS_FILE)).unwrap(),
            Vec::<String>::new()
        );
    }

    /// Two spellings of one folder: a link to it (a junction here, as a
    /// `subst` drive would be) and its own path.
    #[cfg(windows)]
    #[test]
    fn removing_a_link_to_a_folder_from_recent_keeps_the_folder_itself() {
        let temp = TempDir::new("forget-link");
        let data = temp.0.join("data");
        // Its own path as the folder dialog gives it: no `\\?\`, no short names.
        let real = canonical_string(Path::new(&temp.folder("real"))).unwrap();
        let real = real.trim_start_matches(r"\\?\").to_string();
        let link = temp.0.join("link").to_string_lossy().into_owned();
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J", &link, &real])
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
        let access = WorkspaceAccess::load(Some(&data));
        for folder in [&real, &link] {
            access
                .approve(folder, |path| path == Path::new(folder))
                .unwrap();
        }

        access.forget(&link);

        let err = access.approve(&link, never_in_scope).unwrap_err();
        assert!(err.contains("Open Folder"), "{err}");
        let restarted = WorkspaceAccess::load(Some(&data));
        restarted.approve(&real, never_in_scope).unwrap();
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
