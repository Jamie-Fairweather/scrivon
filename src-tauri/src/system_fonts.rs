use std::panic::{catch_unwind, AssertUnwindSafe};

use font_kit::source::SystemSource;
use serde::Serialize;

/// An installed font family, and whether its letters all take the same width,
/// so the Monospace font picker can list only those.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SystemFont {
    pub family: String,
    pub monospace: bool,
}

/// The installed font families. Listing them can take a moment with many fonts
/// installed, so it runs on a background thread instead of the window's main
/// thread (where a plain command runs).
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    tauri::async_runtime::spawn_blocking(system_fonts)
        .await
        .map_err(|_| "Could not list the installed fonts.".to_string())?
}

fn system_fonts() -> Result<Vec<SystemFont>, String> {
    let source = SystemSource::new();
    let mut families = source.all_families().map_err(|err| err.to_string())?;
    families.sort_unstable();
    families.dedup();
    Ok(families
        .into_iter()
        .map(|family| SystemFont {
            monospace: is_monospace(&source, &family),
            family,
        })
        .collect())
}

/// Whether the family's first font is monospaced. Any failure counts as not
/// monospaced, a panic included: font-kit unwraps some font details (on
/// Windows, a font with no file path), and one odd font mustn't lose the
/// whole list.
fn is_monospace(source: &SystemSource, family: &str) -> bool {
    catch_unwind(AssertUnwindSafe(|| {
        let handles = source.select_family_by_name(family).ok()?;
        let font = handles.fonts().first()?.load().ok()?;
        Some(font.is_monospace())
    }))
    .ok()
    .flatten()
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn lists_the_installed_fonts_sorted_once_each_and_spots_monospace_ones() {
        let fonts = tauri::async_runtime::block_on(super::list_system_fonts()).unwrap();
        let monospace = |name: &str| {
            fonts
                .iter()
                .find(|font| font.family == name)
                .unwrap_or_else(|| panic!("{name} is not installed"))
                .monospace
        };
        assert!(monospace("Consolas"));
        assert!(monospace("Courier New"));
        assert!(!monospace("Arial"));
        assert!(fonts.windows(2).all(|pair| pair[0].family < pair[1].family));
    }

    #[test]
    fn an_unknown_family_is_not_monospace() {
        let source = font_kit::source::SystemSource::new();
        assert!(!super::is_monospace(&source, "No Such Font Family 7f3a9c"));
    }
}
