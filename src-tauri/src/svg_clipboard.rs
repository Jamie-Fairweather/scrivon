//! Copy as SVG (F45), so Word and PowerPoint paste the diagram as a picture
//! (#208).
//!
//! The page writes the clipboard through Tauri's clipboard plugin, which takes
//! text, HTML and pixels, but not an SVG picture. Office pastes SVG as a
//! picture only from the clipboard format named "image/svg+xml", which the
//! browser wrote before #208. So on Windows this puts the markup on the
//! clipboard as text and in that format, in one go: whoever pastes gets both.
//! Elsewhere it is text only.

/// Puts `svg` on the clipboard as text and, on Windows, as an SVG picture too.
/// Fails with a plain sentence saying why.
#[tauri::command(async)]
pub fn write_clipboard_svg(app: tauri::AppHandle, svg: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        native::write(&svg)
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_clipboard_manager::ClipboardExt;
        app.clipboard().write_text(svg).map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod native {
    use clipboard_win::{raw, Clipboard};

    /// The name Chromium registers its SVG clipboard format under, and the
    /// one Word and PowerPoint read.
    pub(super) const SVG_FORMAT: &str = "image/svg+xml";

    /// Another app often has the clipboard open for a moment, so it is tried
    /// this many times, 5 ms apart, as arboard and Chromium do.
    pub(super) const OPEN_ATTEMPTS: usize = 10;

    /// The SVG format's number. Every app asking for the same name gets the
    /// same one.
    pub(super) fn svg_format() -> Result<u32, String> {
        raw::register_format(SVG_FORMAT)
            .map(|format| format.get())
            .ok_or_else(|| "Couldn't set up the SVG picture format on the clipboard.".to_owned())
    }

    /// Writes the markup as Unicode text and, under the SVG format, as UTF-8
    /// ending in a 0, as Chromium does (ui/base/clipboard/clipboard_win.cc,
    /// WriteSvg). What was on the clipboard before is cleared.
    pub(super) fn write(svg: &str) -> Result<(), String> {
        let format = svg_format()?;
        let _open = Clipboard::new_attempts(OPEN_ATTEMPTS)
            .map_err(|_| "Another app is using the clipboard. Try again.".to_owned())?;
        let failed = |err| format!("Couldn't put the diagram on the clipboard: {err}");
        // Clears the clipboard first.
        raw::set_string(svg).map_err(failed)?;
        let mut picture = Vec::with_capacity(svg.len() + 1);
        picture.extend_from_slice(svg.as_bytes());
        picture.push(0);
        raw::set_without_clear(format, &picture).map_err(failed)
    }
}

// These use the real clipboard, and put back the text that was on it.
#[cfg(all(test, windows))]
mod tests {
    use super::native::{self, OPEN_ATTEMPTS, SVG_FORMAT};
    use clipboard_win::{get_clipboard_string, raw, set_clipboard_string, Clipboard};

    /// Puts back the text that was on the clipboard, so running the tests
    /// doesn't lose what you copied.
    struct PutBack(Option<String>);

    impl Drop for PutBack {
        fn drop(&mut self) {
            if let Some(text) = &self.0 {
                let _ = set_clipboard_string(text);
            }
        }
    }

    #[test]
    fn writes_the_markup_as_text_and_as_an_svg_picture() {
        let _put_back = PutBack(get_clipboard_string().ok());
        set_clipboard_string("copied before").unwrap();
        let svg = r#"<svg xmlns="http://www.w3.org/2000/svg"><text>Café → 東京</text></svg>"#;

        native::write(svg).unwrap();

        let format = native::svg_format().unwrap();
        let _open = Clipboard::new_attempts(OPEN_ATTEMPTS).unwrap();
        // Registered under the name Office looks for.
        assert_eq!(raw::format_name_big(format).as_deref(), Some(SVG_FORMAT));
        let mut text = Vec::new();
        raw::get_string(&mut text).unwrap();
        assert_eq!(String::from_utf8(text).unwrap(), svg);
        let mut picture = Vec::new();
        raw::get_vec(format, &mut picture).unwrap();
        // Windows may round the block up, so only up to the 0 counts.
        let end = picture
            .iter()
            .position(|&byte| byte == 0)
            .expect("ends in a 0");
        assert_eq!(&picture[..end], svg.as_bytes());
    }
}
