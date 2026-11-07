use tauri::Wry;
use tauri_plugin_prevent_default::{Builder, Flags};

/// Browser shortcuts the app turns off. Shift+Tab (`FOCUS_MOVE`) is left out on
/// purpose: blocking it stops keyboard users moving focus backwards anywhere.
/// So is the right-click menu (`CONTEXT_MENU`): the page decides where it shows
/// (components/disable-native-context-menu.tsx), so text fields keep Cut, Copy,
/// Paste and spelling suggestions.
fn blocked_shortcuts() -> Flags {
    let flags = Flags::all().difference(Flags::FOCUS_MOVE | Flags::CONTEXT_MENU);

    // Keep devtools and reload available while developing (see also
    // `with_platform_options`).
    #[cfg(debug_assertions)]
    let flags = flags.difference(Flags::DEV_TOOLS | Flags::RELOAD);

    flags
}

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    with_platform_options(Builder::new().with_flags(blocked_shortcuts())).build()
}

/// Release builds on Windows also turn off WebView2's own browser keys. Those
/// include F12, Ctrl+Shift+I and F5, so debug builds leave them on to keep
/// DevTools and reload working. WebView2's right-click menu stays on for the
/// page to allow; release builds have no DevTools, so it has no Inspect item.
#[cfg(all(windows, not(debug_assertions)))]
fn with_platform_options(builder: Builder) -> Builder {
    use tauri_plugin_prevent_default::PlatformOptions;

    builder.platform(
        PlatformOptions::new()
            .browser_accelerator_keys(false)
            .default_context_menus(true),
    )
}

#[cfg(any(not(windows), debug_assertions))]
fn with_platform_options(builder: Builder) -> Builder {
    builder
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shift_tab_still_moves_focus_backwards() {
        assert!(!blocked_shortcuts().contains(Flags::FOCUS_MOVE));
        assert!(blocked_shortcuts().contains(Flags::FIND | Flags::PRINT));
    }

    #[test]
    fn the_page_decides_where_the_right_click_menu_shows() {
        assert!(!blocked_shortcuts().contains(Flags::CONTEXT_MENU));
    }

    #[test]
    fn only_release_builds_turn_off_devtools_and_reload() {
        let developer_tools = Flags::DEV_TOOLS | Flags::RELOAD;
        if cfg!(debug_assertions) {
            assert!(!blocked_shortcuts().intersects(developer_tools));
        } else {
            assert!(blocked_shortcuts().contains(developer_tools));
        }
    }
}
