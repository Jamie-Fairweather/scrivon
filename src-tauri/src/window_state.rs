//! Remembers the main window's size, place and whether it was maximised (F19).
//!
//! They are saved to `window-state.json` in the app data folder as the window
//! closes, and put back when it is built, before the page shows it. A place
//! that no screen shows in full any more (a screen was unplugged, or its
//! resolution lowered) is moved, and shrunk if need be, onto the screen that
//! shows most of it. When no screen shows any of it, the window opens at its
//! default size in the middle of the screen. A window closed while maximised
//! opens maximised, and goes back to its saved size when restored.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{Manager, PhysicalPosition, PhysicalSize};

const STATE_FILE: &str = "window-state.json";

/// A rectangle on the desktop in physical pixels: a window's top-left corner
/// and size, or a screen's work area (the screen less the taskbar).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Bounds {
    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    /// How much of the two rectangles overlaps, in square pixels.
    fn overlap(self, other: Bounds) -> i64 {
        let width = self.right().min(other.right()) - i64::from(self.x.max(other.x));
        let height = self.bottom().min(other.bottom()) - i64::from(self.y.max(other.y));
        width.max(0) * height.max(0)
    }
}

/// The window as it was when it closed.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedWindow {
    /// Where it is when it isn't maximised.
    pub bounds: Bounds,
    pub maximized: bool,
}

/// Where to put a window saved at `saved`, given the screens' work areas: on
/// the screen that shows most of it, moved and shrunk so all of it is on that
/// screen. None when no screen shows any of it.
pub fn fit_on_screen(saved: Bounds, screens: &[Bounds]) -> Option<Bounds> {
    if saved.width == 0 || saved.height == 0 {
        return None;
    }
    let screen = screens
        .iter()
        .copied()
        .max_by_key(|screen| saved.overlap(*screen))
        .filter(|screen| saved.overlap(*screen) > 0)?;
    let width = saved.width.min(screen.width);
    let height = saved.height.min(screen.height);
    let x = i64::from(saved.x).clamp(i64::from(screen.x), screen.right() - i64::from(width));
    let y = i64::from(saved.y).clamp(i64::from(screen.y), screen.bottom() - i64::from(height));
    Some(Bounds {
        x: i32::try_from(x).ok()?,
        y: i32::try_from(y).ok()?,
        width,
        height,
    })
}

/// Where the window's size and place are kept; None without an app data folder.
pub struct WindowStateFile(Option<PathBuf>);

impl WindowStateFile {
    pub fn new(data_dir: Option<&Path>) -> Self {
        Self(data_dir.map(|dir| dir.join(STATE_FILE)))
    }
}

fn read_state(file: &Path) -> Option<SavedWindow> {
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

fn write_state(file: &Path, saved: &SavedWindow) -> std::io::Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Written beside it and swapped in, so a failed write never leaves half a file.
    let temp = file.with_extension("json.tmp");
    let written = std::fs::write(&temp, serde_json::to_vec_pretty(saved)?)
        .and_then(|()| std::fs::rename(&temp, file));
    if written.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    written
}

/// Puts the main window back where it was when it last closed. Call right
/// after building it, while it is still hidden.
pub fn restore(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(saved) = app
        .try_state::<WindowStateFile>()
        .and_then(|file| file.0.as_deref().and_then(read_state))
    else {
        return;
    };
    let screens: Vec<Bounds> = window
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let area = monitor.work_area();
            Bounds {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect();
    if let Some(bounds) = fit_on_screen(saved.bounds, &screens) {
        // The place first: moving onto a screen with another scale changes the size.
        let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
        let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
    }
    if saved.maximized {
        // A hidden window is only marked as maximised, and fills the screen once shown.
        let _ = window.maximize();
    }
}

/// Saves the main window's size and place for the next start. Call as it closes.
pub fn save(window: &tauri::Window) {
    let Some(file) = window
        .try_state::<WindowStateFile>()
        .and_then(|file| file.0.clone())
    else {
        return;
    };
    let Some(saved) = current(window) else {
        return;
    };
    if let Err(err) = write_state(&file, &saved) {
        eprintln!("Could not save the window's size and place: {err}");
    }
}

/// The window's size and place. When it is maximised or minimised, Windows
/// still knows where it goes back to, which is what is saved.
#[cfg(windows)]
fn current(window: &tauri::Window) -> Option<SavedWindow> {
    let placement = window_placement(window.hwnd().ok()?.0)?;
    let monitor = window.current_monitor().ok()??;
    let offset = (
        monitor.work_area().position.x - monitor.position().x,
        monitor.work_area().position.y - monitor.position().y,
    );
    saved_from_placement(&placement, offset)
}

/// Elsewhere, only a window that isn't maximised or minimised is saved.
#[cfg(not(windows))]
fn current(window: &tauri::Window) -> Option<SavedWindow> {
    if window.is_maximized().ok()? || window.is_minimized().ok()? {
        return None;
    }
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(SavedWindow {
        bounds: Bounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        maximized: false,
    })
}

#[cfg(windows)]
#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(windows)]
#[repr(C)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// Win32's WINDOWPLACEMENT.
#[cfg(windows)]
#[repr(C)]
struct WindowPlacement {
    length: u32,
    flags: u32,
    show_cmd: u32,
    min_position: Point,
    max_position: Point,
    normal_position: Rect,
}

#[cfg(windows)]
const SW_SHOWNORMAL: u32 = 1;
#[cfg(windows)]
const SW_SHOWMINIMIZED: u32 = 2;
#[cfg(windows)]
const SW_SHOWMAXIMIZED: u32 = 3;
#[cfg(windows)]
const WPF_RESTORETOMAXIMIZED: u32 = 2;

#[cfg(windows)]
fn window_placement(hwnd: *mut std::ffi::c_void) -> Option<WindowPlacement> {
    #[link(name = "user32")]
    extern "system" {
        fn GetWindowPlacement(hwnd: *mut std::ffi::c_void, placement: *mut WindowPlacement) -> i32;
    }
    let mut placement = WindowPlacement {
        length: std::mem::size_of::<WindowPlacement>() as u32,
        flags: 0,
        show_cmd: SW_SHOWNORMAL,
        min_position: Point { x: 0, y: 0 },
        max_position: Point { x: 0, y: 0 },
        normal_position: Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        },
    };
    // SAFETY: `hwnd` is the live window's handle, and `placement` is a
    // WINDOWPLACEMENT with its length set, which the call fills in.
    let ok = unsafe { GetWindowPlacement(hwnd, &mut placement) };
    (ok != 0).then_some(placement)
}

/// The window's normal place from its placement, which Windows counts from the
/// top-left of the screen's work area (`work_offset` from the screen's), and
/// whether it is maximised, or comes back maximised from the taskbar.
#[cfg(windows)]
fn saved_from_placement(
    placement: &WindowPlacement,
    work_offset: (i32, i32),
) -> Option<SavedWindow> {
    let rect = &placement.normal_position;
    let width = u32::try_from(rect.right.checked_sub(rect.left)?).ok()?;
    let height = u32::try_from(rect.bottom.checked_sub(rect.top)?).ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    let maximized = placement.show_cmd == SW_SHOWMAXIMIZED
        || (placement.show_cmd == SW_SHOWMINIMIZED
            && placement.flags & WPF_RESTORETOMAXIMIZED != 0);
    Some(SavedWindow {
        bounds: Bounds {
            x: rect.left.checked_add(work_offset.0)?,
            y: rect.top.checked_add(work_offset.1)?,
            width,
            height,
        },
        maximized,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: Bounds = Bounds {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };
    /// A second screen to the right of the laptop.
    const RIGHT: Bounds = Bounds {
        x: 1920,
        y: 0,
        width: 2560,
        height: 1400,
    };

    fn at(x: i32, y: i32, width: u32, height: u32) -> Bounds {
        Bounds {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn a_place_a_screen_shows_in_full_is_kept() {
        assert_eq!(
            fit_on_screen(at(100, 50, 1200, 800), &[LAPTOP, RIGHT]),
            Some(at(100, 50, 1200, 800))
        );
        assert_eq!(
            fit_on_screen(at(2000, 100, 1600, 900), &[LAPTOP, RIGHT]),
            Some(at(2000, 100, 1600, 900))
        );
    }

    #[test]
    fn a_window_hanging_off_a_screen_is_moved_back_onto_it() {
        assert_eq!(
            fit_on_screen(at(-300, 900, 1200, 800), &[LAPTOP]),
            Some(at(0, 240, 1200, 800))
        );
    }

    #[test]
    fn a_window_across_two_screens_goes_onto_the_one_that_shows_most_of_it() {
        // 400 px on the laptop, 800 px on the screen to the right.
        assert_eq!(
            fit_on_screen(at(1520, 100, 1200, 800), &[LAPTOP, RIGHT]),
            Some(at(1920, 100, 1200, 800))
        );
    }

    #[test]
    fn a_window_bigger_than_its_screen_is_shrunk_to_fit() {
        // Saved on a bigger screen, or before the resolution was lowered.
        assert_eq!(
            fit_on_screen(at(100, 100, 2400, 1300), &[LAPTOP]),
            Some(at(0, 0, 1920, 1040))
        );
    }

    #[test]
    fn a_window_on_a_screen_that_is_gone_opens_in_the_default_place() {
        assert_eq!(fit_on_screen(at(2000, 100, 1600, 900), &[LAPTOP]), None);
        assert_eq!(fit_on_screen(at(100, 100, 1200, 800), &[]), None);
        // Nothing to show.
        assert_eq!(fit_on_screen(at(100, 100, 0, 800), &[LAPTOP]), None);
    }

    #[test]
    fn the_saved_window_is_read_back_and_junk_is_ignored() {
        let dir =
            std::env::temp_dir().join(format!("scrivon-window-state-{}", uuid::Uuid::new_v4()));
        let file = WindowStateFile::new(Some(&dir));
        let path = file.0.clone().unwrap();
        assert_eq!(read_state(&path), None);

        let saved = SavedWindow {
            bounds: at(-1500, 20, 1400, 900),
            maximized: true,
        };
        write_state(&path, &saved).unwrap();
        assert_eq!(read_state(&path), Some(saved));

        std::fs::write(&path, b"\0\0\0").unwrap();
        assert_eq!(read_state(&path), None);
        std::fs::write(&path, br#"{"bounds":{"x":1}}"#).unwrap();
        assert_eq!(read_state(&path), None);

        std::fs::remove_dir_all(&dir).unwrap();
        assert_eq!(WindowStateFile::new(None).0, None);
    }

    #[cfg(windows)]
    mod placement {
        use super::super::*;

        fn placement(show_cmd: u32, flags: u32, normal: Rect) -> WindowPlacement {
            WindowPlacement {
                length: std::mem::size_of::<WindowPlacement>() as u32,
                flags,
                show_cmd,
                min_position: Point { x: -1, y: -1 },
                max_position: Point { x: -1, y: -1 },
                normal_position: normal,
            }
        }

        const NORMAL: Rect = Rect {
            left: 100,
            top: 50,
            right: 1300,
            bottom: 850,
        };

        #[test]
        fn a_normal_window_is_saved_where_it_is() {
            assert_eq!(
                saved_from_placement(&placement(SW_SHOWNORMAL, 0, NORMAL), (0, 0)),
                Some(SavedWindow {
                    bounds: Bounds {
                        x: 100,
                        y: 50,
                        width: 1200,
                        height: 800
                    },
                    maximized: false
                })
            );
        }

        #[test]
        fn a_maximised_window_is_saved_with_the_size_it_goes_back_to() {
            let saved =
                saved_from_placement(&placement(SW_SHOWMAXIMIZED, 0, NORMAL), (0, 0)).unwrap();
            assert!(saved.maximized);
            assert_eq!((saved.bounds.width, saved.bounds.height), (1200, 800));
        }

        #[test]
        fn a_window_minimised_from_maximised_is_saved_as_maximised() {
            let minimised = |flags| {
                saved_from_placement(&placement(SW_SHOWMINIMIZED, flags, NORMAL), (0, 0)).unwrap()
            };
            assert!(minimised(WPF_RESTORETOMAXIMIZED).maximized);
            assert!(!minimised(0).maximized);
        }

        #[test]
        fn the_place_is_moved_from_the_work_area_onto_the_screen() {
            // A taskbar on the left: Windows counts from the right of it.
            let saved =
                saved_from_placement(&placement(SW_SHOWNORMAL, 0, NORMAL), (48, 0)).unwrap();
            assert_eq!((saved.bounds.x, saved.bounds.y), (148, 50));
        }

        #[test]
        fn a_window_with_no_size_is_not_saved() {
            let empty = Rect {
                left: 10,
                top: 10,
                right: 10,
                bottom: 400,
            };
            assert_eq!(
                saved_from_placement(&placement(SW_SHOWNORMAL, 0, empty), (0, 0)),
                None
            );
        }
    }
}
