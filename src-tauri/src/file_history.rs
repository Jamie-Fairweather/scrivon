//! Local history: a copy of each saved version of a document, kept in the
//! app's own local data folder (`%LOCALAPPDATA%\<identifier>\history`), never
//! next to the document (#227). File → Show File History… lists them, shows
//! a diff and puts one back (components/studio/dialogs/file-history-provider.tsx).
//!
//! It is local, not roaming, data, like the WebView2 profile and the logs,
//! because it can be large. Each document has a folder of its own, named by
//! a hash of its path, holding a small index (`index.json`) and one UTF-8 text
//! file per version. The page decodes the text (Rust has no text decoding), so
//! a UTF-16 or Windows-1252 file is kept as the text it shows.
//!
//! History has fixed limits, so it can't grow for ever: at most
//! `MAX_VERSIONS_PER_FILE` versions of a file, none older than 30 days, no
//! copies of files over 5 MB, and at most 256 MB in all, the oldest versions
//! across every file going first.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::atomic_write::{self, allowed_target};

const HISTORY_FOLDER: &str = "history";
const INDEX_FILE: &str = "index.json";
const VERSION_EXTENSION: &str = "txt";

/// Versions kept of one file; the oldest go first.
const MAX_VERSIONS_PER_FILE: usize = 50;
/// Versions older than this go.
const MAX_AGE_MS: u64 = 30 * 24 * 60 * 60 * 1000;
/// Files bigger than this aren't kept (LARGE_FILE_BYTES in lib/workspace/document-tab.ts).
const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;
/// The whole history folder is kept to this; the oldest versions across all files go first.
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;
/// An autosave replaces the newest version only while that is an autosave first
/// made less than this long ago. Counted from when it was first made, not from
/// its last replace, so a long session still adds a version this often.
const AUTOSAVE_MERGE_MS: u64 = 5 * 60 * 1000;
/// Even with room to spare, the whole folder is looked through this often, so
/// versions past their 30 days go from files that aren't saved any more.
const PRUNE_EVERY_MS: u64 = 10 * 60 * 1000;

/// Why a version was kept.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VersionKind {
    /// A save the user asked for (Ctrl+S, Save All).
    Manual,
    /// Autosave, which can run every 200 ms, so these are merged.
    Autosave,
    /// The file as it was on disk before Scrivon first wrote it this session.
    BeforeFirstWrite,
    /// The file another program changed, before the user chose to overwrite it.
    BeforeOverwrite,
    /// The text in the editor before a version was put back.
    BeforeRestore,
}

/// One kept version, as the index lists it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Version {
    id: String,
    /// When it was first made (milliseconds since 1970).
    created_ms: u64,
    /// When its text was last written: later than `created_ms` once autosaves were merged into it.
    saved_ms: u64,
    /// Its text's size in bytes (UTF-8).
    size: u64,
    kind: VersionKind,
    /// FNV-1a of its text, so a save of the same text is found without reading the file.
    hash: String,
}

/// A version as the page sees it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    id: String,
    created_ms: u64,
    saved_ms: u64,
    size: u64,
    kind: VersionKind,
}

impl From<&Version> for VersionInfo {
    fn from(version: &Version) -> Self {
        Self {
            id: version.id.clone(),
            created_ms: version.created_ms,
            saved_ms: version.saved_ms,
            size: version.size,
            kind: version.kind,
        }
    }
}

/// A file's `index.json`: the path as it was first given, the key its folder is
/// named by, and its versions, oldest first.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    path: String,
    key: String,
    versions: Vec<Version>,
}

/// The limits, so tests can try them with small numbers.
#[derive(Clone, Copy, Debug)]
struct Limits {
    versions_per_file: usize,
    max_age_ms: u64,
    max_file_bytes: usize,
    max_total_bytes: u64,
}

const LIMITS: Limits = Limits {
    versions_per_file: MAX_VERSIONS_PER_FILE,
    max_age_ms: MAX_AGE_MS,
    max_file_bytes: MAX_FILE_BYTES,
    max_total_bytes: MAX_TOTAL_BYTES,
};

/// One change to the history folder at a time, so two saves of one file can't
/// both rewrite its index, and pruning never removes a version being added.
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

fn lock_history() -> MutexGuard<'static, ()> {
    HISTORY_LOCK.lock().unwrap_or_else(PoisonError::into_inner)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Keeps `text` as a version of the document at `path`. True when it was kept;
/// false when it matches the newest version or is over 5 MB. Only for a
/// document in a folder the user opened (S02). The total size is pruned
/// afterwards, off the main thread, without the page waiting for it.
#[tauri::command]
pub async fn record_file_version(
    app: tauri::AppHandle,
    path: String,
    text: String,
    kind: VersionKind,
) -> Result<bool, String> {
    let root = history_root(&app)?;
    let scope = app.fs_scope();
    let size = text.len() as u64;
    let prune_root = root.clone();
    let kept = tauri::async_runtime::spawn_blocking(move || {
        check_allowed(&path, |target| scope.is_allowed(target))?;
        record_in(&root, &path, &text, kind, now_ms(), LIMITS).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())??;
    if kept {
        prune_later(prune_root, size);
    }
    Ok(kept)
}

/// The versions kept of the document at `path`, newest first.
#[tauri::command]
pub async fn list_file_versions(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<VersionInfo>, String> {
    let root = history_root(&app)?;
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        check_allowed(&path, |target| scope.is_allowed(target))?;
        Ok(list_in(&root, &path, now_ms(), LIMITS))
    })
    .await
    .map_err(|err| err.to_string())?
}

/// The text of one kept version of the document at `path`.
#[tauri::command]
pub async fn read_file_version(
    app: tauri::AppHandle,
    path: String,
    id: String,
) -> Result<String, String> {
    let root = history_root(&app)?;
    let scope = app.fs_scope();
    tauri::async_runtime::spawn_blocking(move || {
        check_allowed(&path, |target| scope.is_allowed(target))?;
        read_in(&root, &path, &id)
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Deletes every kept version of every file (Settings → General).
#[tauri::command]
pub async fn delete_file_history(app: tauri::AppHandle) -> Result<(), String> {
    let root = history_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        delete_all_in(&root).map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

/// `<local app data>\history`.
fn history_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|err| err.to_string())?;
    Ok(dir.join(HISTORY_FOLDER))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

/// Refuses a document outside the folders the user opened, checked where it
/// really is, as a save is, so a script in the window can't read or plant
/// history for files elsewhere (S02).
fn check_allowed(path: &str, is_allowed: impl Fn(&Path) -> bool) -> Result<(), String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err(format!(
            "Scrivon can only keep the history of files in a folder you opened: {}",
            path.display()
        ));
    }
    allowed_target(path, is_allowed).map(|_| ())
}

// ---------------------------------------------------------------------------
// Where a file's history is
// ---------------------------------------------------------------------------

/// True for a Windows path: a drive letter (`C:\…`, `c:/…`) or a share or
/// extended path (`\\server\share`, `\\?\C:\…`), whichever slashes it uses.
fn is_windows_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    let drive = bytes.len() >= 2
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes.len() == 2 || bytes[2] == b'\\' || bytes[2] == b'/');
    drive || path.starts_with("\\\\") || path.starts_with("//")
}

/// One spelling of a file's path, so one file has one history whichever way
/// its path is written. On Windows, `/` and `\` are the same, the `\\?\`
/// prefix is left out, and letter case doesn't count: `C:\Docs\A.md`,
/// `c:/docs/a.md` and `\\?\C:\Docs\a.md` are one file (the bug class of D05).
fn history_key(path: &str) -> String {
    if !is_windows_path(path) {
        let mut key = String::with_capacity(path.len());
        for part in path.split('/').filter(|part| !part.is_empty()) {
            key.push('/');
            key.push_str(part);
        }
        return if key.is_empty() { "/".into() } else { key };
    }
    let slashed = path.replace('/', "\\");
    let (share, rest) = if let Some(rest) = slashed.strip_prefix("\\\\?\\UNC\\") {
        (true, rest)
    } else if let Some(rest) = slashed.strip_prefix("\\\\?\\") {
        (false, rest)
    } else if let Some(rest) = slashed.strip_prefix("\\\\") {
        (true, rest)
    } else {
        (false, slashed.as_str())
    };
    let parts: Vec<&str> = rest.split('\\').filter(|part| !part.is_empty()).collect();
    let mut key = String::with_capacity(path.len());
    if share {
        key.push_str("\\\\");
    }
    key.push_str(&parts.join("\\"));
    // A drive on its own keeps its separator, as `C:\` does.
    if parts.len() == 1 && !share {
        key.push('\\');
    }
    key.to_lowercase()
}

/// FNV-1a, 64 bits. Written out, not `DefaultHasher`, whose results may change
/// between Rust versions and would then lose every file's history.
fn fnv1a(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    bytes.iter().fold(OFFSET, |hash, &byte| {
        (hash ^ u64::from(byte)).wrapping_mul(PRIME)
    })
}

fn hash_text(text: &str) -> String {
    format!("{:016x}", fnv1a(text.as_bytes()))
}

/// How many other folder names are tried when two paths' hashes are the same.
const MAX_FOLDER_PROBES: u32 = 8;

/// The folder that holds the history for `key`: the one named by its hash,
/// unless that holds another path's history (two keys with the same hash),
/// when the next name is tried.
fn folder_for(history: &Path, key: &str) -> PathBuf {
    let mut first_free = None;
    for probe in 0..MAX_FOLDER_PROBES {
        let seed = if probe == 0 {
            key.to_string()
        } else {
            format!("{key}\u{0}{probe}")
        };
        let folder = history.join(format!("{:016x}", fnv1a(seed.as_bytes())));
        match read_index(&folder) {
            Some(index) if index.key == key => return folder,
            Some(_) => {}
            None => {
                first_free.get_or_insert(folder);
            }
        }
    }
    first_free.unwrap_or_else(|| history.join(format!("{:016x}", fnv1a(key.as_bytes()))))
}

/// A version id: 32 lower-case hex digits, so it can never be a path.
fn is_version_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn new_version_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn version_file(folder: &Path, id: &str) -> PathBuf {
    folder.join(format!("{id}.{VERSION_EXTENSION}"))
}

fn read_index(folder: &Path) -> Option<Index> {
    let text = fs::read_to_string(folder.join(INDEX_FILE)).ok()?;
    let index: Index = serde_json::from_str(&text).ok()?;
    // An index naming a version file that could be a path is someone else's.
    index
        .versions
        .iter()
        .all(|version| is_version_id(&version.id))
        .then_some(index)
}

fn write_index(folder: &Path, index: &Index) -> io::Result<()> {
    let text = serde_json::to_string(index).map_err(io::Error::other)?;
    atomic_write::save(&folder.join(INDEX_FILE), text.as_bytes())
}

fn remove_version_file(folder: &Path, id: &str) {
    let _ = fs::remove_file(version_file(folder, id));
}

fn is_expired(version: &Version, now: u64, limits: Limits) -> bool {
    version.saved_ms.saturating_add(limits.max_age_ms) < now
}

/// Drops versions past their age and beyond the per-file count. True when any went.
fn apply_file_limits(folder: &Path, index: &mut Index, now: u64, limits: Limits) -> bool {
    let before = index.versions.len();
    index.versions.retain(|version| {
        let keep = !is_expired(version, now, limits);
        if !keep {
            remove_version_file(folder, &version.id);
        }
        keep
    });
    let extra = index
        .versions
        .len()
        .saturating_sub(limits.versions_per_file);
    for version in index.versions.drain(..extra) {
        remove_version_file(folder, &version.id);
    }
    index.versions.len() != before
}

// ---------------------------------------------------------------------------
// Recording, listing and reading
// ---------------------------------------------------------------------------

/// Keeps `text` as the newest version of `path`, under `history` (the history
/// folder). See `record_file_version`.
fn record_in(
    history: &Path,
    path: &str,
    text: &str,
    kind: VersionKind,
    now: u64,
    limits: Limits,
) -> io::Result<bool> {
    if text.len() > limits.max_file_bytes {
        return Ok(false);
    }
    let _lock = lock_history();
    let key = history_key(path);
    let folder = folder_for(history, &key);
    fs::create_dir_all(&folder)?;
    let mut index = read_index(&folder)
        .filter(|index| index.key == key)
        .unwrap_or_else(|| Index {
            path: path.to_string(),
            key,
            versions: Vec::new(),
        });
    let pruned = apply_file_limits(&folder, &mut index, now, limits);

    let hash = hash_text(text);
    let size = text.len() as u64;
    if let Some(newest) = index.versions.last() {
        // The same text as the newest version adds nothing.
        let same = newest.hash == hash
            && newest.size == size
            && fs::read_to_string(version_file(&folder, &newest.id)).is_ok_and(|kept| kept == text);
        if same {
            if pruned {
                write_index(&folder, &index)?;
            }
            return Ok(false);
        }
    }

    let merge = kind == VersionKind::Autosave
        && index.versions.last().is_some_and(|newest| {
            newest.kind == VersionKind::Autosave
                && now.saturating_sub(newest.created_ms) < AUTOSAVE_MERGE_MS
        });
    if merge {
        let newest = index.versions.last_mut().expect("checked above");
        atomic_write::save(&version_file(&folder, &newest.id), text.as_bytes())?;
        newest.saved_ms = now;
        newest.size = size;
        newest.hash = hash;
    } else {
        let id = new_version_id();
        // The text first, so the index never names a version that isn't there.
        atomic_write::save(&version_file(&folder, &id), text.as_bytes())?;
        index.versions.push(Version {
            id,
            created_ms: now,
            saved_ms: now,
            size,
            kind,
            hash,
        });
        apply_file_limits(&folder, &mut index, now, limits);
    }
    write_index(&folder, &index)?;
    Ok(true)
}

/// The versions of `path`, newest first, leaving out any past their age.
fn list_in(history: &Path, path: &str, now: u64, limits: Limits) -> Vec<VersionInfo> {
    let _lock = lock_history();
    let key = history_key(path);
    let Some(index) = read_index(&folder_for(history, &key)).filter(|index| index.key == key)
    else {
        return Vec::new();
    };
    index
        .versions
        .iter()
        .rev()
        .filter(|version| !is_expired(version, now, limits))
        .map(VersionInfo::from)
        .collect()
}

/// The text of the version `id` of `path`. Only an id in the expected form,
/// and one the file's index lists, is read.
fn read_in(history: &Path, path: &str, id: &str) -> Result<String, String> {
    if !is_version_id(id) {
        return Err("That isn't a version Scrivon kept.".into());
    }
    let _lock = lock_history();
    let key = history_key(path);
    let folder = folder_for(history, &key);
    let listed = read_index(&folder)
        .filter(|index| index.key == key)
        .is_some_and(|index| index.versions.iter().any(|version| version.id == id));
    if !listed {
        return Err("That version isn't kept any more.".into());
    }
    fs::read_to_string(version_file(&folder, id)).map_err(|err| err.to_string())
}

/// Removes the whole history folder.
fn delete_all_in(history: &Path) -> io::Result<()> {
    let _lock = lock_history();
    match fs::remove_dir_all(history) {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

/// Looks through every file's history: drops versions past their age or
/// beyond the per-file count, folders with no usable index and files their
/// index doesn't list, and then the oldest versions across all files until the
/// folder holds at most `limits.max_total_bytes`. Returns the size left.
fn prune_in(history: &Path, now: u64, limits: Limits) -> io::Result<u64> {
    let _lock = lock_history();
    let entries = match fs::read_dir(history) {
        Ok(entries) => entries,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(0),
        Err(err) => return Err(err),
    };
    let mut files: Vec<(PathBuf, Index, bool)> = Vec::new();
    for entry in entries.flatten() {
        let folder = entry.path();
        if !entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let Some(mut index) = read_index(&folder) else {
            // Nothing can reach its versions any more.
            let _ = fs::remove_dir_all(&folder);
            continue;
        };
        let changed = apply_file_limits(&folder, &mut index, now, limits);
        remove_unlisted_files(&folder, &index);
        files.push((folder, index, changed));
    }

    let mut total: u64 = files.iter().map(|(_, index, _)| folder_bytes(index)).sum();
    if total > limits.max_total_bytes {
        let mut oldest: Vec<(u64, usize, String)> = files
            .iter()
            .enumerate()
            .flat_map(|(file, (_, index, _))| {
                index
                    .versions
                    .iter()
                    .map(move |version| (version.saved_ms, file, version.id.clone()))
            })
            .collect();
        oldest.sort();
        for (_, file, id) in oldest {
            if total <= limits.max_total_bytes {
                break;
            }
            let (folder, index, changed) = &mut files[file];
            let before = folder_bytes(index);
            remove_version_file(folder, &id);
            index.versions.retain(|version| version.id != id);
            *changed = true;
            total = total - before + folder_bytes(index);
        }
    }

    for (folder, index, changed) in &files {
        if index.versions.is_empty() {
            let _ = fs::remove_dir_all(folder);
        } else if *changed {
            write_index(folder, index)?;
        }
    }
    Ok(total)
}

/// The bytes a file's folder holds: its versions and its index. A folder with
/// no versions left is removed, so it holds nothing.
fn folder_bytes(index: &Index) -> u64 {
    if index.versions.is_empty() {
        return 0;
    }
    let index_size = serde_json::to_string(index).map_or(0, |text| text.len() as u64);
    index_size
        + index
            .versions
            .iter()
            .map(|version| version.size)
            .sum::<u64>()
}

/// Removes what a crash or an older version left in a file's folder: version
/// files its index doesn't list, and half-written temporary files.
fn remove_unlisted_files(folder: &Path, index: &Index) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == INDEX_FILE {
            continue;
        }
        let listed = name
            .strip_suffix(&format!(".{VERSION_EXTENSION}"))
            .is_some_and(|id| index.versions.iter().any(|version| version.id == id));
        if !listed {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// What is known about the history folder's size since it was last pruned.
#[derive(Debug, Default)]
struct PruneState {
    running: bool,
    /// A prune was asked for while one ran, so another follows it.
    again: bool,
    /// The size the last prune left, and when it ran.
    last: Option<(u64, u64)>,
    /// Bytes recorded since.
    added: u64,
}

impl PruneState {
    /// Whether the folder may be over its size, or wasn't looked through for a while.
    fn is_due(&self, now: u64, limits: Limits) -> bool {
        match self.last {
            Some((total, ran)) => {
                total.saturating_add(self.added) > limits.max_total_bytes
                    || now.saturating_sub(ran) >= PRUNE_EVERY_MS
            }
            None => true,
        }
    }
}

static PRUNE_STATE: Mutex<PruneState> = Mutex::new(PruneState {
    running: false,
    again: false,
    last: None,
    added: 0,
});

fn prune_state() -> MutexGuard<'static, PruneState> {
    PRUNE_STATE.lock().unwrap_or_else(PoisonError::into_inner)
}

/// After a version of `added` bytes was kept: prunes the history folder on a
/// blocking thread when it may be over its size (or every `PRUNE_EVERY_MS`),
/// never on the main thread, and never two at once.
fn prune_later(history: PathBuf, added: u64) {
    {
        let mut state = prune_state();
        state.added = state.added.saturating_add(added);
        if !state.is_due(now_ms(), LIMITS) {
            return;
        }
        if state.running {
            state.again = true;
            return;
        }
        state.running = true;
    }
    tauri::async_runtime::spawn_blocking(move || loop {
        let result = prune_in(&history, now_ms(), LIMITS);
        let mut state = prune_state();
        match result {
            Ok(total) => {
                state.last = Some((total, now_ms()));
                state.added = 0;
            }
            Err(err) => log::warn!("Couldn't prune the file history: {err}"),
        }
        if !state.again {
            state.running = false;
            break;
        }
        state.again = false;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("scrivon-file-history-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn history(&self) -> PathBuf {
            self.0.join(HISTORY_FOLDER)
        }

        /// The folders in the history folder.
        fn folders(&self) -> Vec<PathBuf> {
            match fs::read_dir(self.history()) {
                Ok(entries) => entries.map(|entry| entry.unwrap().path()).collect(),
                Err(_) => Vec::new(),
            }
        }

        /// Every byte under the history folder.
        fn bytes(&self) -> u64 {
            fn walk(path: &Path) -> u64 {
                fs::read_dir(path).map_or(0, |entries| {
                    entries
                        .map(|entry| {
                            let entry = entry.unwrap();
                            let meta = entry.metadata().unwrap();
                            if meta.is_dir() {
                                walk(&entry.path())
                            } else {
                                meta.len()
                            }
                        })
                        .sum()
                })
            }
            walk(&self.history())
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    const MINUTE: u64 = 60 * 1000;
    const DAY: u64 = 24 * 60 * MINUTE;
    /// Some time in November 2026.
    const NOW: u64 = 1_795_000_000_000;
    const DOC: &str = "C:\\Docs\\A.md";

    fn record(dir: &TempDir, text: &str, kind: VersionKind, now: u64) -> bool {
        record_in(&dir.history(), DOC, text, kind, now, LIMITS).unwrap()
    }

    fn listed(dir: &TempDir, now: u64) -> Vec<VersionInfo> {
        list_in(&dir.history(), DOC, now, LIMITS)
    }

    fn kinds(dir: &TempDir, now: u64) -> Vec<VersionKind> {
        listed(dir, now).iter().map(|v| v.kind).collect()
    }

    fn texts(dir: &TempDir, now: u64) -> Vec<String> {
        listed(dir, now)
            .iter()
            .map(|v| read_in(&dir.history(), DOC, &v.id).unwrap())
            .collect()
    }

    #[test]
    fn keeps_each_version_newest_first_with_its_time_size_and_kind() {
        let dir = TempDir::new();

        assert!(record(&dir, "first", VersionKind::Manual, NOW));
        assert!(record(
            &dir,
            "second, longer",
            VersionKind::Manual,
            NOW + MINUTE
        ));

        let versions = listed(&dir, NOW + MINUTE);
        assert_eq!(versions.len(), 2);
        assert_eq!(versions[0].created_ms, NOW + MINUTE);
        assert_eq!(versions[0].saved_ms, NOW + MINUTE);
        assert_eq!(versions[0].size, 14);
        assert_eq!(versions[0].kind, VersionKind::Manual);
        assert_eq!(versions[1].created_ms, NOW);
        assert_eq!(texts(&dir, NOW + MINUTE), ["second, longer", "first"]);
    }

    #[test]
    fn keeps_text_in_any_script_as_utf8() {
        let dir = TempDir::new();
        // What a UTF-16 or Windows-1252 file decodes to in the page.
        let text = "Grüße, “quoted” – 日本語 🙂\r\n";

        record(&dir, text, VersionKind::BeforeFirstWrite, NOW);

        let version = &listed(&dir, NOW)[0];
        assert_eq!(version.size, text.len() as u64);
        let file = version_file(&folder_for(&dir.history(), &history_key(DOC)), &version.id);
        assert_eq!(fs::read(file).unwrap(), text.as_bytes());
        assert_eq!(texts(&dir, NOW), [text]);
    }

    #[test]
    fn text_matching_the_newest_version_adds_nothing() {
        let dir = TempDir::new();
        record(&dir, "same", VersionKind::Manual, NOW);

        for kind in [
            VersionKind::Manual,
            VersionKind::Autosave,
            VersionKind::BeforeFirstWrite,
            VersionKind::BeforeOverwrite,
            VersionKind::BeforeRestore,
        ] {
            assert!(!record(&dir, "same", kind, NOW + MINUTE), "{kind:?}");
        }

        assert_eq!(kinds(&dir, NOW + MINUTE), [VersionKind::Manual]);
        // An older version with the same text isn't the newest, so it counts.
        record(&dir, "other", VersionKind::Manual, NOW + 2 * MINUTE);
        assert!(record(&dir, "same", VersionKind::Manual, NOW + 3 * MINUTE));
        assert_eq!(texts(&dir, NOW + 3 * MINUTE), ["same", "other", "same"]);
    }

    #[test]
    fn an_autosave_replaces_an_autosave_made_less_than_five_minutes_before() {
        let dir = TempDir::new();
        record(&dir, "a", VersionKind::Autosave, NOW);
        record(&dir, "ab", VersionKind::Autosave, NOW + MINUTE);
        record(&dir, "abc", VersionKind::Autosave, NOW + 4 * MINUTE);

        let versions = listed(&dir, NOW + 4 * MINUTE);
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].created_ms, NOW);
        assert_eq!(versions[0].saved_ms, NOW + 4 * MINUTE);
        assert_eq!(versions[0].size, 3);
        assert_eq!(texts(&dir, NOW + 4 * MINUTE), ["abc"]);

        // Five minutes after it was first made, not after its last replace.
        record(&dir, "abcd", VersionKind::Autosave, NOW + 5 * MINUTE);
        assert_eq!(texts(&dir, NOW + 5 * MINUTE), ["abcd", "abc"]);
    }

    #[test]
    fn ten_minutes_of_autosaves_every_second_keep_a_version_at_least_every_five_minutes() {
        let dir = TempDir::new();
        for second in 0..600u64 {
            record(
                &dir,
                &format!("text {second}"),
                VersionKind::Autosave,
                NOW + second * 1000,
            );
        }

        let versions = listed(&dir, NOW + 600 * 1000);
        assert!(versions.len() >= 2, "{} versions", versions.len());
        assert_eq!(texts(&dir, NOW + 600 * 1000)[0], "text 599");
    }

    #[test]
    fn versions_of_any_other_kind_are_never_merged() {
        // A disk version then an autosave, a Ctrl+S then an autosave a minute
        // later, and a restore then an autosave all keep both.
        for first in [
            VersionKind::BeforeFirstWrite,
            VersionKind::Manual,
            VersionKind::BeforeRestore,
            VersionKind::BeforeOverwrite,
        ] {
            let dir = TempDir::new();
            record(&dir, "one", first, NOW);
            record(&dir, "two", VersionKind::Autosave, NOW + MINUTE);
            assert_eq!(
                kinds(&dir, NOW + MINUTE),
                [VersionKind::Autosave, first],
                "{first:?}"
            );
        }

        // A save the user asks for always adds a version, even right after an autosave.
        let dir = TempDir::new();
        record(&dir, "one", VersionKind::Autosave, NOW);
        record(&dir, "two", VersionKind::Manual, NOW + 1000);
        record(&dir, "three", VersionKind::Manual, NOW + 2000);
        assert_eq!(
            kinds(&dir, NOW + 2000),
            [
                VersionKind::Manual,
                VersionKind::Manual,
                VersionKind::Autosave
            ]
        );
    }

    #[test]
    fn keeps_at_most_fifty_versions_of_a_file_dropping_the_oldest() {
        let dir = TempDir::new();
        for n in 0..(MAX_VERSIONS_PER_FILE as u64 + 5) {
            record(&dir, &format!("v{n}"), VersionKind::Manual, NOW + n);
        }

        let versions = texts(&dir, NOW + 100);
        assert_eq!(versions.len(), MAX_VERSIONS_PER_FILE);
        assert_eq!(versions[0], "v54");
        assert_eq!(versions[MAX_VERSIONS_PER_FILE - 1], "v5");
        // The files of the dropped versions went too.
        let folder = folder_for(&dir.history(), &history_key(DOC));
        assert_eq!(
            fs::read_dir(folder).unwrap().count(),
            MAX_VERSIONS_PER_FILE + 1
        );
    }

    #[test]
    fn keeps_nothing_older_than_thirty_days() {
        let dir = TempDir::new();
        record(&dir, "old", VersionKind::Manual, NOW);
        record(&dir, "newer", VersionKind::Manual, NOW + 20 * DAY);

        // Not listed once past its age, and gone with the next save.
        assert_eq!(texts(&dir, NOW + 31 * DAY), ["newer"]);
        record(&dir, "newest", VersionKind::Manual, NOW + 31 * DAY);
        let folder = folder_for(&dir.history(), &history_key(DOC));
        assert_eq!(read_index(&folder).unwrap().versions.len(), 2);

        // Pruning drops it from a file that isn't saved any more.
        let other = "C:\\Docs\\Other.md";
        record_in(&dir.history(), other, "x", VersionKind::Manual, NOW, LIMITS).unwrap();
        prune_in(&dir.history(), NOW + 31 * DAY, LIMITS).unwrap();
        assert!(list_in(&dir.history(), other, NOW, LIMITS).is_empty());
        assert_eq!(dir.folders().len(), 1);
    }

    #[test]
    fn keeps_no_copy_of_a_file_over_five_mb() {
        let dir = TempDir::new();
        let big = "x".repeat(MAX_FILE_BYTES + 1);

        assert!(!record(&dir, &big, VersionKind::Manual, NOW));
        assert!(record(&dir, &big[1..], VersionKind::Manual, NOW));

        assert_eq!(listed(&dir, NOW).len(), 1);
    }

    #[test]
    fn pruning_keeps_the_folder_to_its_size_dropping_the_oldest_versions_of_any_file() {
        let dir = TempDir::new();
        let limits = Limits {
            max_total_bytes: 10_000,
            ..LIMITS
        };
        let text = |n: u64| format!("{n:04}{}", "x".repeat(996));
        // Three files, saved in turn: a.md's first version is the oldest of all.
        for n in 0..15u64 {
            let path = format!("C:\\Docs\\{}.md", ["a", "b", "c"][(n % 3) as usize]);
            record_in(
                &dir.history(),
                &path,
                &text(n),
                VersionKind::Manual,
                NOW + n,
                limits,
            )
            .unwrap();
        }
        assert!(dir.bytes() > limits.max_total_bytes);

        let total = prune_in(&dir.history(), NOW + 20, limits).unwrap();

        assert!(total <= limits.max_total_bytes, "{total}");
        assert_eq!(dir.bytes(), total);
        let kept: Vec<String> = ["a", "b", "c"]
            .iter()
            .flat_map(|name| {
                let path = format!("C:\\Docs\\{name}.md");
                list_in(&dir.history(), &path, NOW, limits)
                    .iter()
                    .map(|v| read_in(&dir.history(), &path, &v.id).unwrap()[..4].to_string())
                    .collect::<Vec<_>>()
            })
            .collect();
        let mut kept: Vec<u64> = kept.iter().map(|n| n.parse().unwrap()).collect();
        kept.sort_unstable();
        // The newest ones, whichever file they belong to.
        let oldest_kept = kept[0];
        assert_eq!(kept, (oldest_kept..15).collect::<Vec<_>>());
        assert!(oldest_kept > 0);
    }

    #[test]
    fn pruning_removes_a_file_whose_versions_all_went_and_leftovers() {
        let dir = TempDir::new();
        let limits = Limits {
            max_total_bytes: 1_500,
            ..LIMITS
        };
        record_in(
            &dir.history(),
            "C:\\a.md",
            &"a".repeat(1000),
            VersionKind::Manual,
            NOW,
            limits,
        )
        .unwrap();
        record_in(
            &dir.history(),
            "C:\\b.md",
            &"b".repeat(1000),
            VersionKind::Manual,
            NOW + 1,
            limits,
        )
        .unwrap();
        // A crash left a version file no index lists, and a folder with no index.
        let b = folder_for(&dir.history(), &history_key("C:\\b.md"));
        fs::write(b.join(format!("{}.txt", "0".repeat(32))), "orphan").unwrap();
        fs::create_dir_all(dir.history().join("0123456789abcdef")).unwrap();

        prune_in(&dir.history(), NOW + 2, limits).unwrap();

        assert_eq!(dir.folders(), std::slice::from_ref(&b));
        assert_eq!(fs::read_dir(&b).unwrap().count(), 2);
    }

    #[test]
    fn prunes_when_the_folder_may_be_too_big_or_has_not_been_looked_through_lately() {
        let limits = LIMITS;
        let mut state = PruneState::default();
        assert!(state.is_due(NOW, limits));

        state.last = Some((MAX_TOTAL_BYTES - 100, NOW));
        state.added = 50;
        assert!(!state.is_due(NOW + MINUTE, limits));
        state.added = 101;
        assert!(state.is_due(NOW + MINUTE, limits));

        state.added = 0;
        assert!(state.is_due(NOW + PRUNE_EVERY_MS, limits));
    }

    #[test]
    fn one_file_has_one_history_however_its_path_is_written() {
        let key = history_key("C:\\Docs\\A.md");
        for same in [
            "c:/docs/a.md",
            "\\\\?\\C:\\Docs\\a.md",
            "C:\\\\Docs\\A.md\\",
            "//?/c:/DOCS/A.MD",
        ] {
            assert_eq!(history_key(same), key, "{same}");
        }
        assert_eq!(
            history_key("\\\\?\\UNC\\Server\\Share\\a.md"),
            history_key("\\\\server\\share\\A.md")
        );
        assert_ne!(history_key("C:\\Docs\\B.md"), key);
        assert_ne!(history_key("\\\\docs\\a.md"), history_key("C:\\docs\\a.md"));
        // Other systems' paths keep their case.
        assert_ne!(history_key("/home/me/A.md"), history_key("/home/me/a.md"));
        assert_eq!(history_key("/home//me/a.md"), "/home/me/a.md");

        let dir = TempDir::new();
        let history = dir.history();
        record_in(
            &history,
            "C:\\Docs\\A.md",
            "one",
            VersionKind::Manual,
            NOW,
            LIMITS,
        )
        .unwrap();
        record_in(
            &history,
            "c:/docs/a.md",
            "two",
            VersionKind::Manual,
            NOW + 1,
            LIMITS,
        )
        .unwrap();
        record_in(
            &history,
            "\\\\?\\C:\\Docs\\a.md",
            "three",
            VersionKind::Manual,
            NOW + 2,
            LIMITS,
        )
        .unwrap();

        assert_eq!(dir.folders().len(), 1);
        assert_eq!(list_in(&history, "C:/DOCS/A.MD", NOW, LIMITS).len(), 3);
        // The index keeps the path as it was first given.
        assert_eq!(
            read_index(&dir.folders()[0]).unwrap().path,
            "C:\\Docs\\A.md"
        );
    }

    #[test]
    fn the_folder_name_is_a_stable_hash_of_the_path() {
        // FNV-1a's published test values, so the names never change with Rust.
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(fnv1a(b"foobar"), 0x8594_4171_f739_67e8);

        let dir = TempDir::new();
        record(&dir, "x", VersionKind::Manual, NOW);
        let expected = format!("{:016x}", fnv1a(history_key(DOC).as_bytes()));
        assert_eq!(dir.folders(), [dir.history().join(expected)]);
    }

    #[test]
    fn two_paths_with_the_same_hash_get_folders_of_their_own() {
        let dir = TempDir::new();
        let history = dir.history();
        record_in(&history, "C:\\a.md", "a", VersionKind::Manual, NOW, LIMITS).unwrap();
        // Another path's index in b.md's folder, as a hash collision would leave it.
        let taken = history.join(format!(
            "{:016x}",
            fnv1a(history_key("C:\\b.md").as_bytes())
        ));
        fs::create_dir_all(&taken).unwrap();
        let other = Index {
            path: "C:\\other.md".into(),
            key: "c:\\other.md".into(),
            versions: Vec::new(),
        };
        write_index(&taken, &other).unwrap();

        record_in(&history, "C:\\b.md", "b", VersionKind::Manual, NOW, LIMITS).unwrap();

        assert_eq!(read_index(&taken).unwrap(), other);
        assert_eq!(list_in(&history, "C:\\b.md", NOW, LIMITS).len(), 1);
        assert_eq!(list_in(&history, "C:\\a.md", NOW, LIMITS).len(), 1);
    }

    #[test]
    fn refuses_files_outside_the_opened_folders() {
        let dir = TempDir::new();
        let opened = dir.0.join("opened");
        fs::create_dir(&opened).unwrap();
        let real = fs::canonicalize(&opened).unwrap();
        let inside = |path: &Path| path.starts_with(&opened) || path.starts_with(&real);

        let doc = opened.join("notes.md");
        assert!(check_allowed(doc.to_str().unwrap(), inside).is_ok());

        let outside = dir.0.join("outside.md");
        let refused = check_allowed(outside.to_str().unwrap(), inside).unwrap_err();
        assert!(refused.contains("folder you opened"), "{refused}");
        // Climbing out with `..` while still starting with the opened folder.
        let escaping = opened.join("..").join("outside.md");
        assert!(check_allowed(escaping.to_str().unwrap(), inside).is_err());
        // A relative path isn't anywhere in particular.
        assert!(check_allowed("notes.md", |_| true).is_err());
    }

    #[test]
    fn only_reads_a_listed_version_with_an_id_of_the_expected_form() {
        let dir = TempDir::new();
        record(&dir, "kept", VersionKind::Manual, NOW);
        let id = listed(&dir, NOW)[0].id.clone();
        assert!(is_version_id(&id));

        for bad in [
            "",
            "..\\..\\secrets",
            "../index",
            "index",
            &id.to_uppercase(),
            &format!("{id}0"),
            &id[1..],
            "0123456789abcdef0123456789abcdeg",
        ] {
            assert!(!is_version_id(bad), "{bad}");
            assert!(read_in(&dir.history(), DOC, bad).is_err(), "{bad}");
        }
        // The right form, but not a version of this file.
        assert!(read_in(&dir.history(), DOC, &"a".repeat(32)).is_err());
        assert!(read_in(&dir.history(), "C:\\Docs\\Other.md", &id).is_err());
        assert_eq!(read_in(&dir.history(), DOC, &id).unwrap(), "kept");
    }

    #[test]
    fn an_index_naming_a_path_as_a_version_is_ignored() {
        let dir = TempDir::new();
        record(&dir, "kept", VersionKind::Manual, NOW);
        let folder = folder_for(&dir.history(), &history_key(DOC));
        let mut index = read_index(&folder).unwrap();
        index.versions[0].id = "..\\..\\secrets".into();
        fs::write(
            folder.join(INDEX_FILE),
            serde_json::to_string(&index).unwrap(),
        )
        .unwrap();

        assert!(listed(&dir, NOW).is_empty());
    }

    #[test]
    fn deleting_all_history_removes_the_folder() {
        let dir = TempDir::new();
        record(&dir, "one", VersionKind::Manual, NOW);
        record_in(
            &dir.history(),
            "C:\\b.md",
            "b",
            VersionKind::Manual,
            NOW,
            LIMITS,
        )
        .unwrap();

        delete_all_in(&dir.history()).unwrap();

        assert!(!dir.history().exists());
        assert!(listed(&dir, NOW).is_empty());
        // Nothing to delete is fine too.
        delete_all_in(&dir.history()).unwrap();
    }

    #[test]
    fn the_kinds_have_the_names_the_page_uses() {
        let names: Vec<String> = [
            VersionKind::Manual,
            VersionKind::Autosave,
            VersionKind::BeforeFirstWrite,
            VersionKind::BeforeOverwrite,
            VersionKind::BeforeRestore,
        ]
        .iter()
        .map(|kind| serde_json::to_string(kind).unwrap())
        .collect();
        assert_eq!(
            names,
            [
                "\"manual\"",
                "\"autosave\"",
                "\"before-first-write\"",
                "\"before-overwrite\"",
                "\"before-restore\""
            ]
        );
        let page = include_str!("../../lib/tauri/file-history.ts");
        for name in &names {
            assert!(page.contains(&name.replace('"', "'")), "{name}");
        }
        // The size limit matches the page's.
        let tab = include_str!("../../lib/workspace/document-tab.ts");
        assert!(tab.contains("LARGE_FILE_BYTES = 5 * 1024 * 1024"));
    }
}
