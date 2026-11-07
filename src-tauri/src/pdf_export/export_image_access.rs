//! Which images `read_export_image` may hand to the webview.
//!
//! PDF and Word exports embed the profile's logo and header/footer images, so
//! the webview asks Rust to read them. Without a check, any script in the
//! webview could read any real image on disk (screenshots, scanned IDs) this
//! way. So an image is only read when the user chose it: the open dialog has
//! just added it to the fs scope, or it was chosen in an earlier session.
//!
//! Those images are kept in `export-image-access.json` in the app data folder,
//! as a bare JSON array like `workspace-access.json` (see `workspace_access`):
//! the store plugin only ever writes a JSON object, so a script can break the
//! list (the user then picks the images again) but never add an image to it.
//! Profiles saved before this check name images the list doesn't have yet, so
//! the frontend may hand them over once (`adopt`), only while the list doesn't
//! exist (the first run with this check).

use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::Manager;

const ACCESS_FILE: &str = "export-image-access.json";
/// Entries kept (up to two per image). Older images must be chosen again.
const MAX_ENTRIES: usize = 500;
/// What `read_export_image` says about an image the user hasn't chosen.
pub(super) const NOT_CHOSEN: &str = "Choose this image again with Browse.";

#[derive(Default)]
pub(super) struct ExportImageAccess {
    file: Option<PathBuf>,
    images: Mutex<Vec<String>>,
    /// True until `adopt` runs, when the list didn't exist at load.
    can_adopt: AtomicBool,
}

impl ExportImageAccess {
    /// Loads the images chosen in earlier sessions.
    pub(super) fn load(data_dir: Option<&Path>) -> Self {
        let Some(dir) = data_dir else {
            return Self::default();
        };
        let file = dir.join(ACCESS_FILE);
        let (images, can_adopt) = match read_access_file(&file) {
            Ok(images) => (images, false),
            Err(err) if err.kind() == ErrorKind::NotFound => (Vec::new(), true),
            // Not a list Scrivon wrote: broken, or written through the store
            // plugin. Start empty and put a valid list back; the user picks the
            // images again.
            Err(err) if err.kind() == ErrorKind::InvalidData => {
                eprintln!("The export image list wasn't valid, so it was cleared: {err}");
                save_access_file(&file, &[]);
                (Vec::new(), false)
            }
            // Couldn't be read just now (locked, say): start empty but leave the
            // file alone. `remember` merges it back in.
            Err(err) => {
                eprintln!("Could not read the export image list: {err}");
                (Vec::new(), false)
            }
        };
        Self {
            file: Some(file),
            images: Mutex::new(images),
            can_adopt: AtomicBool::new(can_adopt),
        }
    }

    /// True when `path` is an image the user chose in an earlier session.
    fn is_listed(&self, path: &str) -> bool {
        let images = self.images.lock().unwrap();
        if images.iter().any(|image| image == path) {
            return true;
        }
        canonical_string(Path::new(path)).is_some_and(|canonical| images.contains(&canonical))
    }

    /// Records `paths` (and their canonical forms) as chosen by the user,
    /// newest first.
    fn remember_all(&self, paths: &[&str]) {
        let mut entries = Vec::new();
        for path in paths {
            entries.push(path.to_string());
            if let Some(canonical) = canonical_string(Path::new(path)) {
                if canonical != *path {
                    entries.push(canonical);
                }
            }
        }

        // Read and write under the lock, so two calls can't undo each other.
        let mut images = self.images.lock().unwrap();
        // Another window may have saved images since this one started: keep them.
        let saved = self
            .file
            .as_deref()
            .and_then(|file| read_access_file(file).ok());
        let merged = merge_newest_first(&[
            entries.as_slice(),
            saved.as_deref().unwrap_or_default(),
            images.as_slice(),
        ]);
        let unchanged = saved.as_ref() == Some(&merged);
        *images = merged;
        if unchanged {
            return;
        }
        if let Some(file) = &self.file {
            save_access_file(file, &images);
        }
    }

    /// Records `path` when `in_scope` allows it, that is, the open dialog has
    /// just added it to the fs scope. Returns whether it was recorded.
    pub(super) fn remember(&self, path: &str, in_scope: impl Fn(&Path) -> bool) -> bool {
        let path = path.trim();
        if !is_image_path(path) || !in_scope(Path::new(path)) {
            return false;
        }
        self.remember_all(&[path]);
        true
    }

    /// Accepts `path` for reading when the user chose it: `in_scope` (the fs
    /// scope, which the open dialog adds the picked file to) allows it, or it
    /// was chosen in an earlier session. Newly allowed images are recorded so
    /// they keep working after a restart.
    pub(super) fn approve(
        &self,
        path: &str,
        in_scope: impl Fn(&Path) -> bool,
    ) -> Result<(), String> {
        let path = path.trim();
        // Also turns away a `..` path recorded before `is_image_path` refused them.
        if !is_image_path(path) {
            return Err(NOT_CHOSEN.into());
        }
        if self.is_listed(path) {
            return Ok(());
        }
        if !self.remember(path, in_scope) {
            return Err(NOT_CHOSEN.into());
        }
        Ok(())
    }

    /// Takes on the images that profiles saved before this check name, once:
    /// only while no list had been saved when this list was loaded. Returns
    /// whether they were taken on.
    pub(super) fn adopt(&self, paths: &[String]) -> bool {
        if !self.can_adopt.swap(false, Ordering::SeqCst) {
            return false;
        }
        let paths: Vec<&str> = paths
            .iter()
            .map(|path| path.trim())
            .filter(|path| is_image_path(path))
            .collect();
        // This saves the list even when there's nothing to take on, so it can't
        // be adopted again after a restart.
        self.remember_all(&paths);
        true
    }
}

/// The app's list, loaded the first time an export image command needs it.
/// Nothing else writes the file, so it's as the app found it at startup.
///
/// It's loaded exactly once: an export reads several images side by side, and
/// a second load of a broken list would save an empty one over an image the
/// first had just recorded.
pub(super) fn access(app: &tauri::AppHandle) -> &'static ExportImageAccess {
    static ACCESS: OnceLock<ExportImageAccess> = OnceLock::new();
    ACCESS.get_or_init(|| {
        let data_dir = app.path().app_data_dir().ok();
        ExportImageAccess::load(data_dir.as_deref())
    })
}

/// An absolute path with an export image's extension and no `..` in it.
/// Anything else is never recorded or read. The fs scope matches a file that
/// isn't there yet by its path as written, so a `..` could climb out of an
/// opened folder and name a picture that turns up later anywhere on disk.
fn is_image_path(path: &str) -> bool {
    let image = Path::new(path);
    image.is_absolute()
        && !image
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        && super::mime_from_path(path).is_some()
}

fn canonical_string(path: &Path) -> Option<String> {
    std::fs::canonicalize(path)
        .ok()
        .map(|canonical| canonical.to_string_lossy().into_owned())
}

/// The lists' images in order, each once, at most `MAX_ENTRIES`.
fn merge_newest_first(lists: &[&[String]]) -> Vec<String> {
    let mut seen = HashSet::new();
    lists
        .iter()
        .flat_map(|list| list.iter())
        .filter(|image| seen.insert(image.as_str()))
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

fn save_access_file(file: &Path, images: &[String]) {
    if let Err(err) = write_access_file(file, images) {
        eprintln!("Could not save the export image list: {err}");
    }
}

fn write_access_file(file: &Path, images: &[String]) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // A bare array, never an object (see the module comment).
    let json = serde_json::to_vec_pretty(images)?;
    // Write a temporary file and swap it in, so a failed write never leaves a
    // half-written list behind.
    let id = uuid::Uuid::new_v4().simple().to_string();
    let temp = file.with_extension(format!("json.{}.tmp", &id[..8]));
    let written = std::fs::write(&temp, json).and_then(|()| std::fs::rename(&temp, file));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "scrivon-export-image-access-{name}-{}",
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn image(&self, name: &str) -> String {
            let path = self.0.join(name);
            std::fs::write(&path, b"\x89PNG\r\n\x1a\n").unwrap();
            path.to_string_lossy().into_owned()
        }

        fn data(&self) -> PathBuf {
            self.0.join("data")
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
    fn refuses_an_image_the_user_never_chose() {
        let temp = TempDir::new("refuse");
        let photo = temp.image("passport.png");
        let access = ExportImageAccess::load(Some(&temp.data()));

        assert_eq!(
            access.approve(&photo, never_in_scope),
            Err(NOT_CHOSEN.into())
        );
        // Nothing was written for it.
        assert!(!temp.data().join(ACCESS_FILE).exists());
    }

    #[test]
    fn accepts_an_image_the_dialog_just_added_and_remembers_it_after_restart() {
        let temp = TempDir::new("dialog");
        let logo = temp.image("logo.png");

        let access = ExportImageAccess::load(Some(&temp.data()));
        access
            .approve(&logo, |path| path == Path::new(&logo))
            .unwrap();

        let restarted = ExportImageAccess::load(Some(&temp.data()));
        restarted.approve(&logo, never_in_scope).unwrap();
    }

    #[test]
    fn remembers_a_picked_image_only_while_it_is_in_scope() {
        let temp = TempDir::new("remember");
        let logo = temp.image("logo.png");
        let other = temp.image("other.png");
        let access = ExportImageAccess::load(Some(&temp.data()));

        assert!(access.remember(&logo, |path| path == Path::new(&logo)));
        assert!(!access.remember(&other, never_in_scope));
        // Only images, and only absolute paths.
        let key = temp.0.join("id_ed25519").to_string_lossy().into_owned();
        assert!(!access.remember(&key, |_| true));
        assert!(!access.remember("logo.png", |_| true));

        let restarted = ExportImageAccess::load(Some(&temp.data()));
        restarted.approve(&logo, never_in_scope).unwrap();
        assert!(restarted.approve(&other, never_in_scope).is_err());
    }

    #[test]
    fn never_records_or_reads_an_image_whose_path_climbs_out_of_a_chosen_folder() {
        let temp = TempDir::new("climb");
        let opened = temp.0.join("opened");
        std::fs::create_dir_all(&opened).unwrap();
        // Matched as written, the fs scope takes this for a file in the opened folder.
        let in_opened = |path: &Path| path.starts_with(&opened);
        let climbing = opened.join("..").join("later.png");
        let climbing = climbing.to_string_lossy().into_owned();
        let access = ExportImageAccess::load(Some(&temp.data()));

        assert!(!access.remember(&climbing, in_opened));
        assert!(access.adopt(std::slice::from_ref(&climbing)));
        assert!(access.images.lock().unwrap().is_empty());
        // A picture that turns up there later still can't be read.
        temp.image("later.png");
        assert_eq!(access.approve(&climbing, in_opened), Err(NOT_CHOSEN.into()));

        // Nor one recorded before such paths were refused.
        write_access_file(
            &temp.data().join(ACCESS_FILE),
            std::slice::from_ref(&climbing),
        )
        .unwrap();
        let restarted = ExportImageAccess::load(Some(&temp.data()));
        assert_eq!(
            restarted.approve(&climbing, never_in_scope),
            Err(NOT_CHOSEN.into())
        );
    }

    #[test]
    fn takes_on_the_images_of_older_profiles_only_once() {
        let temp = TempDir::new("adopt");
        let logo = temp.image("logo.png");
        let footer = temp.image("footer.png");
        let planted = temp.image("planted.png");

        let access = ExportImageAccess::load(Some(&temp.data()));
        assert!(access.adopt(&[
            format!(" {logo} "),
            String::new(),
            "data:image/png;base64,abc".into()
        ]));
        assert!(!access.adopt(std::slice::from_ref(&planted)));
        access.approve(&logo, never_in_scope).unwrap();
        assert!(access.approve(&planted, never_in_scope).is_err());

        // After a restart the list exists, so it can't be added to this way.
        let restarted = ExportImageAccess::load(Some(&temp.data()));
        assert!(!restarted.adopt(&[footer.clone(), planted.clone()]));
        restarted.approve(&logo, never_in_scope).unwrap();
        assert!(restarted.approve(&footer, never_in_scope).is_err());
        assert!(restarted.approve(&planted, never_in_scope).is_err());
    }

    #[test]
    fn an_empty_first_adopt_still_closes_it() {
        let temp = TempDir::new("adopt-empty");
        let planted = temp.image("planted.png");

        assert!(ExportImageAccess::load(Some(&temp.data())).adopt(&[]));

        let restarted = ExportImageAccess::load(Some(&temp.data()));
        assert!(!restarted.adopt(std::slice::from_ref(&planted)));
        assert!(restarted.approve(&planted, never_in_scope).is_err());
    }

    #[test]
    fn an_image_picked_before_the_first_adopt_does_not_close_it() {
        let temp = TempDir::new("adopt-after-pick");
        let picked = temp.image("picked.png");
        let older = temp.image("older.png");

        let access = ExportImageAccess::load(Some(&temp.data()));
        access
            .approve(&picked, |path| path == Path::new(&picked))
            .unwrap();
        assert!(access.adopt(std::slice::from_ref(&older)));

        let restarted = ExportImageAccess::load(Some(&temp.data()));
        restarted.approve(&picked, never_in_scope).unwrap();
        restarted.approve(&older, never_in_scope).unwrap();
    }

    /// A JSON object such as `{"images": [...]}`: the only shape the store
    /// plugin can write, so a webview script can't plant an image this way.
    #[test]
    fn a_list_written_through_the_store_plugin_unlocks_nothing() {
        let temp = TempDir::new("forged");
        let planted = temp.image("planted.png");
        std::fs::create_dir_all(temp.data()).unwrap();
        std::fs::write(
            temp.data().join(ACCESS_FILE),
            serde_json::to_vec(&serde_json::json!({ "images": [planted] })).unwrap(),
        )
        .unwrap();

        let access = ExportImageAccess::load(Some(&temp.data()));
        assert!(access.approve(&planted, never_in_scope).is_err());
        // Nor does it reopen the one-time adopt.
        assert!(!access.adopt(std::slice::from_ref(&planted)));
        assert!(access.approve(&planted, never_in_scope).is_err());
        assert_eq!(
            read_access_file(&temp.data().join(ACCESS_FILE)).unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn reading_a_listed_image_again_does_not_rewrite_the_list() {
        let temp = TempDir::new("no-rewrite");
        let first = temp.image("first.png");
        let second = temp.image("second.png");
        let access = ExportImageAccess::load(Some(&temp.data()));
        access.approve(&first, |_| true).unwrap();
        access.approve(&second, |_| true).unwrap();
        let file = temp.data().join(ACCESS_FILE);
        let before = std::fs::read(&file).unwrap();

        access.approve(&first, |_| true).unwrap();

        assert_eq!(std::fs::read(&file).unwrap(), before);
    }

    #[test]
    fn keeps_the_newest_images_when_the_list_is_full() {
        let access = ExportImageAccess::default();
        let dir = std::env::temp_dir();
        for i in 0..MAX_ENTRIES + 5 {
            let path = dir.join(format!("missing-image-{i}.png"));
            assert!(access.remember(&path.to_string_lossy(), |_| true));
        }
        let images = access.images.lock().unwrap();
        assert_eq!(images.len(), MAX_ENTRIES);
        assert!(images[0].ends_with(&format!("missing-image-{}.png", MAX_ENTRIES + 4)));
    }
}
