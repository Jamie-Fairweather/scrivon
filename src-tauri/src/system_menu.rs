//! The Windows window menu (Restore, Move, Size, Minimize, Maximize, Close)
//! for the app's own title bar (U74).
//!
//! The window has no Windows title bar (`decorations: false`), so a
//! right-click on the app's title bar only reached the webview, and there was
//! no way to move or size the window from the keyboard. The page asks for the
//! menu on a right-click there (components/disable-native-context-menu.tsx).

// The menu exists on Windows only; elsewhere the item states are only tested.
#![cfg_attr(not(windows), allow(dead_code))]

// Window menu item ids (WM_SYSCOMMAND values).
const SC_SIZE: u32 = 0xF000;
const SC_MOVE: u32 = 0xF010;
const SC_MINIMIZE: u32 = 0xF020;
const SC_MAXIMIZE: u32 = 0xF030;
const SC_CLOSE: u32 = 0xF060;
const SC_RESTORE: u32 = 0xF120;

/// Which items can be chosen. Windows does this itself for a title bar it
/// draws, but not for a menu shown like this: Restore only when maximized;
/// Move, Size and Maximize only when not.
fn menu_item_states(maximized: bool) -> [(u32, bool); 6] {
    [
        (SC_RESTORE, maximized),
        (SC_MOVE, !maximized),
        (SC_SIZE, !maximized),
        (SC_MINIMIZE, true),
        (SC_MAXIMIZE, !maximized),
        (SC_CLOSE, true),
    ]
}

/// Shows the window menu at the mouse pointer and carries out the chosen item.
/// Does nothing outside Windows.
#[tauri::command(async)]
pub fn show_system_menu(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(windows)]
    {
        // The handle is a plain number here so it can be sent to the main thread.
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        // On the main thread, which owns the window, but from its event loop
        // rather than from inside the webview's request handler: the menu runs
        // its own message loop until it closes.
        window
            .run_on_main_thread(move || {
                if let Err(err) = native::show(hwnd as *mut std::ffi::c_void) {
                    eprintln!("Could not show the window menu: {err}");
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = window;
    Ok(())
}

#[cfg(windows)]
mod native {
    use std::ffi::c_void;

    const MF_BYCOMMAND: u32 = 0x0000;
    const MF_ENABLED: u32 = 0x0000;
    const MF_GRAYED: u32 = 0x0001;
    const TPM_RIGHTBUTTON: u32 = 0x0002;
    const TPM_RETURNCMD: u32 = 0x0100;
    const WM_SYSCOMMAND: u32 = 0x0112;

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetSystemMenu(hwnd: *mut c_void, revert: i32) -> *mut c_void;
        fn EnableMenuItem(menu: *mut c_void, item: u32, enable: u32) -> i32;
        fn IsZoomed(hwnd: *mut c_void) -> i32;
        fn GetCursorPos(point: *mut Point) -> i32;
        fn SetForegroundWindow(hwnd: *mut c_void) -> i32;
        fn TrackPopupMenu(
            menu: *mut c_void,
            flags: u32,
            x: i32,
            y: i32,
            reserved: i32,
            hwnd: *mut c_void,
            rect: *const c_void,
        ) -> i32;
        fn PostMessageW(hwnd: *mut c_void, msg: u32, wparam: usize, lparam: isize) -> i32;
    }

    pub fn show(hwnd: *mut c_void) -> Result<(), String> {
        // SAFETY: `hwnd` is the app's own window, and this runs on the thread
        // that owns it. Every pointer passed lives for the whole call.
        unsafe {
            let menu = GetSystemMenu(hwnd, 0);
            if menu.is_null() {
                return Err("the window has no window menu".into());
            }
            for (item, enabled) in super::menu_item_states(IsZoomed(hwnd) != 0) {
                let state = if enabled { MF_ENABLED } else { MF_GRAYED };
                EnableMenuItem(menu, item, MF_BYCOMMAND | state);
            }
            // Where the pointer is in screen pixels. The page's own numbers
            // are in CSS pixels, which are off when the display is scaled.
            let mut point = Point { x: 0, y: 0 };
            if GetCursorPos(&mut point) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            SetForegroundWindow(hwnd);
            let flags = TPM_RETURNCMD | TPM_RIGHTBUTTON;
            let command = TrackPopupMenu(menu, flags, point.x, point.y, 0, hwnd, std::ptr::null());
            // 0: closed without a choice. Otherwise do what the title bar's
            // menu would (a lParam of 0 means "chosen from the keyboard", so
            // Move and Size then follow the arrow keys).
            if command != 0 {
                PostMessageW(hwnd, WM_SYSCOMMAND, command as usize, 0);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled(maximized: bool, item: u32) -> bool {
        menu_item_states(maximized)
            .iter()
            .find(|(id, _)| *id == item)
            .unwrap()
            .1
    }

    #[test]
    fn a_normal_window_can_be_moved_sized_and_maximized_but_not_restored() {
        assert!(!enabled(false, SC_RESTORE));
        for item in [SC_MOVE, SC_SIZE, SC_MAXIMIZE, SC_MINIMIZE, SC_CLOSE] {
            assert!(enabled(false, item), "{item:#x}");
        }
    }

    #[test]
    fn a_maximized_window_can_only_be_restored_minimized_or_closed() {
        for item in [SC_RESTORE, SC_MINIMIZE, SC_CLOSE] {
            assert!(enabled(true, item), "{item:#x}");
        }
        for item in [SC_MOVE, SC_SIZE, SC_MAXIMIZE] {
            assert!(!enabled(true, item), "{item:#x}");
        }
    }
}
