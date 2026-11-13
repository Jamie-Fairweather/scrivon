//! Reads images inside the open folder, so the Markdown preview can show them.
//!
//! Only a file inside `root` is read, and `root` must be a folder the user
//! opened (the fs scope has it). The paths are compared as written first, so
//! nothing outside the folder is even looked up, and then as they really are on
//! disk, so a link or junction inside the folder can't lead out of it. Nothing
//! is remembered: unlike export images, these are only read while their folder
//! is open.

use std::io::ErrorKind;
use std::path::{Component, Path};

use tauri_plugin_fs::FsExt;

use crate::pdf_export;

const OUTSIDE_FOLDER: &str = "Only images inside the open folder are shown.";
const NOT_FOUND: &str = "Image not found.";

/// Said for an image over the size limit, which export images share.
fn too_large() -> String {
    format!(
        "Image is too large to show (limit {} MB).",
        pdf_export::MAX_EXPORT_IMAGE_BYTES / (1024 * 1024)
    )
}

/// Reads an image inside the open folder `root` as a data URL. Runs on a
/// background thread: a cloud file that is online only can take seconds to
/// arrive.
#[tauri::command]
pub async fn read_workspace_image(
    app: tauri::AppHandle,
    root: String,
    path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.fs_scope();
        read_folder_image(&root, &path, |image| scope.is_allowed(image))
    })
    .await
    .map_err(|_| "Could not read image.".to_string())?
}

/// `read_workspace_image` without the app: `in_scope` is the fs scope.
fn read_folder_image(
    root: &str,
    path: &str,
    in_scope: impl Fn(&Path) -> bool,
) -> Result<String, String> {
    pdf_export::export_image_mime(path)?;
    if !written_inside(Path::new(path), Path::new(root)) {
        return Err(OUTSIDE_FOLDER.into());
    }
    let folder = std::fs::canonicalize(root).map_err(|_| OUTSIDE_FOLDER.to_string())?;
    if !in_scope(&folder) {
        return Err(OUTSIDE_FOLDER.into());
    }
    let image = std::fs::canonicalize(path).map_err(|err| match err.kind() {
        ErrorKind::NotFound => NOT_FOUND.to_string(),
        _ => format!("Could not read image: {err}"),
    })?;
    if !image.starts_with(&folder) || !in_scope(&image) {
        return Err(OUTSIDE_FOLDER.into());
    }
    pdf_export::read_image_data_url(&image.to_string_lossy(), &too_large())
}

/// Whether `path`, as written, names something inside `folder`: absolute, no
/// `..`, and starting with the folder's names (in any letter case on Windows,
/// where names ignore case).
fn written_inside(path: &Path, folder: &Path) -> bool {
    if !path.is_absolute() || path.components().any(|part| part == Component::ParentDir) {
        return false;
    }
    let name = |part: Component| {
        let text = part.as_os_str().to_string_lossy();
        if cfg!(windows) {
            text.to_lowercase()
        } else {
            text.into_owned()
        }
    };
    let mut parts = path.components().map(name);
    folder
        .components()
        .map(name)
        .all(|part| parts.next() == Some(part))
        && parts.next().is_some()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "scrivon-workspace-image-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self, name: &str, bytes: &[u8]) -> String {
            let path = self.0.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        }

        fn path(&self, name: &str) -> String {
            self.0.join(name).to_string_lossy().into_owned()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The fs scope after the user opened `folder`.
    fn opened(folder: &str) -> impl Fn(&Path) -> bool {
        let folder = std::fs::canonicalize(folder).unwrap();
        move |path: &Path| path.starts_with(&folder)
    }

    #[test]
    fn reads_an_image_anywhere_inside_the_open_folder() {
        let temp = TempDir::new("inside");
        let root = temp.path("notes");
        temp.file("notes/img/deep/chart.png", PNG);

        let read = read_folder_image(&root, &temp.path("notes/img/deep/chart.png"), opened(&root));

        assert_eq!(read.unwrap(), "data:image/png;base64,iVBORw0KGgo=");
    }

    #[test]
    fn never_reads_an_image_outside_the_open_folder() {
        let temp = TempDir::new("outside");
        let root = temp.path("notes");
        std::fs::create_dir_all(&root).unwrap();
        let next_door = temp.file("notes-old/secret.png", PNG);
        let above = temp.file("secret.png", PNG);
        let climbing = temp.path("notes/../secret.png");
        let everything = |_: &Path| true;

        for path in [next_door, above, climbing] {
            assert_eq!(
                read_folder_image(&root, &path, everything),
                Err(OUTSIDE_FOLDER.into()),
                "{path}"
            );
        }
        assert_eq!(
            read_folder_image(&root, "notes/a.png", everything),
            Err(OUTSIDE_FOLDER.into())
        );
    }

    #[test]
    fn never_reads_from_a_folder_the_user_did_not_open() {
        let temp = TempDir::new("not-opened");
        let root = temp.path("notes");
        let image = temp.file("notes/a.png", PNG);

        assert_eq!(
            read_folder_image(&root, &image, |_| false),
            Err(OUTSIDE_FOLDER.into())
        );
        assert_eq!(
            read_folder_image(&temp.path("gone"), &temp.path("gone/a.png"), |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
    }

    #[test]
    fn says_when_an_image_is_missing_or_not_an_image() {
        let temp = TempDir::new("missing");
        let root = temp.path("notes");
        std::fs::create_dir_all(&root).unwrap();
        let key = temp.file("notes/id_ed25519", b"-----BEGIN OPENSSH PRIVATE KEY-----");
        let renamed = temp.file("notes/key.png", b"-----BEGIN OPENSSH PRIVATE KEY-----");

        assert_eq!(
            read_folder_image(&root, &temp.path("notes/later.png"), opened(&root)),
            Err(NOT_FOUND.into())
        );
        assert!(read_folder_image(&root, &key, opened(&root))
            .unwrap_err()
            .contains("PNG, JPEG"));
        assert_eq!(
            read_folder_image(&root, &renamed, opened(&root)),
            Err("This file isn't a valid image.".into())
        );
    }

    #[test]
    fn says_an_image_over_the_limit_is_too_large_to_show() {
        let temp = TempDir::new("huge");
        let root = temp.path("notes");
        let huge = temp.file("notes/huge.png", PNG);
        // Sized without writing: the size is checked before the file is read.
        std::fs::OpenOptions::new()
            .write(true)
            .open(&huge)
            .and_then(|file| file.set_len(pdf_export::MAX_EXPORT_IMAGE_BYTES as u64 + 1))
            .unwrap();

        assert_eq!(
            read_folder_image(&root, &huge, opened(&root)),
            Err("Image is too large to show (limit 12 MB).".into())
        );
    }

    #[cfg(windows)]
    #[test]
    fn matches_the_folder_in_any_letter_case_on_windows() {
        let temp = TempDir::new("case");
        let root = temp.path("Notes");
        temp.file("Notes/A.png", PNG);

        let read = read_folder_image(
            &root.to_uppercase(),
            &temp.path("notes/a.PNG"),
            opened(&root),
        );

        assert!(read.unwrap().starts_with("data:image/png;base64,"));
    }

    #[cfg(unix)]
    #[test]
    fn never_follows_a_link_out_of_the_open_folder() {
        let temp = TempDir::new("link");
        let root = temp.path("notes");
        std::fs::create_dir_all(&root).unwrap();
        let secret = temp.file("secret.png", PNG);
        let link = temp.path("notes/link.png");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        assert_eq!(
            read_folder_image(&root, &link, |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
    }

    /// The Windows way out: a junction inside the folder to a folder outside it.
    #[cfg(windows)]
    #[test]
    fn never_follows_a_junction_out_of_the_open_folder() {
        let temp = TempDir::new("junction");
        let root = temp.path("notes");
        std::fs::create_dir_all(&root).unwrap();
        temp.file("outside/secret.png", PNG);
        // `\` only: cmd takes a `/` as the start of a switch.
        let junction = temp.0.join("notes").join("pics");
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(temp.0.join("outside"))
            .output()
            .unwrap();
        assert!(made.status.success(), "{made:?}");
        let through_junction = junction.join("secret.png");
        // The file is really there, so only the junction is refused.
        assert!(through_junction.is_file());

        assert_eq!(
            read_folder_image(&root, &through_junction.to_string_lossy(), |_| true),
            Err(OUTSIDE_FOLDER.into())
        );
    }
}
