//! Saving a document so that a crash or power cut can't leave it empty or half
//! written (D18). The bytes go to a temporary file next to it, are flushed to
//! the disk, and only then take the file's place in one step. On Windows that
//! step is ReplaceFileW, which keeps what makes the file that file: its
//! permissions (ACLs), attributes, creation time and alternate data streams.
//! A plain rename would give it a new identity and drop all of those.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use tauri::ipc::{InvokeBody, Request};
use tauri_plugin_fs::FsExt;

/// Saves a document. The body is raw bytes, so a file of several MB isn't
/// sent as a JSON array of numbers: the path's length (4 bytes, little
/// endian), the path in UTF-8, then the file's bytes (see `parse_body`).
/// Only files inside a folder the user opened can be saved.
///
/// Errors keep the system's "(os error N)" ending, so the page can tell a file
/// it may change but not replace (access denied, or open in another program)
/// and write that one in place instead (lib/tauri/fs.ts).
#[tauri::command]
pub async fn save_workspace_file(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<(), String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("The file to save was sent in the wrong form.".into());
    };
    let (path, bytes) = parse_body(body)?;
    let bytes = bytes.to_vec();
    let scope = app.fs_scope();
    // Finding where the file really goes reads the disk too (slow on a network drive).
    tauri::async_runtime::spawn_blocking(move || {
        save_allowed(&path, &bytes, |target| scope.is_allowed(target))
    })
    .await
    .map_err(|err| err.to_string())?
}

/// Saves `bytes` to `path` when `is_allowed` (the file scope) lets the window
/// write where that really is.
fn save_allowed(
    path: &Path,
    bytes: &[u8],
    is_allowed: impl Fn(&Path) -> bool,
) -> Result<(), String> {
    let target = allowed_target(path, is_allowed)?;
    save(&target, bytes).map_err(|err| err.to_string())
}

/// Where `path` really is, if that is in a folder the user opened. The scope
/// matches a file that isn't there yet by its path as written, so a `..` in it
/// could point the file anywhere on disk (the file plugin's own commands refuse
/// `..` for the same reason). Its folder is looked up on disk instead, which
/// also follows any link among its folders, and the file is saved there.
fn allowed_target(path: &Path, is_allowed: impl Fn(&Path) -> bool) -> Result<PathBuf, String> {
    let refused = || {
        format!(
            "Scrivon can only save files in a folder you opened: {}",
            path.display()
        )
    };
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(refused());
    }
    let (Some(folder), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(refused());
    };
    let target = match fs::canonicalize(folder) {
        Ok(folder) => folder.join(name),
        // The folder is gone (deleted, or on a drive that was unplugged). Only
        // said for a folder the window may use, so it can't probe the disk.
        Err(err) if is_allowed(path) => return Err(err.to_string()),
        Err(_) => return Err(refused()),
    };
    if !is_allowed(&target) {
        return Err(refused());
    }
    Ok(target)
}

fn parse_body(body: &[u8]) -> Result<(PathBuf, &[u8]), String> {
    let malformed = || "The file to save was sent in the wrong form.".to_string();
    let len_bytes: [u8; 4] = body
        .get(..4)
        .ok_or_else(malformed)?
        .try_into()
        .map_err(|_| malformed())?;
    let end = usize::try_from(u32::from_le_bytes(len_bytes))
        .ok()
        .and_then(|len| len.checked_add(4))
        .ok_or_else(malformed)?;
    let path = body.get(4..end).ok_or_else(malformed)?;
    let path = PathBuf::from(std::str::from_utf8(path).map_err(|_| malformed())?);
    if !path.is_absolute() || path.file_name().is_none() {
        return Err(malformed());
    }
    Ok((path, &body[end..]))
}

/// Antivirus, sync and search tools can hold a just-written file for a moment,
/// so swapping it in is tried a few times, as lib/tauri/fs.ts used to.
const REPLACE_ATTEMPTS: u32 = 5;
const REPLACE_RETRY: Duration = Duration::from_millis(50);

/// Writes `bytes` to `path`, replacing the file in one step, or creating it.
fn save(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let Ok(target) = fs::symlink_metadata(path) else {
        return write_new(path, bytes);
    };
    // A link is written through, not replaced: replacing would cut it off from
    // the file it points to (a symlink), or from the file's other names (a hard link).
    if target.file_type().is_symlink() || link_count(path) > 1 {
        return write_in_place(path, bytes);
    }
    let temp = write_temp(path, bytes)?;
    #[cfg(unix)]
    {
        // A private (600) note or a script (755) stays that way.
        if let Err(err) = fs::set_permissions(&temp, target.permissions()) {
            let _ = fs::remove_file(&temp);
            return Err(err);
        }
    }
    match with_retries(|| replace(path, &temp)) {
        Ok(()) => {
            sync_folder(path);
            Ok(())
        }
        Err(err) => {
            // On Windows a replace that fails part way can leave the old file gone:
            // the new text, in the temporary file, is then the only copy on disk.
            if !path.exists() && temp.exists() {
                return with_retries(|| fs::rename(&temp, path)).map(|()| sync_folder(path));
            }
            let _ = fs::remove_file(&temp);
            Err(err)
        }
    }
}

/// A file that isn't there yet: written next to it first all the same, so it
/// never shows up half written.
fn write_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temp = write_temp(path, bytes)?;
    match with_retries(|| fs::rename(&temp, path)) {
        Ok(()) => {
            sync_folder(path);
            Ok(())
        }
        Err(err) => {
            let _ = fs::remove_file(&temp);
            Err(err)
        }
    }
}

fn write_in_place(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).truncate(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// `.scrivon-save-<id>.tmp` next to `path`, which the file list hides
/// (lib/tauri/fs.ts), holding `bytes` and flushed to the disk. Removed again if
/// writing it fails part way (full disk, drive gone).
fn write_temp(path: &Path, bytes: &[u8]) -> io::Result<PathBuf> {
    let folder = path
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let temp = folder.join(format!(
        ".scrivon-save-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(err) = written {
        let _ = fs::remove_file(&temp);
        return Err(err);
    }
    Ok(temp)
}

/// Runs `step` again while the file is busy for a moment (in use, locked or,
/// as antivirus tools briefly cause, access denied).
fn with_retries(mut step: impl FnMut() -> io::Result<()>) -> io::Result<()> {
    let mut attempt = 1;
    loop {
        match step() {
            Err(err) if attempt < REPLACE_ATTEMPTS && is_busy(&err) => {
                attempt += 1;
                std::thread::sleep(REPLACE_RETRY);
            }
            result => return result,
        }
    }
}

fn is_busy(err: &io::Error) -> bool {
    // Windows: access denied, sharing violation, lock violation.
    cfg!(windows) && matches!(err.raw_os_error(), Some(5 | 32 | 33))
}

/// Puts `temp` in the place of `path`, keeping the file's identity.
#[cfg(windows)]
fn replace(path: &Path, temp: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    // Saving matters more than carrying over every detail: a file whose ACL
    // can't be merged is still saved, as a rename would have saved it.
    const REPLACEFILE_IGNORE_MERGE_ERRORS: u32 = 0x2;
    const REPLACEFILE_IGNORE_ACL_ERRORS: u32 = 0x4;
    const ERROR_FILE_NOT_FOUND: i32 = 2;

    let wide = |p: &Path| -> Vec<u16> { p.as_os_str().encode_wide().chain([0]).collect() };
    let (replaced, replacement) = (wide(path), wide(temp));
    // SAFETY: both are NUL-terminated UTF-16 strings that outlive the call; the
    // backup name and the reserved pointers may be null.
    let ok = unsafe {
        ReplaceFileW(
            replaced.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok != 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    // Deleted since it was checked: there is nothing to keep, so it is simply put there.
    if err.raw_os_error() == Some(ERROR_FILE_NOT_FOUND) && !path.exists() {
        return fs::rename(temp, path);
    }
    Err(err)
}

#[cfg(not(windows))]
fn replace(path: &Path, temp: &Path) -> io::Result<()> {
    fs::rename(temp, path)
}

/// How many names (hard links) the file has; 1 when that can't be read.
#[cfg(windows)]
fn link_count(path: &Path) -> u32 {
    use std::os::windows::io::AsRawHandle;

    // BY_HANDLE_FILE_INFORMATION. Only filled in by Windows, and only the link count is read.
    #[repr(C)]
    #[allow(non_snake_case, dead_code)]
    struct ByHandleFileInformation {
        dwFileAttributes: u32,
        times: [u32; 6],
        dwVolumeSerialNumber: u32,
        nFileSizeHigh: u32,
        nFileSizeLow: u32,
        nNumberOfLinks: u32,
        nFileIndexHigh: u32,
        nFileIndexLow: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            file: *mut std::ffi::c_void,
            info: *mut ByHandleFileInformation,
        ) -> i32;
    }

    let Ok(file) = File::open(path) else { return 1 };
    let mut info = std::mem::MaybeUninit::<ByHandleFileInformation>::zeroed();
    // SAFETY: the handle is open for the whole call and `info` is a writable
    // BY_HANDLE_FILE_INFORMATION.
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) };
    if ok == 0 {
        return 1;
    }
    // SAFETY: the call succeeded, so it filled `info` in.
    unsafe { info.assume_init() }.nNumberOfLinks
}

#[cfg(unix)]
fn link_count(path: &Path) -> u32 {
    use std::os::unix::fs::MetadataExt;
    fs::metadata(path).map_or(1, |m| u32::try_from(m.nlink()).unwrap_or(u32::MAX))
}

#[cfg(not(any(windows, unix)))]
fn link_count(_path: &Path) -> u32 {
    1
}

/// Makes the new name itself last through a power cut. Windows commits it with
/// the replace; elsewhere the folder has to be flushed.
fn sync_folder(path: &Path) {
    #[cfg(unix)]
    if let Some(folder) = path.parent() {
        if let Ok(folder) = File::open(folder) {
            let _ = folder.sync_all();
        }
    }
    #[cfg(not(unix))]
    let _ = path;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("scrivon-atomic-write-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn names(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
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

    fn body(path: &Path, bytes: &[u8]) -> Vec<u8> {
        let path = path.to_str().unwrap().as_bytes();
        let mut body = (path.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(path);
        body.extend_from_slice(bytes);
        body
    }

    #[test]
    fn replaces_the_file_and_leaves_no_temporary_file() {
        let dir = TempDir::new();
        let path = dir.0.join("notes.md");
        fs::write(&path, "old text").unwrap();

        save(&path, b"new text").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new text");
        assert_eq!(dir.names(), ["notes.md"]);
    }

    #[test]
    fn creates_a_file_that_is_not_there() {
        let dir = TempDir::new();
        let path = dir.0.join("new.md");

        save(&path, b"hello").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
        assert_eq!(dir.names(), ["new.md"]);
    }

    #[test]
    fn writes_through_a_hard_link_instead_of_cutting_it_off() {
        let dir = TempDir::new();
        let path = dir.0.join("notes.md");
        let other_name = dir.0.join("same notes.md");
        fs::write(&path, "old text").unwrap();
        fs::hard_link(&path, &other_name).unwrap();

        save(&path, b"new text").unwrap();

        assert_eq!(fs::read_to_string(&other_name).unwrap(), "new text");
        assert_eq!(dir.names(), ["notes.md", "same notes.md"]);
    }

    #[test]
    fn removes_the_temporary_file_when_the_file_cannot_be_replaced() {
        let dir = TempDir::new();
        // A folder where the file should be can't be replaced by one.
        let path = dir.0.join("notes.md");
        fs::create_dir(&path).unwrap();

        assert!(save(&path, b"new text").is_err());

        assert_eq!(dir.names(), ["notes.md"]);
        assert!(path.is_dir());
    }

    #[cfg(windows)]
    #[test]
    fn keeps_the_files_alternate_data_streams() {
        // Lost with a rename: proof the file keeps its identity.
        let dir = TempDir::new();
        let path = dir.0.join("notes.md");
        fs::write(&path, "old text").unwrap();
        let stream = dir.0.join("notes.md:Zone.Identifier");
        fs::write(&stream, "[ZoneTransfer]").unwrap();

        save(&path, b"new text").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new text");
        assert_eq!(fs::read_to_string(&stream).unwrap(), "[ZoneTransfer]");
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_files_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new();
        let path = dir.0.join("private.md");
        fs::write(&path, "old").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();

        save(&path, b"new").unwrap();

        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn reads_the_path_and_the_bytes_from_the_body() {
        let path = std::env::temp_dir().join("ünïcode notes.md");
        let sent = body(&path, &[0xff, 0xfe, 0x41, 0x00]);

        let (read_path, bytes) = parse_body(&sent).unwrap();

        assert_eq!(read_path, path);
        assert_eq!(bytes, [0xff, 0xfe, 0x41, 0x00]);
    }

    /// Allows what is inside `folder`, matched as the file scope matches a file
    /// that isn't there yet: by its path as written, part by part, and by the
    /// folder's real location.
    fn inside(folder: &Path) -> impl Fn(&Path) -> bool {
        let written = folder.to_path_buf();
        let real = fs::canonicalize(folder).unwrap();
        move |path| path.starts_with(&written) || path.starts_with(&real)
    }

    #[test]
    fn refuses_a_new_file_whose_path_climbs_out_of_the_opened_folder() {
        let dir = TempDir::new();
        let opened = dir.0.join("opened");
        fs::create_dir(&opened).unwrap();
        // Written this way it still starts with the opened folder.
        let escaping = opened.join("..").join("outside.txt");
        assert!(inside(&opened)(&escaping));

        let refused = save_allowed(&escaping, b"x", inside(&opened)).unwrap_err();

        assert!(refused.contains("folder you opened"), "{refused}");
        assert!(!dir.0.join("outside.txt").exists());
        assert_eq!(dir.names(), ["opened"]);
    }

    #[test]
    fn checks_and_saves_where_the_file_really_is() {
        let dir = TempDir::new();
        let asked = std::cell::RefCell::new(Vec::new());

        save_allowed(&dir.0.join("notes.md"), b"hello", |path| {
            asked.borrow_mut().push(path.to_path_buf());
            true
        })
        .unwrap();

        let real = fs::canonicalize(&dir.0).unwrap().join("notes.md");
        assert_eq!(*asked.borrow(), [real]);
        assert_eq!(fs::read_to_string(dir.0.join("notes.md")).unwrap(), "hello");
    }

    #[test]
    fn refuses_a_file_outside_the_opened_folders() {
        let dir = TempDir::new();

        assert!(save_allowed(&dir.0.join("notes.md"), b"x", |_| false).is_err());

        assert!(dir.names().is_empty());
    }

    #[test]
    fn says_a_folder_is_gone_only_when_the_window_may_use_it() {
        let dir = TempDir::new();
        let path = dir.0.join("deleted").join("notes.md");

        let gone = save_allowed(&path, b"x", |_| true).unwrap_err();
        let refused = save_allowed(&path, b"x", |_| false).unwrap_err();

        assert!(gone.contains("os error"), "{gone}");
        assert!(refused.contains("folder you opened"), "{refused}");
    }

    #[test]
    fn refuses_a_body_it_cannot_read() {
        assert!(parse_body(&[]).is_err());
        assert!(parse_body(&[10, 0, 0, 0, b'a']).is_err());
        // A relative path, or one with no file name.
        assert!(parse_body(&body(Path::new("notes.md"), b"x")).is_err());
        let mut not_utf8 = 2u32.to_le_bytes().to_vec();
        not_utf8.extend_from_slice(&[0xff, 0xfe]);
        assert!(parse_body(&not_utf8).is_err());
    }
}
