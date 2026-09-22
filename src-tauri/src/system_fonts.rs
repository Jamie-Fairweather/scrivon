use font_kit::source::SystemSource;

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<String>, String> {
    let mut families = SystemSource::new()
        .all_families()
        .map_err(|err| err.to_string())?;
    families.sort_unstable();
    families.dedup();
    Ok(families)
}
