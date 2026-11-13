//! A throwaway PDF of the export, for the preview in the export dialog. It is
//! printed and numbered by the same code as a real export, then read back and
//! deleted.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Serialize;

use super::PdfPrintOptions;

/// The folder in the system temp folder that preview PDFs are printed into.
const PREVIEW_FOLDER: &str = "scrivon-pdf-preview";
/// A preview PDF this old was left by an app that closed mid-preview.
const STALE_AFTER: Duration = Duration::from_secs(10 * 60);

/// The numbered PDF, base64, and why its page numbers were left out, if they were.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PdfPreview {
    pdf: String,
    page_number_warning: Option<String>,
}

/// Prints `html` to a temporary PDF the way `export_html_to_pdf` does, page
/// numbers included, and hands it back. The file is deleted once read.
#[tauri::command]
pub async fn preview_html_pdf(
    app: tauri::AppHandle,
    html: String,
    options: PdfPrintOptions,
) -> Result<PdfPreview, String> {
    let dir = std::env::temp_dir().join(PREVIEW_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't make the preview: {e}"))?;
    remove_stale_previews(&dir, STALE_AFTER);
    let path = new_preview_path(&dir);
    let printed =
        super::export_html_to_pdf_impl(app, html, path.to_string_lossy().into_owned(), options)
            .await;
    take_preview(&path, printed)
}

/// A new, unused PDF path in `dir`.
fn new_preview_path(dir: &Path) -> PathBuf {
    dir.join(format!("preview-{}.pdf", uuid::Uuid::new_v4().simple()))
}

/// Deletes the PDFs in `dir` older than `older_than`. Newer ones may belong
/// to a preview still being made.
fn remove_stale_previews(dir: &Path, older_than: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_pdf = path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= older_than);
        if is_pdf && stale {
            let _ = std::fs::remove_file(path);
        }
    }
}

/// Reads the PDF the preview printed to `path`, then deletes it, whether or
/// not printing worked.
fn take_preview(
    path: &Path,
    printed: Result<Option<String>, String>,
) -> Result<PdfPreview, String> {
    let read = printed.and_then(|warning| {
        let bytes = std::fs::read(path).map_err(|e| format!("Couldn't read the preview: {e}"))?;
        Ok(PdfPreview {
            pdf: base64::engine::general_purpose::STANDARD.encode(bytes),
            page_number_warning: warning,
        })
    });
    let _ = std::fs::remove_file(path);
    read
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, SystemTime};

    use super::{new_preview_path, remove_stale_previews, take_preview, PdfPreview};

    fn temp_folder() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("scrivon-preview-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn files_in(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn gives_each_preview_its_own_pdf_in_the_folder() {
        let dir = std::env::temp_dir();
        let first = new_preview_path(&dir);
        assert_eq!(first.parent(), Some(dir.as_path()));
        assert_eq!(first.extension().unwrap(), "pdf");
        assert_ne!(first, new_preview_path(&dir));
    }

    #[test]
    fn hands_back_the_pdf_and_deletes_it() {
        let dir = temp_folder();
        let path = new_preview_path(&dir);
        std::fs::write(&path, b"%PDF-1.7").unwrap();

        let preview = take_preview(&path, Ok(Some("No footer.".into())));

        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            preview,
            Ok(PdfPreview {
                pdf: "JVBERi0xLjc=".into(),
                page_number_warning: Some("No footer.".into()),
            })
        );
        assert!(names.is_empty(), "the preview PDF was left behind");
    }

    #[test]
    fn deletes_whatever_a_failed_preview_left() {
        let dir = temp_folder();
        let path = new_preview_path(&dir);
        std::fs::write(&path, b"%PDF-1.7 half written").unwrap();

        let preview = take_preview(&path, Err("Creating the PDF took too long.".into()));

        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(preview, Err("Creating the PDF took too long.".into()));
        assert!(names.is_empty(), "the preview PDF was left behind");
    }

    #[test]
    fn says_so_when_the_printed_pdf_is_missing() {
        let dir = temp_folder();
        let preview = take_preview(&new_preview_path(&dir), Ok(None));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(preview.unwrap_err().contains("preview"));
    }

    #[test]
    fn removes_old_previews_left_by_a_closed_app_but_not_new_ones() {
        let dir = temp_folder();
        let old = new_preview_path(&dir);
        let new = new_preview_path(&dir);
        let not_ours = dir.join("notes.txt");
        for path in [&old, &new, &not_ours] {
            std::fs::write(path, b"x").unwrap();
        }
        let an_hour_ago = SystemTime::now() - Duration::from_secs(60 * 60);
        for path in [&old, &not_ours] {
            let file = std::fs::File::options().write(true).open(path).unwrap();
            file.set_modified(an_hour_ago).unwrap();
        }

        remove_stale_previews(&dir, Duration::from_secs(10 * 60));

        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        let new_name = new.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(names, ["notes.txt".into(), new_name]);
    }

    #[test]
    fn copes_with_a_missing_preview_folder() {
        let missing = std::env::temp_dir().join(format!("scrivon-gone-{}", uuid::Uuid::new_v4()));
        remove_stale_previews(&missing, Duration::ZERO);
        assert!(!missing.exists());
    }
}
