use tauri::Wry;
use tauri_plugin_prevent_default::Builder;

pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    let builder = {
        #[cfg(debug_assertions)]
        {
            use tauri_plugin_prevent_default::Flags;

            // Keep devtools and reload available while developing.
            Builder::new().with_flags(Flags::all().difference(Flags::DEV_TOOLS | Flags::RELOAD))
        }
        #[cfg(not(debug_assertions))]
        {
            Builder::new()
        }
    };

    with_platform_options(builder).build()
}

#[cfg(windows)]
fn with_platform_options(builder: Builder) -> Builder {
    use tauri_plugin_prevent_default::PlatformOptions;

    builder.platform(
        PlatformOptions::new()
            .browser_accelerator_keys(false)
            .default_context_menus(false),
    )
}

#[cfg(not(windows))]
fn with_platform_options(builder: Builder) -> Builder {
    builder
}
