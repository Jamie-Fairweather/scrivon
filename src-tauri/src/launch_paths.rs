//! Files and folders Scrivon is asked to open from outside: a file double-clicked
//! in File Explorer or opened with "Open with" (the installer registers Scrivon
//! for these files, see `bundle.fileAssociations` in tauri.conf.json), or paths
//! named on the command line.
//!
//! The first launch's paths are read at startup. A later launch quits straight
//! away and hands its paths to the copy already running (the single-instance
//! plugin in lib.rs). Either way they wait here until the page takes them
//! (`take_launch_paths`), so none is lost while the page is still loading, and
//! the page is told when more come (`EVENT`).
//!
//! Opening a file from File Explorer is choosing it, as picking a folder in the
//! folder dialog is, so the folder Scrivon opens for it is added to the fs scope
//! (`LaunchPaths::add`). `allow_workspace` then accepts that folder. Only the
//! program's own arguments come here: the page can't add a path.

use std::ffi::OsStr;
use std::path::Path;
use std::sync::{Mutex, PoisonError};

/// Sent to the page when another launch has handed over paths to open.
pub const EVENT: &str = "launch-paths";

/// The extensions of the files Scrivon opens (lib/workspace/file-types.ts).
pub const DOCUMENT_EXTENSIONS: [&str; 4] = ["md", "markdown", "mmd", "mermaid"];

/// A file to open in a tab, or a folder to open.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPath {
    pub path: String,
    pub is_folder: bool,
}

impl LaunchPath {
    /// The folder Scrivon opens for this path: the one a file is in, or the folder itself.
    pub fn folder(&self) -> &Path {
        let path = Path::new(&self.path);
        if self.is_folder {
            path
        } else {
            path.parent().unwrap_or(path)
        }
    }
}

/// The documents and folders among a launch's arguments (those after the
/// program's own path), as full paths. A relative path is taken from `cwd`, the
/// folder the launch was started in. Options (`-x`, `--x`), and paths that
/// aren't a folder or a document Scrivon opens, are left out.
pub fn parse_args<I, S>(args: I, cwd: &Path) -> Vec<LaunchPath>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    args.into_iter()
        .filter_map(|arg| launch_path(arg.as_ref(), cwd))
        .collect()
}

fn launch_path(arg: &OsStr, cwd: &Path) -> Option<LaunchPath> {
    if arg.is_empty() || arg.to_string_lossy().starts_with('-') {
        return None;
    }
    // Also works out `.` and `..` on Windows, so the page sees the folder's real path.
    let path = std::path::absolute(cwd.join(arg)).ok()?;
    let is_folder = path.is_dir();
    if !is_folder && !(path.is_file() && is_document(&path)) {
        log::warn!(
            "Not opening {}: not a folder or a document Scrivon opens.",
            path.display()
        );
        return None;
    }
    Some(LaunchPath {
        path: path.to_string_lossy().into_owned(),
        is_folder,
    })
}

fn is_document(path: &Path) -> bool {
    path.extension().and_then(OsStr::to_str).is_some_and(|ext| {
        DOCUMENT_EXTENSIONS
            .iter()
            .any(|d| d.eq_ignore_ascii_case(ext))
    })
}

/// The paths waiting for the page to open them, oldest first.
#[derive(Default)]
pub struct LaunchPaths(Mutex<Vec<LaunchPath>>);

impl LaunchPaths {
    /// Queues `paths` for the page, once `allow_folder` has let it open the
    /// folder each one opens in (by adding it to the fs scope). A path whose
    /// folder can't be allowed is left out. True when any was queued.
    pub fn add(
        &self,
        paths: Vec<LaunchPath>,
        allow_folder: impl Fn(&Path) -> Result<(), String>,
    ) -> bool {
        let allowed: Vec<LaunchPath> = paths
            .into_iter()
            .filter(|path| match allow_folder(path.folder()) {
                Ok(()) => true,
                Err(err) => {
                    log::warn!("Could not open {}: {err}", path.path);
                    false
                }
            })
            .collect();
        let added = !allowed.is_empty();
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .extend(allowed);
        added
    }

    /// Hands out the paths waiting, each once.
    pub fn take(&self) -> Vec<LaunchPath> {
        std::mem::take(&mut *self.0.lock().unwrap_or_else(PoisonError::into_inner))
    }
}

/// The files and folders Scrivon was asked to open since the page last asked.
#[tauri::command]
pub fn take_launch_paths(waiting: tauri::State<'_, LaunchPaths>) -> Vec<LaunchPath> {
    waiting.take()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "scrivon-launch-paths-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        /// `name` may hold `/`; the path uses the system's own separator.
        fn file(&self, name: &str) -> String {
            let file: PathBuf = self.0.join(name).components().collect();
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, "text").unwrap();
            file.to_string_lossy().into_owned()
        }

        fn folder(&self, name: &str) -> String {
            let folder: PathBuf = self.0.join(name).components().collect();
            std::fs::create_dir_all(&folder).unwrap();
            folder.to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn file(path: &str) -> LaunchPath {
        LaunchPath {
            path: path.to_string(),
            is_folder: false,
        }
    }

    fn folder(path: &str) -> LaunchPath {
        LaunchPath {
            path: path.to_string(),
            is_folder: true,
        }
    }

    #[test]
    fn a_file_double_clicked_in_file_explorer_is_opened() {
        let temp = TempDir::new("explorer");
        let notes = temp.file("notes.md");
        // Explorer starts Scrivon with the file's full path, wherever it was started from.
        let elsewhere = std::env::temp_dir();

        assert_eq!(parse_args([&notes], &elsewhere), [file(&notes)]);
    }

    #[test]
    fn every_kind_of_document_is_opened_whatever_the_case_of_its_extension() {
        let temp = TempDir::new("kinds");
        let names = [
            "a.md",
            "b.markdown",
            "c.mmd",
            "d.mermaid",
            "E.MD",
            "f.Markdown",
        ];
        let paths: Vec<String> = names.iter().map(|name| temp.file(name)).collect();

        let parsed = parse_args(&paths, &temp.0);

        assert_eq!(parsed, paths.iter().map(|p| file(p)).collect::<Vec<_>>());
    }

    #[test]
    fn a_path_typed_on_the_command_line_is_taken_from_the_folder_it_was_typed_in() {
        let temp = TempDir::new("relative");
        let notes = temp.file("docs/notes.md");
        let docs = temp.folder("docs");

        assert_eq!(
            parse_args(["docs/notes.md", "docs"], &temp.0),
            [file(&notes), folder(&docs)]
        );
    }

    #[cfg(windows)]
    #[test]
    fn dots_in_a_typed_path_are_worked_out() {
        let temp = TempDir::new("dots");
        let notes = temp.file("notes.md");
        temp.folder("sub");

        assert_eq!(parse_args([r"sub\..\.\notes.md"], &temp.0), [file(&notes)]);
    }

    #[test]
    fn options_missing_paths_and_other_files_are_left_out() {
        let temp = TempDir::new("left-out");
        temp.file("photo.png");
        temp.file("notes.txt");
        temp.folder("folder.md");
        let kept = temp.file("kept.mmd");

        let parsed = parse_args(
            [
                "",
                "--flag",
                "-x",
                "missing.md",
                "photo.png",
                "notes.txt",
                "kept.mmd",
            ],
            &temp.0,
        );

        assert_eq!(parsed, [file(&kept)]);
    }

    #[test]
    fn a_folder_named_like_a_document_opens_as_a_folder() {
        let temp = TempDir::new("folder-md");
        let odd = temp.folder("folder.md");

        assert_eq!(parse_args(["folder.md"], &temp.0), [folder(&odd)]);
    }

    #[test]
    fn the_folder_opened_for_a_file_is_the_one_it_is_in() {
        let temp = TempDir::new("folder-of");
        let notes = temp.file("docs/notes.md");
        let docs = temp.folder("docs");

        assert_eq!(file(&notes).folder(), Path::new(&docs));
        assert_eq!(folder(&docs).folder(), Path::new(&docs));
    }

    #[test]
    fn waiting_paths_are_handed_out_once_in_the_order_they_came() {
        let waiting = LaunchPaths::default();
        let allow = |_: &Path| Ok(());

        assert!(waiting.add(vec![file("/a/one.md")], allow));
        assert!(waiting.add(vec![file("/b/two.md"), folder("/c")], allow));

        assert_eq!(
            waiting.take(),
            [file("/a/one.md"), file("/b/two.md"), folder("/c")]
        );
        assert_eq!(waiting.take(), []);
    }

    #[test]
    fn the_page_may_open_the_folder_of_each_waiting_path() {
        let waiting = LaunchPaths::default();
        let allowed = std::cell::RefCell::new(Vec::new());

        waiting.add(vec![file("/a/one.md"), folder("/c")], |folder: &Path| {
            allowed.borrow_mut().push(folder.to_path_buf());
            Ok(())
        });

        assert_eq!(
            *allowed.borrow(),
            [PathBuf::from("/a"), PathBuf::from("/c")]
        );
    }

    #[test]
    fn a_path_whose_folder_cannot_be_allowed_is_not_handed_out() {
        let waiting = LaunchPaths::default();

        let added = waiting.add(vec![file("/a/one.md"), file("/b/two.md")], |folder| {
            if folder == Path::new("/a") {
                Err("refused".to_string())
            } else {
                Ok(())
            }
        });

        assert!(added);
        assert_eq!(waiting.take(), [file("/b/two.md")]);
        assert!(!waiting.add(vec![], |_| Ok(())));
    }
}
