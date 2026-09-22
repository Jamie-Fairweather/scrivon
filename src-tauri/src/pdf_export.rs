#[cfg(windows)]
async fn export_html_to_pdf_impl(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    page_width_mm: f64,
    page_height_mm: f64,
    landscape: bool,
    margin_top_mm: f64,
    margin_right_mm: f64,
    margin_bottom_mm: f64,
    margin_left_mm: f64,
    page_number_format: String,
    page_number_color: String,
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
                        .SetPageWidth(page_width_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetPageHeight(page_height_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetOrientation(if landscape {
                            COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                        } else {
                            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                        })
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginTop(margin_top_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginBottom(margin_bottom_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginLeft(margin_left_mm / 25.4)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginRight(margin_right_mm / 25.4)
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
    crate::page_numbers::stamp_page_numbers(
        &output_path,
        &page_number_format,
        &page_number_color,
        margin_right_mm,
        margin_bottom_mm,
    )
}

#[cfg(not(windows))]
async fn export_html_to_pdf_impl(
    _app: tauri::AppHandle,
    _html: String,
    _output_path: String,
    _page_width_mm: f64,
    _page_height_mm: f64,
    _landscape: bool,
    _margin_top_mm: f64,
    _margin_right_mm: f64,
    _margin_bottom_mm: f64,
    _margin_left_mm: f64,
    _page_number_format: String,
    _page_number_color: String,
) -> Result<(), String> {
    Err("Direct PDF save is only available on Windows.".into())
}

const MAX_EXPORT_IMAGE_BYTES: usize = 12 * 1024 * 1024;

fn mime_from_path(path: &str) -> &'static str {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i];
        let b1 = if i + 1 < data.len() { data[i + 1] } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] } else { 0 };
        out.push(CHARS[(b0 >> 2) as usize] as char);
        out.push(CHARS[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if i + 1 < data.len() {
            out.push(CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < data.len() {
            out.push(CHARS[(b2 & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

/// Read a user-chosen export image without the JS FS plugin scope (survives restarts / Drive paths).
#[tauri::command]
pub fn read_export_image(path: String) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Image path is empty.".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read image: {e}"))?;
    if bytes.len() > MAX_EXPORT_IMAGE_BYTES {
        return Err("Image is too large to embed in the PDF.".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        mime_from_path(path),
        base64_encode(&bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::{base64_encode, mime_from_path, read_export_image};

    #[test]
    fn encodes_known_base64() {
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"M"), "TQ==");
    }

    #[test]
    fn maps_image_mime_types() {
        assert_eq!(
            mime_from_path(r"G:\My Drive\Pictures\coffee\Untitled.png"),
            "image/png"
        );
        assert_eq!(mime_from_path("logo.JPEG"), "image/jpeg");
        assert_eq!(mime_from_path("mark.svg"), "image/svg+xml");
    }

    #[test]
    fn reads_a_real_file_as_data_url() {
        let dir = std::env::temp_dir();
        let path = dir.join("scrivon-export-image-test.png");
        std::fs::write(&path, [0x89, 0x50, 0x4E, 0x47]).unwrap();
        let url = read_export_image(path.to_string_lossy().into_owned()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        let _ = std::fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn export_html_to_pdf(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    page_width_mm: f64,
    page_height_mm: f64,
    landscape: bool,
    margin_top_mm: f64,
    margin_right_mm: f64,
    margin_bottom_mm: f64,
    margin_left_mm: f64,
    page_number_format: String,
    page_number_color: String,
) -> Result<(), String> {
    export_html_to_pdf_impl(
        app,
        html,
        output_path,
        page_width_mm,
        page_height_mm,
        landscape,
        margin_top_mm,
        margin_right_mm,
        margin_bottom_mm,
        margin_left_mm,
        page_number_format,
        page_number_color,
    )
    .await
}
