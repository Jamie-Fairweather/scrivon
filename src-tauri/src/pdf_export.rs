use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use tauri_plugin_fs::FsExt;

use crate::page_numbers::Stamped;

mod export_image_access;

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
    /// Saved in the PDF's document properties; left out when empty.
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub subject: String,
}

/// How long to wait for the export page's images and web fonts before
/// printing it anyway.
#[cfg(windows)]
const READY_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(windows)]
const READY_POLL: Duration = Duration::from_millis(100);
/// How often the HTML is written again if the page turns up empty.
const MAX_REWRITES: usize = 3;
/// PrintToPdf has no time limit of its own.
#[cfg(windows)]
const PRINT_TIMEOUT: Duration = Duration::from_secs(120);

/// Run after the export HTML is written: `"empty"` if the written HTML was
/// lost, `"ready"` once the page and its images have loaded and its web fonts
/// are in, else `"waiting"`. Reading `offsetHeight` lays the page out, which
/// starts loading the fonts it uses.
#[cfg(windows)]
const READY_CHECK: &str = r#"(() => {
  if (window.__scrivonExportWritten !== true) return 'empty';
  if (!window.__scrivonExportFonts) {
    window.__scrivonExportFonts = 'loading';
    void document.documentElement.offsetHeight;
    const done = () => { window.__scrivonExportFonts = 'ready'; };
    document.fonts.ready.then(done, done);
  }
  return document.readyState === 'complete' && window.__scrivonExportFonts === 'ready' ? 'ready' : 'waiting';
})()"#;

/// The hidden window the export prints from. It's closed when dropped, so an
/// early return doesn't leave it running in the background.
#[cfg(windows)]
struct ExportWindow(tauri::WebviewWindow);

#[cfg(windows)]
impl std::ops::Deref for ExportWindow {
    type Target = tauri::WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(windows)]
impl Drop for ExportWindow {
    fn drop(&mut self) {
        self.0.close().ok();
    }
}

/// Asks the page for its `READY_CHECK` status. `None` if it doesn't answer.
#[cfg(windows)]
async fn page_status(window: &tauri::WebviewWindow) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = std::sync::Mutex::new(Some(tx));
    window
        .eval_with_callback(READY_CHECK, move |result| {
            if let Some(tx) = tx.lock().ok().and_then(|mut tx| tx.take()) {
                let _ = tx.send(result);
            }
        })
        .ok()?;
    let result = tokio::time::timeout(Duration::from_secs(2), rx)
        .await
        .ok()?
        .ok()?;
    serde_json::from_str(&result).ok()
}

/// How waiting for the export page ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
enum PageReadiness {
    Ready,
    /// Still loading images or fonts when time ran out: printed as it is.
    TimedOut,
    /// The HTML never stayed written, so there's nothing to print.
    NeverWritten,
}

/// Polls `status` until the page is ready to print, writing the HTML again
/// with `rewrite` if the page turns up empty. Stops waiting after `limit`.
#[cfg_attr(not(windows), allow(dead_code))]
async fn wait_until_ready<F, Fut>(
    mut status: F,
    mut rewrite: impl FnMut(),
    limit: Duration,
    every: Duration,
) -> PageReadiness
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<String>>,
{
    let deadline = tokio::time::Instant::now() + limit;
    let mut rewrites = 0;
    // What the page last said was "empty".
    let mut empty = false;
    loop {
        match status().await.as_deref() {
            Some("ready") => return PageReadiness::Ready,
            Some("empty") => {
                if rewrites == MAX_REWRITES {
                    return PageReadiness::NeverWritten;
                }
                rewrites += 1;
                rewrite();
                empty = true;
            }
            Some(_) => empty = false,
            None => {}
        }
        if tokio::time::Instant::now() + every > deadline {
            return if empty {
                PageReadiness::NeverWritten
            } else {
                PageReadiness::TimedOut
            };
        }
        tokio::time::sleep(every).await;
    }
}

#[cfg(windows)]
async fn export_html_to_pdf_impl(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    options: PdfPrintOptions,
) -> Result<Option<String>, String> {
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
    let window = ExportWindow(window);

    let script = format!(
        "document.open();document.write({html_json});document.close();\
         window.__scrivonExportWritten=true;"
    );
    window.eval(&script).map_err(|e| e.to_string())?;

    // Print once the page's images and fonts are in, not after a fixed wait.
    let readiness = wait_until_ready(
        || page_status(&window),
        || {
            let _ = window.eval(&script);
        },
        READY_TIMEOUT,
        READY_POLL,
    )
    .await;
    match readiness {
        PageReadiness::Ready => {}
        PageReadiness::TimedOut => eprintln!(
            "PDF export: the page wasn't ready after {READY_TIMEOUT:?}; printing it anyway."
        ),
        // Printing now would replace the chosen file with a blank page.
        PageReadiness::NeverWritten => {
            return Err("Couldn't prepare the PDF. Try exporting again.".into())
        }
    }

    // Print next to the chosen file, not over it: the page numbers are added to
    // a copy, and the chosen file is only replaced once there's a whole PDF.
    let printed = temp_sibling(Path::new(&output_path));
    let path_h = HSTRING::from(printed.as_path());
    let could_not_save = could_not_save_message(&output_path);
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
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|e| e.to_string())?;

                    PrintToPdfCompletedHandler::wait_for_async_operation(
                        Box::new(move |handler| {
                            core.PrintToPdf(&path_h, &print_settings, &handler)
                                .map_err(webview2_com::Error::WindowsError)
                        }),
                        // Nothing can cancel this print, so a failure means the
                        // file couldn't be written (often: it's open elsewhere).
                        Box::new(move |hr, success| {
                            hr?;
                            if success {
                                Ok(())
                            } else {
                                Err(windows_core::Error::new(
                                    windows_core::HRESULT(0x80004005u32 as i32),
                                    could_not_save,
                                ))
                            }
                        }),
                    )
                    .map_err(print_error_message)
                }
            })();

            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    let result = match tokio::time::timeout(PRINT_TIMEOUT, rx).await {
        Ok(result) => result.map_err(|_| "PDF export failed.".to_string())?,
        Err(_) => Err("Creating the PDF took too long, so it was stopped. Try again.".into()),
    };

    if let Err(err) = result {
        let _ = std::fs::remove_file(&printed);
        return Err(err);
    }
    finish_export(window, printed, PathBuf::from(output_path), options).await
}

/// Numbers the printed PDF and puts it in place, then closes the export
/// `window`. If the main window was closed during the export, this hidden
/// window is the last one, and closing it quits the app, so it must stay open
/// until the PDF is saved.
#[cfg_attr(not(windows), allow(dead_code))]
async fn finish_export<W>(
    window: W,
    printed: PathBuf,
    output: PathBuf,
    options: PdfPrintOptions,
) -> Result<Option<String>, String> {
    // Stamping parses the whole PDF: keep it off the async runtime's threads.
    let saved =
        tauri::async_runtime::spawn_blocking(move || save_printed_pdf(&printed, &output, &options))
            .await;
    drop(window);
    saved.map_err(|_| "PDF export failed.".to_string())?
}

/// A temporary file next to `path`, so it can be renamed over it.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn temp_sibling(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let id = uuid::Uuid::new_v4().simple().to_string();
    path.with_file_name(format!("{stem}.scrivon-{}.tmp.pdf", &id[..8]))
}

/// Numbers the pages of the freshly printed PDF and puts it at `output`. If
/// the numbers can't be added, the PDF is saved without them and the returned
/// warning says why, instead of the whole export failing.
#[cfg_attr(not(windows), allow(dead_code))]
fn save_printed_pdf(
    printed: &Path,
    output: &Path,
    options: &PdfPrintOptions,
) -> Result<Option<String>, String> {
    place_printed_pdf(printed, output, |input, output| {
        crate::page_numbers::stamp_page_numbers_to(input, output, options)
    })
}

/// `save_printed_pdf` with the numbering step passed in.
#[cfg_attr(not(windows), allow(dead_code))]
fn place_printed_pdf(
    printed: &Path,
    output: &Path,
    stamp: impl FnOnce(&Path, &Path) -> Result<Stamped, String>,
) -> Result<Option<String>, String> {
    // The stamper parses whatever PrintToPdf wrote; if it panics on something
    // unexpected, the printed PDF is still whole and is saved as it is.
    let stamped = std::panic::catch_unwind(AssertUnwindSafe(|| stamp(printed, output)))
        .unwrap_or_else(|_| {
            Err("Something in the printed PDF stopped Scrivon from numbering its pages.".into())
        });
    let (numbered, warning) = match stamped {
        Ok(stamped) => (stamped.changed, stamped.warning),
        Err(err) => (false, Some(err)),
    };
    if !numbered {
        if let Err(err) = std::fs::rename(printed, output) {
            let _ = std::fs::remove_file(printed);
            eprintln!("Could not move the printed PDF into place: {err}");
            return Err(could_not_save_message(&output.to_string_lossy()));
        }
    }
    let _ = std::fs::remove_file(printed);
    Ok(warning)
}

/// Plain text for a WebView2 print error (its `Display` is the raw `Debug` form).
#[cfg(windows)]
fn print_error_message(err: webview2_com::Error) -> String {
    match err {
        webview2_com::Error::WindowsError(err) => {
            let message = err.message();
            let message = message.trim();
            if message.is_empty() {
                format!("PDF export failed ({}).", err.code())
            } else {
                message.to_string()
            }
        }
        _ => "PDF export failed.".into(),
    }
}

/// The file name of a PDF path, for messages.
fn display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    )
}

/// WebView2 doesn't say why it couldn't write the PDF; the usual reason is the
/// old copy still being open in a PDF viewer.
#[cfg_attr(not(windows), allow(dead_code))]
fn could_not_save_message(path: &str) -> String {
    format!(
        "Couldn't save \"{}\". If it's open in another program, close it and try again, \
         or save it somewhere else.",
        display_name(Path::new(path))
    )
}

/// Checks that the PDF can be written before it's rendered, so a file held
/// open by a PDF viewer gets a message that says what to do. An existing file
/// is only opened, never changed.
fn check_output_writable(path: &str) -> Result<(), String> {
    use std::io::ErrorKind;

    let output = Path::new(path);
    let name = display_name(output);
    let mut probe = std::fs::OpenOptions::new();
    probe.write(true);
    // The finished PDF is renamed over the file, which also needs delete access,
    // and fails if another program has it open without allowing that.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const GENERIC_WRITE: u32 = 0x4000_0000;
        const DELETE: u32 = 0x0001_0000;
        probe.access_mode(GENERIC_WRITE | DELETE);
    }
    match probe.open(output) {
        Ok(_) => Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound => {
            if output.parent().is_some_and(Path::is_dir) {
                Ok(())
            } else {
                Err("The folder for this PDF no longer exists. Choose another location.".into())
            }
        }
        // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION: another program has it open.
        #[cfg(windows)]
        Err(err) if matches!(err.raw_os_error(), Some(32 | 33)) => Err(format!(
            "\"{name}\" is open in another program. Close it there and export again, \
             or save under a different name."
        )),
        Err(err) if err.kind() == ErrorKind::PermissionDenied => Err(format!(
            "Scrivon isn't allowed to change \"{name}\". Save under a different name \
             or in another folder."
        )),
        // Anything else is left for the export itself to report.
        Err(_) => Ok(()),
    }
}

#[cfg(not(windows))]
async fn export_html_to_pdf_impl(
    _app: tauri::AppHandle,
    _html: String,
    _output_path: String,
    _options: PdfPrintOptions,
) -> Result<Option<String>, String> {
    Err("Direct PDF save is only available on Windows.".into())
}

/// Only writes to a `.pdf` file the fs scope allows: the one the user chose in
/// the save dialog (which adds it to the scope), or one inside a folder they
/// opened. Otherwise any script in the webview could write a file anywhere on
/// disk. The scope matches a file that isn't there yet by its path as written,
/// so a `..` in it could point anywhere (as in `atomic_write`): that is
/// refused, and the scope is asked about where the file really goes, with its
/// folder looked up on disk (which also follows any link among its folders).
/// Without a `..` the path as given leads to that same place, so the export
/// still writes to it as given.
fn check_output_path(path: &str, in_scope: impl Fn(&Path) -> bool) -> Result<(), String> {
    let output = Path::new(path);
    let is_pdf = output
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err("The PDF file name must end in .pdf.".into());
    }
    let refused =
        || String::from("Scrivon can only save the PDF to a place you choose in the Save dialog.");
    let climbs = output
        .components()
        .any(|part| matches!(part, Component::ParentDir));
    if !output.is_absolute() || climbs {
        return Err(refused());
    }
    let (Some(folder), Some(name)) = (output.parent(), output.file_name()) else {
        return Err(refused());
    };
    match std::fs::canonicalize(folder) {
        Ok(folder) if in_scope(&folder.join(name)) => Ok(()),
        Ok(_) => Err(refused()),
        // The folder is gone: `check_output_writable` says so, but only for a
        // place the window may use, so it can't probe the disk.
        Err(_) if in_scope(output) => Ok(()),
        Err(_) => Err(refused()),
    }
}

#[tauri::command]
pub async fn export_html_to_pdf(
    app: tauri::AppHandle,
    html: String,
    output_path: String,
    options: PdfPrintOptions,
) -> Result<Option<String>, String> {
    let scope = app.fs_scope();
    check_output_path(&output_path, |path| scope.is_allowed(path))?;
    check_output_writable(&output_path)?;
    export_html_to_pdf_impl(app, html, output_path, options).await
}

const MAX_EXPORT_IMAGE_BYTES: usize = 12 * 1024 * 1024;
/// Said for an image over MAX_EXPORT_IMAGE_BYTES. PDF and Word exports both embed these images.
const IMAGE_TOO_LARGE: &str = "Image is too large to embed in the export (limit 12 MB).";

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
/// must keep working after a restart, so an image is read when the open dialog
/// has just added it to the fs scope or it was chosen in an earlier session
/// (see `export_image_access`), and only when it's a real image file (PNG,
/// JPEG, GIF, WebP or SVG).
///
/// The read runs on a background thread: a plain command runs on the window's
/// main thread, and an online-only cloud file can take seconds to arrive.
#[tauri::command]
pub async fn read_export_image(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.fs_scope();
        read_chosen_image(export_image_access::access(&app), &path, |image| {
            scope.is_allowed(image)
        })
    })
    .await
    .map_err(|_| "Could not read image.".to_string())?
}

/// `read_export_image` without the app: reads `path` when the user chose it.
fn read_chosen_image(
    access: &export_image_access::ExportImageAccess,
    path: &str,
    in_scope: impl Fn(&Path) -> bool,
) -> Result<String, String> {
    // A file that can't be an export image gets its own reason first: telling
    // the user to choose it again would only send them round in a loop.
    export_image_mime(path)?;
    access.approve(path, in_scope)?;
    read_image_as_data_url(path)
}

/// Records an image the user has just picked with Browse, so the export can
/// still read it after a restart. Only an image the open dialog put in the fs
/// scope is recorded. Returns whether it was.
#[tauri::command]
pub async fn remember_export_image(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = app.fs_scope();
        export_image_access::access(&app).remember(&path, |image| scope.is_allowed(image))
    })
    .await
    .map_err(|_| "Could not remember the image.".to_string())
}

/// Takes on the images that PDF profiles saved before the image check name,
/// so they keep working. Only accepted the first time, while no image list
/// has been saved yet. Returns whether the images were taken on.
#[tauri::command]
pub async fn adopt_export_images(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || export_image_access::access(&app).adopt(&paths))
        .await
        .map_err(|_| "Could not take on the profile images.".to_string())
}

/// Where images that came embedded in an imported export profile are kept,
/// inside the app's data folder.
const PROFILE_IMAGES_DIR: &str = "profile-images";
/// The image types an imported profile may embed, and the extension each is saved with.
const EMBEDDED_IMAGE_TYPES: [(&str, &str); 5] = [
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/gif", "gif"),
    ("image/webp", "webp"),
    ("image/svg+xml", "svg"),
];

/// Saves an image that came embedded in an imported export profile (a
/// `data:` URL) as a file in the app's data folder, and lets the export read
/// it. Returns its path, which the profile then names. Images stay out of the
/// saved settings that way, as web storage only holds a few MB.
#[tauri::command]
pub async fn save_profile_image(app: tauri::AppHandle, data_url: String) -> Result<String, String> {
    use tauri::Manager;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|err| err.to_string())?
            .join(PROFILE_IMAGES_DIR);
        save_embedded_image(export_image_access::access(&app), &dir, &data_url)
    })
    .await
    .map_err(|_| "Could not save the image.".to_string())?
}

/// `save_profile_image` without the app: writes the image into `dir` under a
/// new name, and records it as one the export may read.
fn save_embedded_image(
    access: &export_image_access::ExportImageAccess,
    dir: &Path,
    data_url: &str,
) -> Result<String, String> {
    let (extension, bytes) = decode_embedded_image(data_url)?;
    let could_not_save = |err: std::io::Error| format!("Could not save the image: {err}");
    std::fs::create_dir_all(dir).map_err(could_not_save)?;
    let path = dir.join(format!("{}.{extension}", uuid::Uuid::new_v4()));
    std::fs::write(&path, bytes).map_err(could_not_save)?;
    let path = path.to_string_lossy().into_owned();
    access.remember_saved(&path);
    Ok(path)
}

/// The extension and bytes of a `data:<type>;base64,<data>` image, checked
/// the way `read_image_as_data_url` checks a file.
fn decode_embedded_image(data_url: &str) -> Result<(&'static str, Vec<u8>), String> {
    let (mime, data) = data_url
        .trim()
        .strip_prefix("data:")
        .and_then(|rest| rest.split_once(";base64,"))
        .ok_or("This image isn't embedded in the file.")?;
    let (mime, extension) = EMBEDDED_IMAGE_TYPES
        .into_iter()
        .find(|(known, _)| known.eq_ignore_ascii_case(mime))
        .ok_or("Only PNG, JPEG, GIF, WebP and SVG images can be used.")?;
    // Checked before decoding, so a huge one isn't decoded first.
    if data.len() > MAX_EXPORT_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err(IMAGE_TOO_LARGE.into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| "This image is damaged.")?;
    if bytes.len() > MAX_EXPORT_IMAGE_BYTES {
        return Err(IMAGE_TOO_LARGE.into());
    }
    if !content_matches(mime, &bytes) {
        return Err("This file isn't a valid image.".into());
    }
    Ok((extension, bytes))
}

/// The image type of an export image path, or why it can't be one.
fn export_image_mime(path: &str) -> Result<&'static str, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Image path is empty.".into());
    }
    mime_from_path(path)
        .ok_or_else(|| "Only PNG, JPEG, GIF, WebP and SVG images can be used.".to_string())
}

fn read_image_as_data_url(path: &str) -> Result<String, String> {
    let path = path.trim();
    let mime = export_image_mime(path)?;
    let size = std::fs::metadata(path)
        .map_err(|e| format!("Could not read image: {e}"))?
        .len();
    if size > MAX_EXPORT_IMAGE_BYTES as u64 {
        return Err(IMAGE_TOO_LARGE.into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("Could not read image: {e}"))?;
    if bytes.len() > MAX_EXPORT_IMAGE_BYTES {
        return Err(IMAGE_TOO_LARGE.into());
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
    use std::cell::Cell;
    use std::time::Duration;

    use super::export_image_access::{ExportImageAccess, NOT_CHOSEN};
    use super::{
        check_output_path, check_output_writable, could_not_save_message, finish_export,
        mime_from_path, place_printed_pdf, read_chosen_image, read_image_as_data_url,
        save_embedded_image, save_printed_pdf, temp_sibling, wait_until_ready, PageReadiness,
        PdfPrintOptions, MAX_EXPORT_IMAGE_BYTES, MAX_REWRITES,
    };

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
        // Document properties are only sent when set.
        assert_eq!(
            (options.author.as_str(), options.subject.as_str()),
            ("", "")
        );

        let with_properties: PdfPrintOptions = serde_json::from_str(
            r##"{"pageWidthMm":210,"pageHeightMm":297,"landscape":false,"marginTopMm":10,"marginRightMm":10,"marginBottomMm":10,"marginLeftMm":10,"pageNumberFormat":"none","pageNumberColor":"","author":"Ada","subject":"Q3"}"##,
        )
        .unwrap();
        assert_eq!(with_properties.author, "Ada");
        assert_eq!(with_properties.subject, "Q3");
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
        let result = read_image_as_data_url(&path.to_string_lossy());
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
    fn says_an_image_over_the_limit_is_too_large_for_the_export() {
        let path = std::env::temp_dir().join(format!("scrivon-{}-huge.png", uuid::Uuid::new_v4()));
        // Sized without writing: the size is checked before the file is read.
        std::fs::File::create(&path)
            .and_then(|file| file.set_len(MAX_EXPORT_IMAGE_BYTES as u64 + 1))
            .unwrap();
        assert_eq!(
            read(&path).unwrap_err(),
            "Image is too large to embed in the export (limit 12 MB)."
        );
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
    fn says_a_picked_file_of_another_type_cant_be_used_rather_than_to_pick_it_again() {
        let access = ExportImageAccess::default();
        // Picked with Browse ('All files'), so the open dialog put it in the fs scope.
        let bitmap = temp_file("logo.bmp", b"BM");
        let result = read_chosen_image(&access, &bitmap.to_string_lossy(), |_| true);
        let _ = std::fs::remove_file(&bitmap);
        assert_eq!(
            result.unwrap_err(),
            "Only PNG, JPEG, GIF, WebP and SVG images can be used."
        );
    }

    #[test]
    fn reads_only_an_image_the_user_chose() {
        let access = ExportImageAccess::default();
        let photo = temp_file("photo.png", b"\x89PNG\r\n\x1a\n");
        let path = photo.to_string_lossy().into_owned();
        let unchosen = read_chosen_image(&access, &path, |_| false);
        let chosen = read_chosen_image(&access, &path, |_| true);
        let _ = std::fs::remove_file(&photo);
        assert_eq!(unchosen.unwrap_err(), NOT_CHOSEN);
        assert_eq!(chosen.unwrap(), "data:image/png;base64,iVBORw0KGgo=");
    }

    #[test]
    fn an_imported_profile_image_is_saved_and_can_be_exported() {
        let access = ExportImageAccess::default();
        let dir =
            std::env::temp_dir().join(format!("scrivon-{}-profile-images", uuid::Uuid::new_v4()));

        let saved = save_embedded_image(&access, &dir, "data:image/png;base64,iVBORw0KGgo=");
        let svg = save_embedded_image(&access, &dir, "data:image/svg+xml;base64,PHN2Zy8+");
        // The user never chose it with Browse, but the export may read it.
        let exported = saved
            .clone()
            .and_then(|path| read_chosen_image(&access, &path, |_| false));
        let _ = std::fs::remove_dir_all(&dir);

        let saved = saved.unwrap();
        assert!(saved.starts_with(&*dir.to_string_lossy()));
        assert!(saved.ends_with(".png"));
        assert!(svg.unwrap().ends_with(".svg"));
        assert_eq!(exported.unwrap(), "data:image/png;base64,iVBORw0KGgo=");
    }

    #[test]
    fn an_imported_profile_image_must_be_a_real_image() {
        let access = ExportImageAccess::default();
        let dir =
            std::env::temp_dir().join(format!("scrivon-{}-profile-images", uuid::Uuid::new_v4()));
        let save = |data_url: &str| save_embedded_image(&access, &dir, data_url);

        let not_embedded = save(r"C:\Users\me\logo.png").unwrap_err();
        let other_type = save("data:text/html;base64,PGI+").unwrap_err();
        let damaged = save("data:image/png;base64,%%%").unwrap_err();
        let renamed = save("data:image/png;base64,LS0tLS1CRUdJTg==").unwrap_err();
        let huge = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_EXPORT_IMAGE_BYTES / 3 * 4 + 8)
        );
        let too_large = save(&huge).unwrap_err();
        let made_folder = dir.exists();
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(not_embedded, "This image isn't embedded in the file.");
        assert_eq!(
            other_type,
            "Only PNG, JPEG, GIF, WebP and SVG images can be used."
        );
        assert_eq!(damaged, "This image is damaged.");
        assert_eq!(renamed, "This file isn't a valid image.");
        assert_eq!(
            too_large,
            "Image is too large to embed in the export (limit 12 MB)."
        );
        assert!(!made_folder);
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

    /// Allows what is inside `folder`, matched as the fs scope matches a file
    /// that isn't there yet: by its path as written, part by part, and by the
    /// folder's real location.
    fn inside(folder: &std::path::Path) -> impl Fn(&std::path::Path) -> bool {
        let written = folder.to_path_buf();
        let real = std::fs::canonicalize(folder).unwrap();
        move |path| path.starts_with(&written) || path.starts_with(&real)
    }

    #[test]
    fn refuses_a_pdf_whose_path_climbs_out_of_the_opened_folder() {
        let dir = temp_folder();
        let opened = dir.join("opened");
        std::fs::create_dir(&opened).unwrap();
        // Written this way it still starts with the opened folder.
        let escaping = opened.join("..").join("outside.pdf");
        assert!(inside(&opened)(&escaping));

        let refused = check_output_path(&escaping.to_string_lossy(), inside(&opened));
        let kept = check_output_path(
            &opened.join("inside.pdf").to_string_lossy(),
            inside(&opened),
        );

        let _ = std::fs::remove_dir_all(&dir);
        assert!(refused.unwrap_err().contains("Save dialog"));
        assert!(kept.is_ok());
    }

    #[test]
    fn asks_the_scope_about_where_the_pdf_really_goes() {
        let dir = temp_folder();
        let asked = std::cell::RefCell::new(Vec::new());

        let checked = check_output_path(&dir.join("Report.pdf").to_string_lossy(), |path| {
            asked.borrow_mut().push(path.to_path_buf());
            true
        });

        let real = std::fs::canonicalize(&dir).unwrap().join("Report.pdf");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(checked.is_ok());
        assert_eq!(*asked.borrow(), [real]);
    }

    #[test]
    fn leaves_a_missing_folder_to_be_reported_only_where_the_window_may_save() {
        let missing = std::env::temp_dir()
            .join(format!("scrivon-gone-{}", uuid::Uuid::new_v4()))
            .join("Report.pdf");
        let missing = missing.to_string_lossy().into_owned();

        assert!(check_output_path(&missing, |_| true).is_ok());
        assert!(check_output_path(&missing, |_| false)
            .unwrap_err()
            .contains("Save dialog"));
    }

    #[test]
    fn write_failures_name_the_file_instead_of_saying_cancelled() {
        let path = std::env::temp_dir().join("Report.pdf");
        let message = could_not_save_message(&path.to_string_lossy());
        assert!(message.contains("\"Report.pdf\""), "{message}");
        assert!(message.contains("open in another program"), "{message}");
        assert!(!message.to_lowercase().contains("cancel"), "{message}");
    }

    #[test]
    fn checks_the_pdf_can_be_written_without_changing_it() {
        let new_file = std::env::temp_dir().join(format!("scrivon-{}.pdf", uuid::Uuid::new_v4()));
        let new_file = new_file.to_string_lossy().into_owned();
        assert!(check_output_writable(&new_file).is_ok());
        assert!(!std::path::Path::new(&new_file).exists());

        let missing_folder = std::env::temp_dir()
            .join(format!("scrivon-gone-{}", uuid::Uuid::new_v4()))
            .join("Report.pdf");
        assert!(check_output_writable(&missing_folder.to_string_lossy())
            .unwrap_err()
            .contains("folder"));

        let existing = temp_file("existing.pdf", b"%PDF-1.7 old export");
        let existing_path = existing.to_string_lossy().into_owned();
        assert!(check_output_writable(&existing_path).is_ok());
        assert_eq!(std::fs::read(&existing).unwrap(), b"%PDF-1.7 old export");

        let writable = std::fs::metadata(&existing).unwrap().permissions();
        let mut read_only = writable.clone();
        read_only.set_readonly(true);
        std::fs::set_permissions(&existing, read_only).unwrap();
        let result = check_output_writable(&existing_path);
        std::fs::set_permissions(&existing, writable).unwrap();
        let _ = std::fs::remove_file(&existing);
        assert!(result.unwrap_err().contains("isn't allowed"));
    }

    #[cfg(windows)]
    #[test]
    fn reports_a_pdf_that_another_program_has_open() {
        use std::os::windows::fs::OpenOptionsExt;

        let path = temp_file("open-in-viewer.pdf", b"%PDF-1.7");
        // A PDF viewer such as Acrobat keeps the file open and blocks writes.
        let viewer = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1) // FILE_SHARE_READ
            .open(&path)
            .unwrap();
        let result = check_output_writable(&path.to_string_lossy());
        drop(viewer);
        let _ = std::fs::remove_file(&path);
        let message = result.unwrap_err();
        assert!(message.contains("is open in another program"), "{message}");
        assert!(message.contains("open-in-viewer.pdf"), "{message}");
    }

    #[cfg(windows)]
    #[test]
    fn reports_a_pdf_whose_viewer_lets_others_write_but_not_replace_it() {
        use std::os::windows::fs::OpenOptionsExt;

        let path = temp_file("shared-in-viewer.pdf", b"%PDF-1.7");
        // Writing in place would work, but renaming the new PDF over it wouldn't.
        let viewer = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1 | 2) // FILE_SHARE_READ | FILE_SHARE_WRITE
            .open(&path)
            .unwrap();
        let result = check_output_writable(&path.to_string_lossy());
        drop(viewer);
        let _ = std::fs::remove_file(&path);
        let message = result.unwrap_err();
        assert!(message.contains("is open in another program"), "{message}");
    }

    fn print_options(format: &str) -> PdfPrintOptions {
        PdfPrintOptions {
            page_width_mm: 210.0,
            page_height_mm: 297.0,
            landscape: false,
            margin_top_mm: 10.0,
            margin_right_mm: 10.0,
            margin_bottom_mm: 10.0,
            margin_left_mm: 10.0,
            page_number_format: format.into(),
            page_number_color: String::new(),
            author: String::new(),
            subject: String::new(),
        }
    }

    /// A one-page PDF like PrintToPdf's output (no footer markers).
    fn write_printed_pdf(path: &std::path::Path) {
        use lopdf::{dictionary, Document, Object, Stream};

        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let content_id = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
        let page_id = doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            "Contents" => content_id,
            "Resources" => dictionary! {},
        });
        doc.objects.insert(
            pages_id,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Kids" => vec![page_id.into()], "Count" => 1 },
            ),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        doc.save(path).unwrap();
    }

    fn temp_folder() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("scrivon-export-{}", uuid::Uuid::new_v4()));
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
    fn prints_to_a_temporary_file_next_to_the_chosen_one() {
        let chosen = std::env::temp_dir().join("Report.pdf");
        let temp = temp_sibling(&chosen);
        assert_eq!(temp.parent(), chosen.parent());
        let name = temp.file_name().unwrap().to_string_lossy().into_owned();
        assert!(
            name.starts_with("Report.scrivon-") && name.ends_with(".tmp.pdf"),
            "{name}"
        );
        assert_ne!(temp, temp_sibling(&chosen));
    }

    #[test]
    fn replaces_the_chosen_file_with_the_numbered_pdf() {
        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        std::fs::write(&output, b"%PDF-1.7 last week's export").unwrap();
        let printed = temp_sibling(&output);
        write_printed_pdf(&printed);

        let warning = save_printed_pdf(&printed, &output, &print_options("page-n")).unwrap();

        let saved = lopdf::Document::load(&output).unwrap();
        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(warning, None);
        assert!(saved.extract_text(&[1]).unwrap().contains("Page 1"));
        assert_eq!(names, ["Report.pdf"], "temporary files were left behind");
    }

    #[test]
    fn saves_the_pdf_as_printed_when_there_are_no_numbers_to_add() {
        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        let printed = temp_sibling(&output);
        write_printed_pdf(&printed);
        let printed_bytes = std::fs::read(&printed).unwrap();

        let warning = save_printed_pdf(&printed, &output, &print_options("none")).unwrap();

        let saved = std::fs::read(&output).unwrap();
        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(warning, None);
        assert_eq!(saved, printed_bytes);
        assert_eq!(names, ["Report.pdf"]);
    }

    #[test]
    fn keeps_the_unnumbered_pdf_with_a_warning_when_numbering_fails() {
        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        let printed = temp_sibling(&output);
        // Something the stamper can't read.
        std::fs::write(&printed, b"%PDF-1.7 not really a pdf").unwrap();

        let warning = save_printed_pdf(&printed, &output, &print_options("page-n")).unwrap();

        let saved = std::fs::read(&output).unwrap();
        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        // A plain sentence for the user, not the PDF parser's error.
        assert_eq!(
            warning.as_deref(),
            Some("Scrivon couldn't read the printed PDF to add page numbers.")
        );
        assert_eq!(saved, b"%PDF-1.7 not really a pdf");
        assert_eq!(names, ["Report.pdf"]);
    }

    #[test]
    fn keeps_the_unnumbered_pdf_when_numbering_panics() {
        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        let printed = temp_sibling(&output);
        write_printed_pdf(&printed);
        let printed_bytes = std::fs::read(&printed).unwrap();

        let warning = place_printed_pdf(&printed, &output, |_, _| panic!("unexpected PDF"));

        let saved = std::fs::read(&output).unwrap();
        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(warning
            .unwrap()
            .is_some_and(|w| w.contains("numbering its pages")));
        assert_eq!(saved, printed_bytes);
        assert_eq!(names, ["Report.pdf"], "temporary files were left behind");
    }

    #[test]
    fn says_why_page_numbers_were_left_out() {
        // No footer on any page and no print margins (bleed mode): nowhere to put them.
        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        let printed = temp_sibling(&output);
        write_printed_pdf(&printed);
        let printed_bytes = std::fs::read(&printed).unwrap();
        let mut bleed = print_options("page-n");
        bleed.margin_right_mm = 0.0;
        bleed.margin_bottom_mm = 0.0;

        let warning = save_printed_pdf(&printed, &output, &bleed).unwrap();

        let saved = std::fs::read(&output).unwrap();
        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(warning.is_some_and(|w| w.contains("footer")));
        assert_eq!(saved, printed_bytes);
        assert_eq!(names, ["Report.pdf"]);
    }

    #[cfg(windows)]
    #[test]
    fn leaves_the_old_file_whole_when_it_cannot_be_replaced() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        std::fs::write(&output, b"%PDF-1.7 last week's export").unwrap();
        let printed = temp_sibling(&output);
        write_printed_pdf(&printed);
        // A viewer that opened the file after the up-front check, blocking the swap.
        let viewer = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1) // FILE_SHARE_READ
            .open(&output)
            .unwrap();

        let result = save_printed_pdf(&printed, &output, &print_options("page-n"));

        drop(viewer);
        let saved = std::fs::read(&output).unwrap();
        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(result.unwrap_err().contains("Couldn't save \"Report.pdf\""));
        assert_eq!(saved, b"%PDF-1.7 last week's export");
        assert_eq!(names, ["Report.pdf"], "temporary files were left behind");
    }

    /// Stands in for the export window: notes, when it's closed, whether the
    /// numbered PDF was already saved.
    struct ExportWindowProbe<'a> {
        output: &'a std::path::Path,
        saved_when_closed: &'a Cell<Option<bool>>,
    }

    impl Drop for ExportWindowProbe<'_> {
        fn drop(&mut self) {
            let saved = lopdf::Document::load(self.output)
                .ok()
                .and_then(|doc| doc.extract_text(&[1]).ok())
                .is_some_and(|text| text.contains("Page 1"));
            self.saved_when_closed.set(Some(saved));
        }
    }

    #[test]
    fn closes_the_export_window_only_once_the_pdf_is_saved() {
        // Closing the last window quits the app, so the window must outlive the save.
        let dir = temp_folder();
        let output = dir.join("Report.pdf");
        let printed = temp_sibling(&output);
        write_printed_pdf(&printed);
        let saved_when_closed = Cell::new(None);
        let window = ExportWindowProbe {
            output: &output,
            saved_when_closed: &saved_when_closed,
        };

        let result = tauri::async_runtime::block_on(finish_export(
            window,
            printed,
            output.clone(),
            print_options("page-n"),
        ));

        let names = files_in(&dir);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(result, Ok(None));
        assert_eq!(saved_when_closed.get(), Some(true));
        assert_eq!(names, ["Report.pdf"]);
    }

    /// Runs `wait_until_ready` against a page that answers `statuses` in turn
    /// (repeating the last one). Returns how it ended, and how many times the
    /// page was asked and written again.
    fn wait_for(statuses: &[Option<&str>], limit: Duration) -> (PageReadiness, usize, usize) {
        let polls = Cell::new(0);
        let rewrites = Cell::new(0);
        let ready = tauri::async_runtime::block_on(wait_until_ready(
            || {
                let asked = polls.get();
                polls.set(asked + 1);
                let status = statuses
                    .get(asked)
                    .or(statuses.last())
                    .copied()
                    .flatten()
                    .map(String::from);
                async move { status }
            },
            || rewrites.set(rewrites.get() + 1),
            limit,
            Duration::from_millis(1),
        ));
        (ready, polls.get(), rewrites.get())
    }

    #[test]
    fn prints_as_soon_as_the_page_is_ready() {
        let limit = Duration::from_secs(5);
        assert_eq!(
            wait_for(&[Some("waiting"), Some("waiting"), Some("ready")], limit),
            (PageReadiness::Ready, 3, 0)
        );
        // A page that doesn't answer once is still waited for.
        assert_eq!(
            wait_for(&[None, Some("ready")], limit),
            (PageReadiness::Ready, 2, 0)
        );
    }

    #[test]
    fn writes_the_html_again_when_the_page_turns_up_empty() {
        assert_eq!(
            wait_for(&[Some("empty"), Some("ready")], Duration::from_secs(5)),
            (PageReadiness::Ready, 2, 1)
        );
        // Still empty after every rewrite: stop at once rather than print a blank page.
        let started = std::time::Instant::now();
        let (readiness, polls, rewrites) = wait_for(&[Some("empty")], Duration::from_secs(5));
        assert_eq!(readiness, PageReadiness::NeverWritten);
        assert_eq!((polls, rewrites), (MAX_REWRITES + 1, MAX_REWRITES));
        assert!(started.elapsed() < Duration::from_secs(1));
        // Out of time while the page was still empty.
        let (readiness, _, _) = wait_for(&[Some("empty"), None], Duration::from_millis(50));
        assert_eq!(readiness, PageReadiness::NeverWritten);
    }

    #[test]
    fn stops_waiting_for_a_page_that_never_gets_ready() {
        let started = std::time::Instant::now();
        let (readiness, polls, _) = wait_for(&[Some("waiting")], Duration::from_millis(50));
        assert_eq!(readiness, PageReadiness::TimedOut);
        assert!(polls > 1);
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
