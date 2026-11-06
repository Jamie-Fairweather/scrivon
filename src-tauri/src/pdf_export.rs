use std::path::Path;

use base64::Engine;
use serde::Deserialize;
use tauri_plugin_fs::FsExt;

/// Print-engine settings that accompany the export HTML. Mirrors
/// `PdfPrintOptions` in `lib/settings/pdf-export-types.ts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPrintOptions {
    /// Portrait sheet size; `landscape` rotates it.
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    pub landscape: bool,
    pub margin_top_mm: f64,
    pub margin_right_mm: f64,
    pub margin_bottom_mm: f64,
    pub margin_left_mm: f64,
    /// Stamper format: a preset name, `custom:<template>`, or `none`.
    pub page_number_format: String,
    /// Hex colour for the stamped label; empty for the default chrome colour.
    pub page_number_color: String,
}

#[cfg(windows)]
async fn export_html_to_pdf_impl(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    options: PdfPrintOptions,
) -> Result<(), String> {
    use std::time::Duration;

    use tauri::utils::config::WebviewUrl;
    use tauri::webview::{PlatformWebview, WebviewWindowBuilder};
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, PrintToPdfCompletedHandler};
    use windows_core::{Interface, HSTRING};

    let label = format!("pdf-export-{}", uuid::Uuid::new_v4());
    let html_json = serde_json::to_string(&html).map_err(|e| e.to_string())?;

    let window = WebviewWindowBuilder::new(
        &app,
        &label,
        WebviewUrl::External(
            "about:blank"
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?,
        ),
    )
    .visible(false)
    .inner_size(794.0, 1123.0)
    .build()
    .map_err(|e| e.to_string())?;

    let script = format!("document.open();document.write({html_json});document.close();");
    window.eval(&script).map_err(|e| e.to_string())?;

    tokio::time::sleep(Duration::from_millis(1200)).await;

    let path = output_path.clone();
    let print = options.clone();
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();

    window
        .with_webview(move |webview: PlatformWebview| {
            let result = (|| -> Result<(), String> {
                unsafe {
                    let core = webview
                        .controller()
                        .CoreWebView2()
                        .map_err(|e| e.to_string())?
                        .cast::<ICoreWebView2_7>()
                        .map_err(|_| {
                            "WebView2 on this system does not support PDF export.".to_string()
                        })?;

                    let path_h = HSTRING::from(&path);

                    let print_settings = webview
                        .environment()
                        .cast::<ICoreWebView2Environment6>()
                        .map_err(|_| {
                            "WebView2 on this system does not support print settings.".to_string()
                        })?
                        .CreatePrintSettings()
                        .map_err(|e| e.to_string())?;

                    // The sheet must match the CSS `@page` size. WebView2 defaults to
                    // Letter, and Chromium scales a mismatched CSS page to fit the sheet
                    // and centres it, which leaves side gaps on anything meant to bleed.
                    // Width/height are the portrait sheet; orientation rotates it.
                    print_settings
                        .SetPageWidth(print.page_width_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetPageHeight(print.page_height_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetOrientation(if print.landscape {
                            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                        } else {
                            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                        })
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginTop(print.margin_top_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginBottom(print.margin_bottom_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginLeft(print.margin_left_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginRight(print.margin_right_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetShouldPrintBackgrounds(true.into())
                        .map_err(|e| e.to_string())?;

                    PrintToPdfCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| {
                            core.PrintToPdf(&path_h, &print_settings, &handler)
                                .map_err(webview2_com::Error::WindowsError)
                        }),
                        Box::new(move |hr, success| {
                            hr?;
                            if success {
                                Ok(())
                            } else {
                                Err(windows_core::Error::new(
                                    windows_core::HRESULT(0x80004004u32 as i32),
                                    "PDF export was cancelled.",
                                ))
                            }
                        }),
                    )
                    .map_err(|e| e.to_string())
                }
            })();

            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    let result = rx.await.map_err(|_| "PDF export failed.".to_string())?;

    window.close().ok();

    result?;
    crate::page_numbers::stamp_page_numbers(&output_path, &options)
}

#[cfg(not(windows))]
async fn export_html_to_pdf_impl(
    _app: tauri::AppHandle,
    _html: String,
    _output_path: String,
    _options: PdfPrintOptions,
) -> Result<(), String> {
    Err("Direct PDF save is only available on Windows.".into())
}

/// Only writes to a `.pdf` file the user chose in the save dialog, which adds
/// the chosen file to the fs scope. Otherwise any script in the webview could
/// write (and rewrite) a file anywhere on disk.
fn check_output_path(path: &str, in_scope: impl Fn(&Path) -> bool) -> Result<(), String> {
    let output = Path::new(path);
    let is_pdf = output
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("The PDF file name must end in .pdf.".into());
    }
    if !output.is_absolute() || !in_scope(output) {
        return Err(
            "Scrivon can only save the PDF to a place you choose in the Save dialog.".into(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn export_html_to_pdf(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    options: PdfPrintOptions,
) -> Result<(), String> {
    let scope = app.fs_scope();
    check_output_path(&output_path, |path| scope.is_allowed(path))?;
    export_html_to_pdf_impl(app, html, output_path, options).await
}

const MAX_EXPORT_IMAGE_BYTES: usize = 12 * 1024 * 1024;

/// The image type for an export image path, or `None` for anything else.
fn mime_from_path(path: &str) -> Option<&'static str> {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        Some("image/png")
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        Some("image/jpeg")
    } else if lower.ends_with(".gif") {
        Some("image/gif")
    } else if lower.ends_with(".webp") {
        Some("image/webp")
    } else if lower.ends_with(".svg") {
        Some("image/svg+xml")
    } else {
        None
    }
}

/// True when the file's first bytes match its image type, so a renamed text
/// file (a key, a config file) is never handed back.
fn content_matches(mime: &str, bytes: &[u8]) -> bool {
    match mime {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP",
        "image/svg+xml" => {
            let text = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
            let start = text.iter().position(|b| !b.is_ascii_whitespace());
            start.is_some_and(|i| text[i] == b'<')
                && text
                    .windows(4)
                    .any(|window| window.eq_ignore_ascii_case(b"<svg"))
        }
        _ => false,
    }
}

/// Read a user-chosen export image. Image paths are saved in PDF profiles and
/// must keep working after a restart, so this doesn't use the fs scope; instead
/// it only returns real image files (PNG, JPEG, GIF, WebP or SVG).
#[tauri::command]
pub fn read_export_image(path: String) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Image path is empty.".into());
    }
    let mime = mime_from_path(path)
        .ok_or_else(|| "Only PNG, JPEG, GIF, WebP and SVG images can be used.".to_string())?;
    let size = std::fs::metadata(path)
        .map_err(|e| format!("Could not read image: {e}"))?
        .len();
    if size > MAX_EXPORT_IMAGE_BYTES as u64 {
        return Err("Image is too large to embed in the PDF.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read image: {e}"))?;
    if bytes.len() > MAX_EXPORT_IMAGE_BYTES {
        return Err("Image is too large to embed in the PDF.".into());
    }
    if !content_matches(mime, &bytes) {
        return Err("This file isn't a valid image.".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::{check_output_path, mime_from_path, read_export_image, PdfPrintOptions};

    #[test]
    fn deserializes_camel_case_options_from_the_frontend() {
        let options: PdfPrintOptions = serde_json::from_str(
            r##"{"pageWidthMm":210,"pageHeightMm":297,"landscape":true,"marginTopMm":10,"marginRightMm":0,"marginBottomMm":10,"marginLeftMm":0,"pageNumberFormat":"page-n","pageNumberColor":"#ff0000"}"##,
        )
        .unwrap();
        assert!(options.landscape);
        assert_eq!(options.page_width_mm, 210.0);
        assert_eq!(options.margin_right_mm, 0.0);
        assert_eq!(options.page_number_format, "page-n");
        assert_eq!(options.page_number_color, "#ff0000");
    }

    #[test]
    fn maps_image_mime_types() {
        assert_eq!(
            mime_from_path(r"G:\My Drive\Pictures\coffee\Untitled.png"),
            Some("image/png")
        );
        assert_eq!(mime_from_path("logo.JPEG"), Some("image/jpeg"));
        assert_eq!(mime_from_path("mark.svg"), Some("image/svg+xml"));
        assert_eq!(mime_from_path(r"C:\Users\me\.ssh\id_ed25519"), None);
    }

    fn temp_file(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("scrivon-{}-{name}", uuid::Uuid::new_v4()));
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn read(path: &std::path::Path) -> Result<String, String> {
        let result = read_export_image(path.to_string_lossy().into_owned());
        let _ = std::fs::remove_file(path);
        result
    }

    #[test]
    fn reads_a_real_file_as_data_url() {
        let path = temp_file("image.png", b"\x89PNG\r\n\x1a\n");
        assert_eq!(read(&path).unwrap(), "data:image/png;base64,iVBORw0KGgo=");
    }

    #[test]
    fn reads_an_svg_with_a_prolog() {
        let svg = b"\xEF\xBB\xBF\n<?xml version=\"1.0\"?>\n<!-- logo -->\n<SVG xmlns=\"http://www.w3.org/2000/svg\"/>";
        let path = temp_file("mark.svg", svg);
        assert!(read(&path)
            .unwrap()
            .starts_with("data:image/svg+xml;base64,"));
    }

    #[test]
    fn refuses_files_that_are_not_images() {
        let key = temp_file("id_ed25519", b"-----BEGIN OPENSSH PRIVATE KEY-----");
        assert!(read(&key).unwrap_err().contains("PNG, JPEG"));

        let renamed = temp_file("secrets.png", b"-----BEGIN OPENSSH PRIVATE KEY-----");
        assert_eq!(
            read(&renamed).unwrap_err(),
            "This file isn't a valid image."
        );

        let text_svg = temp_file("notes.svg", b"password=hunter2");
        assert!(read(&text_svg).is_err());
    }

    #[test]
    fn pdf_output_must_be_a_pdf_the_user_chose() {
        let chosen = std::env::temp_dir().join("Report.PDF");
        let chosen = chosen.to_string_lossy().into_owned();
        assert!(check_output_path(&chosen, |_| true).is_ok());
        assert!(check_output_path(&chosen, |_| false)
            .unwrap_err()
            .contains("Save dialog"));

        let script = std::env::temp_dir().join("startup.cmd");
        let script = script.to_string_lossy().into_owned();
        assert!(check_output_path(&script, |_| true)
            .unwrap_err()
            .contains(".pdf"));
        assert!(check_output_path("relative.pdf", |_| true).is_err());
    }
}
