use font_kit::source::SystemSource;

/// The installed font families. Listing them can take a moment with many fonts
/// installed, so it runs on a background thread instead of the window's main
/// thread (where a plain command runs).
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(system_font_families)
        .await
        .map_err(|_| "Could not list the installed fonts.".to_string())?
}

fn system_font_families() -> Result<Vec<String>, String> {
    let mut families = SystemSource::new()
        .all_families()
        .map_err(|err| err.to_string())?;
    families.sort_unstable();
    families.dedup();
    Ok(families)
}

#[cfg(test)]
mod tests {
    #[cfg(windows)]
    #[test]
    fn lists_the_installed_fonts_sorted_once_each() {
        let families = tauri::async_runtime::block_on(super::list_system_fonts()).unwrap();
        assert!(families.iter().any(|family| family == "Arial"));
        assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
    }
}
