//! A copy of the settings in `settings.json`, in the app's data folder (F23).
//!
//! Settings and export profiles live in the page's localStorage, inside the
//! WebView2 profile in the local app data folder. Clearing that (a common fix
//! for display glitches) wipes them. So the page also saves them here each time
//! they change (lib/settings/settings-file.ts). When the window opens with no
//! settings in localStorage, a script that runs before the page puts this copy
//! back (`restore_script`), so the theme and everything else load as before.

use std::fs;
use std::path::Path;

use tauri::Manager;

use crate::atomic_write;

const FILE_NAME: &str = "settings.json";
/// Where the page keeps its settings (SETTINGS_STORAGE_KEY in lib/settings/types.ts).
const STORAGE_KEY: &str = "scrivon-settings:v1";
/// Export profiles can hold embedded images, so settings can be a few MB.
/// Anything far bigger isn't settings.
const MAX_BYTES: usize = 32 * 1024 * 1024;

/// Saves the page's settings to `settings.json`. Only a JSON object is taken,
/// and only to that one file.
#[tauri::command]
pub async fn save_settings_file(app: tauri::AppHandle, text: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    tauri::async_runtime::spawn_blocking(move || save_in(&dir, &text))
        .await
        .map_err(|err| err.to_string())?
}

fn save_in(dir: &Path, text: &str) -> Result<(), String> {
    if !is_settings(text) {
        return Err("Scrivon can only keep settings here.".into());
    }
    fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    atomic_write::save(&dir.join(FILE_NAME), text.as_bytes()).map_err(|err| err.to_string())
}

/// True for a JSON object no bigger than MAX_BYTES, which is what the page saves.
fn is_settings(text: &str) -> bool {
    text.len() <= MAX_BYTES
        && serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(text).is_ok()
}

/// A script for the window that puts the saved copy back into localStorage
/// when that has no settings, before the page reads them. It does nothing when
/// settings are there. None when there's no usable copy.
pub fn restore_script(data_dir: Option<&Path>) -> Option<String> {
    let text = fs::read_to_string(data_dir?.join(FILE_NAME)).ok()?;
    // Notepad can add a byte order mark when the file is edited by hand.
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    if !is_settings(text) {
        return None;
    }
    // JSON strings are JavaScript strings too, so these can't break out of the script.
    let key = serde_json::to_string(STORAGE_KEY).ok()?;
    let copy = serde_json::to_string(text).ok()?;
    Some(format!(
        "(function(){{try{{if(window!==window.top)return;var key={key};if(localStorage.getItem(key)===null)localStorage.setItem(key,{copy});}}catch(e){{}}}})();"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir()
                .join(format!("scrivon-settings-file-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }

        fn file(&self) -> PathBuf {
            self.0.join(FILE_NAME)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// The text the script stores, read back out of it.
    fn stored_by(script: &str) -> String {
        let start = script.find("setItem(key,").unwrap() + "setItem(key,".len();
        let end = script.rfind(");}catch").unwrap();
        serde_json::from_str(&script[start..end]).unwrap()
    }

    #[test]
    fn settings_are_saved_and_replaced() {
        let dir = TempDir::new();
        save_in(&dir.0, r#"{"theme":{"id":"scrivon-light"}}"#).unwrap();
        save_in(&dir.0, r#"{"theme":{"id":"scrivon-dark"}}"#).unwrap();

        assert_eq!(
            fs::read_to_string(dir.file()).unwrap(),
            r#"{"theme":{"id":"scrivon-dark"}}"#
        );
    }

    #[test]
    fn the_data_folder_is_made_when_missing() {
        let dir = TempDir::new();
        let nested = dir.0.join("io.github.jamie-fairweather.scrivon");

        save_in(&nested, "{}").unwrap();

        assert!(nested.join(FILE_NAME).is_file());
    }

    #[test]
    fn anything_but_a_json_object_is_refused_and_the_copy_kept() {
        let dir = TempDir::new();
        save_in(&dir.0, r#"{"a":1}"#).unwrap();

        for text in ["", "not json", "[1,2]", "\"text\"", "null", "{\"a\":"] {
            assert!(save_in(&dir.0, text).is_err(), "{text}");
        }
        let too_big = format!(r#"{{"a":"{}"}}"#, "x".repeat(MAX_BYTES));
        assert!(save_in(&dir.0, &too_big).is_err());

        assert_eq!(fs::read_to_string(dir.file()).unwrap(), r#"{"a":1}"#);
    }

    #[test]
    fn the_script_puts_the_saved_copy_back_only_when_storage_has_none() {
        let dir = TempDir::new();
        let text = "{\n  \"theme\": {\"id\": \"scrivon-light\"},\n  \"note\": \"</script> \\\" ' \\\\ \u{2028}\"\n}";
        fs::write(dir.file(), text).unwrap();

        let script = restore_script(Some(&dir.0)).unwrap();

        assert!(script.contains(r#"var key="scrivon-settings:v1";"#));
        assert!(script.contains("if(localStorage.getItem(key)===null)"));
        assert!(script.contains("if(window!==window.top)return;"));
        assert_eq!(stored_by(&script), text);
    }

    #[test]
    fn a_byte_order_mark_is_left_out() {
        let dir = TempDir::new();
        fs::write(dir.file(), "\u{feff}{\"a\":1}").unwrap();

        assert_eq!(
            stored_by(&restore_script(Some(&dir.0)).unwrap()),
            r#"{"a":1}"#
        );
    }

    #[test]
    fn there_is_no_script_without_a_usable_copy() {
        let dir = TempDir::new();
        assert_eq!(restore_script(None), None);
        assert_eq!(restore_script(Some(&dir.0)), None);

        for damaged in ["", "\0\0\0", "[]", "{\"a\":"] {
            fs::write(dir.file(), damaged).unwrap();
            assert_eq!(restore_script(Some(&dir.0)), None, "{damaged:?}");
        }
    }

    #[test]
    fn the_storage_key_matches_the_page() {
        let types = include_str!("../../lib/settings/types.ts");
        assert!(types.contains(&format!("SETTINGS_STORAGE_KEY = '{STORAGE_KEY}'")));
    }
}
