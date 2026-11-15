//! Deleting a file or folder moves it to the Recycle Bin (the Trash on macOS
//! and Linux), so a mistake can be undone (F01). Only what is inside a folder
//! the user opened can go, never that folder itself.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use tauri_plugin_fs::FsExt;

use crate::atomic_write::allowed_target;

/// Moves a file or folder (with everything in it) to the Recycle Bin. It must
/// be inside a folder the user opened. Fails with a plain sentence saying why.
#[tauri::command]
pub async fn trash_workspace_path(app: tauri::AppHandle, path: PathBuf) -> Result<(), String> {
    let scope = app.fs_scope();
    let (sent, done) = tokio::sync::oneshot::channel();
    // A thread of its own, off the window's main thread: the Recycle Bin is
    // reached through COM, which the trash crate sets up for the thread it runs
    // on, and a shared thread may already have it set up another way.
    std::thread::spawn(move || {
        let _ = sent.send(trash_allowed(
            &path,
            |target| scope.is_allowed(target),
            move_to_trash,
        ));
    });
    done.await
        .map_err(|_| "Something went wrong while moving it to the Recycle Bin.".to_string())?
}

/// Hands `path` to `trash` when it is inside a folder `is_allowed` (the file
/// scope) lets the window change. It is checked where it really is, as a save
/// is, and its own folder must be allowed too: so never an opened folder
/// itself, nor a lone file a save dialog allowed.
fn trash_allowed(
    path: &Path,
    is_allowed: impl Fn(&Path) -> bool,
    trash: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let target = allowed_target(path, &is_allowed)?;
    if !target.parent().is_some_and(&is_allowed) {
        return Err(format!(
            "Scrivon can only delete what is inside a folder you opened: {}",
            path.display()
        ));
    }
    // Not followed: a link goes, not what it leads to.
    match fs::symlink_metadata(&target) {
        Ok(_) => trash(&target),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Err("It isn't there any more.".into()),
        Err(err) => Err(err.to_string()),
    }
}

const NO_RECYCLE_BIN: &str = "This drive has no Recycle Bin, so it was left as it is.";

fn move_to_trash(path: &Path) -> Result<(), String> {
    // Asked to recycle what it can't, Windows erases it for good and still
    // says it went fine (seen on a network share). So such drives are refused.
    #[cfg(windows)]
    if !has_recycle_bin(path) {
        return Err(NO_RECYCLE_BIN.into());
    }
    trash::delete(path).map_err(|err| trash_error_text(&err))
}

/// Whether the drive `path` is on keeps a Recycle Bin. A fixed drive does; a
/// network share, USB stick, memory card or CD doesn't. When it can't tell, no.
#[cfg(windows)]
fn has_recycle_bin(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetVolumePathNameW(path: *const u16, root: *mut u16, len: u32) -> i32;
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    const DRIVE_FIXED: u32 = 3;

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    // The drive's root (`C:\`, `\\server\share\`, or a folder another drive is
    // mounted at) is never longer than the path itself, plus a backslash.
    let mut root = vec![0u16; wide.len() + 1];
    let Ok(len) = u32::try_from(root.len()) else {
        return false;
    };
    // SAFETY: `wide` is NUL-terminated and `root` holds `len` characters; both outlive the calls.
    unsafe {
        GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), len) != 0
            && GetDriveTypeW(root.as_ptr()) == DRIVE_FIXED
    }
}

/// Why the Recycle Bin didn't take something, in plain words. The trash
/// crate's own text is written for developers.
fn trash_error_text(err: &trash::Error) -> String {
    match err {
        trash::Error::Os { code, description } => match *code as u32 {
            // The shell's "in use by another process", and Windows' sharing and lock violations.
            0x8027_0027 | 0x8007_0020 | 0x8007_0021 => {
                "It is open in another program. Close it there and try again.".into()
            }
            // The Recycle Bin is turned off or missing on this drive (a network drive, say).
            0x8027_0036 | 0x8027_003A => NO_RECYCLE_BIN.into(),
            0x8027_0037 => "It is too big for the Recycle Bin, so it was left as it is.".into(),
            // Access denied (the shell's and Windows' own), read-only, or needs an administrator.
            0x8027_0021 | 0x8027_003F | 0x8027_0002 | 0x8007_0005 => "Access was denied.".into(),
            _ => plain_reason(description),
        },
        // Stopped part way with no reason given for any item.
        trash::Error::Unknown { description } if description == "Some operations were aborted" => {
            "Windows stopped before it was done.".into()
        }
        trash::Error::Unknown { description } => plain_reason(description),
        other => other.to_string(),
    }
}

/// The system's own reason, without the crate's `windows error: ` start or
/// the error codes (`(0x8027001d)`), which mean nothing to the user.
fn plain_reason(description: &str) -> String {
    let text = description
        .strip_prefix("windows error: ")
        .unwrap_or(description);
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(" (0x") {
        let after = &rest[at + 4..];
        let code = after.as_bytes();
        if code.len() >= 9 && code[..8].iter().all(u8::is_ascii_hexdigit) && code[8] == b')' {
            out.push_str(&rest[..at]);
            rest = &after[9..];
        } else {
            out.push_str(&rest[..at + 4]);
            rest = after;
        }
    }
    out.push_str(rest);
    let out = out.trim();
    // Only a code (the system had no words for it).
    if out.is_empty() || (out.starts_with("0x") && out[2..].bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return "Windows didn't say why.".into();
    }
    out.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fs;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("scrivon-trash-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Allows `folder` and what is inside it, as the file scope does for an
    /// opened folder: by its path as written and by where it really is.
    fn opened(folder: &Path) -> impl Fn(&Path) -> bool {
        let written = folder.to_path_buf();
        let real = fs::canonicalize(folder).unwrap();
        move |path| path.starts_with(&written) || path.starts_with(&real)
    }

    /// A stand-in for the Recycle Bin that notes what it was given, so the
    /// tests don't fill the real one.
    fn recorder(taken: &RefCell<Vec<PathBuf>>) -> impl FnOnce(&Path) -> Result<(), String> + '_ {
        move |path| {
            taken.borrow_mut().push(path.to_path_buf());
            Ok(())
        }
    }

    #[test]
    fn moves_a_file_or_folder_inside_the_opened_folder_from_where_it_really_is() {
        let dir = TempDir::new();
        fs::write(dir.0.join("notes.md"), "x").unwrap();
        fs::create_dir(dir.0.join("docs")).unwrap();
        let taken = RefCell::new(Vec::new());

        trash_allowed(&dir.0.join("notes.md"), opened(&dir.0), recorder(&taken)).unwrap();
        trash_allowed(&dir.0.join("docs"), opened(&dir.0), recorder(&taken)).unwrap();

        let real = fs::canonicalize(&dir.0).unwrap();
        assert_eq!(*taken.borrow(), [real.join("notes.md"), real.join("docs")]);
    }

    #[test]
    fn refuses_the_opened_folder_itself() {
        let dir = TempDir::new();
        let taken = RefCell::new(Vec::new());

        let refused = trash_allowed(&dir.0, opened(&dir.0), recorder(&taken)).unwrap_err();

        assert!(refused.contains("folder you opened"), "{refused}");
        assert!(taken.borrow().is_empty());
    }

    #[test]
    fn refuses_what_is_outside_the_opened_folders() {
        let dir = TempDir::new();
        let opened_folder = dir.0.join("opened");
        fs::create_dir(&opened_folder).unwrap();
        fs::write(dir.0.join("outside.md"), "x").unwrap();
        let taken = RefCell::new(Vec::new());

        // Written this way it still starts with the opened folder.
        let climbing = opened_folder.join("..").join("outside.md");
        let refused = [
            trash_allowed(
                &dir.0.join("outside.md"),
                opened(&opened_folder),
                recorder(&taken),
            ),
            trash_allowed(&climbing, opened(&opened_folder), recorder(&taken)),
        ];

        for result in refused {
            let err = result.unwrap_err();
            assert!(err.contains("folder you opened"), "{err}");
        }
        assert!(taken.borrow().is_empty());
        assert!(dir.0.join("outside.md").exists());
    }

    #[test]
    fn says_when_it_is_already_gone() {
        let dir = TempDir::new();
        let taken = RefCell::new(Vec::new());

        let err =
            trash_allowed(&dir.0.join("gone.md"), opened(&dir.0), recorder(&taken)).unwrap_err();

        assert_eq!(err, "It isn't there any more.");
        assert!(taken.borrow().is_empty());
    }

    #[test]
    fn passes_on_why_the_recycle_bin_would_not_take_it() {
        let dir = TempDir::new();
        fs::write(dir.0.join("notes.md"), "x").unwrap();

        let err = trash_allowed(&dir.0.join("notes.md"), opened(&dir.0), |_| {
            Err("It is open in another program.".to_string())
        })
        .unwrap_err();

        assert_eq!(err, "It is open in another program.");
    }

    fn os_error(code: u32, description: &str) -> trash::Error {
        trash::Error::Os {
            code: code as i32,
            description: description.into(),
        }
    }

    #[test]
    fn explains_common_recycle_bin_failures_in_plain_words() {
        let in_use = os_error(
            0x8027_0027,
            "windows error: C:\\ws\\a.md: the source is in use by another process (0x80270027)",
        );
        let no_bin = os_error(
            0x8027_0036,
            "windows error: the Recycle Bin is not available on this drive",
        );
        let too_big = os_error(
            0x8027_0037,
            "windows error: the item is too large for the Recycle Bin",
        );
        let denied = os_error(0x8007_0005, "windows error: Access is denied.");

        assert_eq!(
            trash_error_text(&in_use),
            "It is open in another program. Close it there and try again."
        );
        assert_eq!(
            trash_error_text(&no_bin),
            "This drive has no Recycle Bin, so it was left as it is."
        );
        assert_eq!(
            trash_error_text(&too_big),
            "It is too big for the Recycle Bin, so it was left as it is."
        );
        assert_eq!(trash_error_text(&denied), "Access was denied.");
    }

    #[test]
    fn keeps_the_systems_reason_for_other_failures_without_the_developer_wording() {
        // COPYENGINE_E_PATH_TOO_DEEP_SRC, which has no wording of its own here.
        let too_deep = os_error(
            0x8027_001D,
            "windows error: C:\\ws\\a.md: the source path is too long (0x8027001d)",
        );
        // How the system's own message comes through, its code in capitals.
        let system = os_error(
            0x8007_0003,
            "windows error: The system cannot find the path specified. (0x80070003)",
        );
        let no_words = os_error(0x8000_4005, "windows error: 0x80004005");
        let aborted = trash::Error::Unknown {
            description: "Some operations were aborted".into(),
        };

        assert_eq!(
            trash_error_text(&too_deep),
            "C:\\ws\\a.md: the source path is too long"
        );
        assert_eq!(
            trash_error_text(&system),
            "The system cannot find the path specified."
        );
        assert_eq!(trash_error_text(&no_words), "Windows didn't say why.");
        assert_eq!(
            trash_error_text(&aborted),
            "Windows stopped before it was done."
        );
    }

    #[test]
    fn keeps_brackets_that_are_not_error_codes() {
        assert_eq!(
            plain_reason(
                "windows error: C:\\ws\\a (0x1).md: in use (0x80270027) (and 2 more item(s))"
            ),
            "C:\\ws\\a (0x1).md: in use (and 2 more item(s))"
        );
    }

    // Windows only: on Linux the trash crate makes the Trash folder first.
    #[cfg(windows)]
    #[test]
    fn the_real_recycle_bin_refuses_what_is_not_there() {
        // Nothing is put in the user's Recycle Bin: the file was never made.
        let dir = TempDir::new();

        assert!(move_to_trash(&dir.0.join("never-made.md")).is_err());
    }

    /// The whole way, as the app does it: the path is looked up on disk (so it
    /// starts `\\?\`), then the real Recycle Bin takes it. The items are emptied
    /// from the Recycle Bin again before anything is checked.
    #[cfg(windows)]
    #[test]
    fn a_real_file_and_folder_reach_the_recycle_bin() {
        let dir = TempDir::new();
        fs::write(dir.0.join("notes.md"), "x").unwrap();
        fs::create_dir(dir.0.join("docs")).unwrap();
        fs::write(dir.0.join("docs").join("a.md"), "x").unwrap();
        let folder = dir.0.file_name().unwrap().to_owned();

        let file = trash_allowed(&dir.0.join("notes.md"), opened(&dir.0), move_to_trash);
        let docs = trash_allowed(&dir.0.join("docs"), opened(&dir.0), move_to_trash);
        let ours: Vec<_> = trash::os_limited::list()
            .unwrap()
            .into_iter()
            .filter(|item| item.original_parent.file_name() == Some(folder.as_os_str()))
            .collect();
        trash::os_limited::purge_all(&ours).unwrap();

        file.unwrap();
        docs.unwrap();
        let mut names: Vec<_> = ours.iter().map(|item| item.name.clone()).collect();
        names.sort();
        assert_eq!(names, ["docs", "notes.md"]);
        assert!(!dir.0.join("notes.md").exists());
        assert!(!dir.0.join("docs").exists());
    }

    #[cfg(windows)]
    #[test]
    fn knows_which_drives_keep_a_recycle_bin() {
        let dir = TempDir::new();

        assert!(has_recycle_bin(&fs::canonicalize(&dir.0).unwrap()));
        assert!(has_recycle_bin(&dir.0));
        // A network share has none.
        assert!(!has_recycle_bin(Path::new(r"\\localhost\c$\Windows")));
        assert!(!has_recycle_bin(Path::new(r"\\?\UNC\localhost\c$\Windows")));
    }

    /// Without the check, Windows erased this file for good and said it went
    /// fine. Reaches the file through this computer's own `C$` share, so it
    /// is skipped where that share can't be opened.
    #[cfg(windows)]
    #[test]
    fn leaves_a_file_on_a_network_share_alone() {
        let dir = TempDir::new();
        let file = dir.0.join("notes.md");
        fs::write(&file, "x").unwrap();
        let local = fs::canonicalize(&file).unwrap();
        let local = local.to_string_lossy();
        // `\\?\C:\…` becomes `\\localhost\c$\…`.
        let Some(rest) = local.strip_prefix(r"\\?\") else {
            return;
        };
        let shared = format!(r"\\localhost\{}$\{}", &rest[..1], &rest[3..]);
        let Ok(shared) = fs::canonicalize(shared) else {
            eprintln!("skipped: this computer's C$ share can't be opened");
            return;
        };

        assert_eq!(move_to_trash(&shared), Err(NO_RECYCLE_BIN.to_string()));
        assert!(file.exists());
    }
}
