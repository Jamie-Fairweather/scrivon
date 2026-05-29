#[cfg(windows)]
async fn export_html_to_pdf_impl(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    use std::sync::mpsc::sync_channel;
    use std::time::Duration;

    use tauri::webview::{PlatformWebview, WebviewWindowBuilder};
    use tauri::utils::config::WebviewUrl;
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

    let path = output_path;
    let (tx, rx) = sync_channel::<Result<(), String>>(1);

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

                    // WebView2 margins are in inches; default (~1") is much wider than our @page CSS.
                    const MARGIN_MM: f64 = 10.0;
                    const MARGIN_IN: f64 = MARGIN_MM / 25.4;

                    let print_settings = webview
                        .environment()
                        .cast::<ICoreWebView2Environment6>()
                        .map_err(|_| {
                            "WebView2 on this system does not support print settings.".to_string()
                        })?
                        .CreatePrintSettings()
                        .map_err(|e| e.to_string())?;

                    print_settings
                        .SetMarginTop(MARGIN_IN)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginBottom(MARGIN_IN)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginLeft(MARGIN_IN)
                        .map_err(|e| e.to_string())?;
                    print_settings
                        .SetMarginRight(MARGIN_IN)
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

    window.close().ok();

    rx.recv()
        .map_err(|_| "PDF export failed.".to_string())?
}

#[cfg(not(windows))]
async fn export_html_to_pdf_impl(
    _app: tauri::AppHandle,
    _html: String,
    _output_path: String,
) -> Result<(), String> {
    Err("Direct PDF save is only available on Windows.".into())
}

#[tauri::command]
pub async fn export_html_to_pdf(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
) -> Result<(), String> {
    export_html_to_pdf_impl(app, html, output_path).await
}
