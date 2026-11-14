//! Removes the update installers the updater left in the temp folder (F50).
//!
//! Before an update, tauri-plugin-updater saves the installer in a new folder
//! in %TEMP% named `<product>-<version>-updater-<random>`, starts it and exits
//! the app straight away, so nothing ever removed it. Each update left about
//! 13 MB behind. The app now clears these folders when it starts.
//!
//! The installer that has just started this copy may still be running from its
//! folder. That one can't be removed yet and stays until the next start.

use std::fs;
use std::path::Path;

/// Clears old update downloads off the main thread, so a big temp folder
/// never holds up startup.
pub fn remove_old_later(product: &str) {
    let product = product.to_owned();
    std::thread::spawn(move || remove_old(&std::env::temp_dir(), &product));
}

/// Removes the updater's folders from `temp` and returns how many went.
/// Anything else, a link to a folder included, is left alone.
fn remove_old(temp: &Path, product: &str) -> usize {
    let Ok(entries) = fs::read_dir(temp) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|entry| is_update_download(&entry.file_name().to_string_lossy(), product))
        .filter(|entry| fs::remove_dir_all(entry.path()).is_ok())
        .count()
}

/// True for `<product>-<version>-updater-<random>`.
fn is_update_download(name: &str, product: &str) -> bool {
    name.strip_prefix(product)
        .and_then(|rest| rest.strip_prefix('-'))
        .and_then(|rest| rest.split_once("-updater-"))
        .is_some_and(|(version, random)| !version.is_empty() && !random.is_empty())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::remove_old;

    fn temp_folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scrivon-updates-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A folder the way tauri-plugin-updater makes one, with its installer in it.
    fn download(temp: &Path, name: &str) -> PathBuf {
        let folder = temp.join(name);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("Scrivon-1.5.0-installer.exe"), b"MZ").unwrap();
        folder
    }

    #[test]
    fn removes_the_folders_the_updater_left_behind() {
        let temp = temp_folder();
        let stable = download(&temp, "Scrivon-1.5.0-updater-a1b2c3");
        let rc = download(&temp, "Scrivon-1.6.0-rc.1-updater-XyZ789");

        assert_eq!(remove_old(&temp, "Scrivon"), 2);

        assert!(!stable.exists());
        assert!(!rc.exists());
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn leaves_everything_else_in_the_temp_folder_alone() {
        let temp = temp_folder();
        let kept = [
            download(&temp, "Other App-2.0.0-updater-a1b2c3"),
            download(&temp, "Scrivon-notes"),
            download(&temp, "Scrivon-updater-a1b2c3"),
            download(&temp, "scrivon-update-1234"),
        ];
        let file = temp.join("Scrivon-1.5.0-updater-file");
        fs::write(&file, b"not a folder").unwrap();

        assert_eq!(remove_old(&temp, "Scrivon"), 0);

        for folder in &kept {
            assert!(
                folder.join("Scrivon-1.5.0-installer.exe").exists(),
                "{folder:?}"
            );
        }
        assert!(file.exists());
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn does_nothing_when_the_temp_folder_is_missing() {
        let missing = std::env::temp_dir().join(format!("scrivon-none-{}", uuid::Uuid::new_v4()));
        assert_eq!(remove_old(&missing, "Scrivon"), 0);
    }
}
