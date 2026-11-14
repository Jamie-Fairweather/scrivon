//! Windows 11 Snap Layouts on the app's own maximise button (F42).
//!
//! Windows 11 shows Snap Layouts when the pointer rests on a window's
//! maximise button. It finds that button by asking the window what is under
//! the pointer (WM_NCHITTEST), and the answer has to be HTMAXBUTTON. Scrivon
//! draws its own title bar in the page (`decorations: false`), and the page
//! covers the whole window, so Windows only ever asked the webview, which
//! never gives that answer.
//!
//! So a small invisible window sits over the page's maximise button and
//! answers for it. The page says where the button is
//! (components/studio/shell/use-snap-layouts.ts). The invisible window gets
//! the button's clicks too, and tells the page when the pointer is over it,
//! so the button still lights up. Before Windows 11 nothing changes.

// The overlay exists on Windows only; elsewhere the logic is only tested.
#![cfg_attr(not(windows), allow(dead_code))]

use crate::system_menu::{SC_MAXIMIZE, SC_RESTORE};

/// Sent to the page when the pointer moves onto (true) or off (false) the button.
const HOVER_EVENT: &str = "maximize-button-hover";

/// Where the page's maximise button is, in physical pixels from the top-left
/// of the page (which fills the window).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
pub struct ButtonArea {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

impl ButtonArea {
    fn is_visible(&self) -> bool {
        self.width > 0 && self.height > 0
    }
}

/// Windows 11 is Windows 10.0 from build 22000.
fn has_snap_layouts(build: u32) -> bool {
    build >= 22000
}

/// A click restores a maximized window and maximizes any other, like the
/// page's own button did.
fn toggle_command(maximized: bool) -> u32 {
    if maximized {
        SC_RESTORE
    } else {
        SC_MAXIMIZE
    }
}

/// The button's name for screen readers, the same as the page's button and
/// Windows' own.
fn button_name(maximized: bool) -> &'static str {
    if maximized {
        "Restore"
    } else {
        "Maximize"
    }
}

/// What the pointer is doing on the button.
#[derive(Default)]
struct Pointer {
    over: bool,
    pressed: bool,
}

impl Pointer {
    /// The pointer moved on the button. True when it has just come on.
    fn moved(&mut self) -> bool {
        !std::mem::replace(&mut self.over, true)
    }

    /// The pointer went off the button, which also ends a press. True when it
    /// was on it.
    fn left(&mut self) -> bool {
        self.pressed = false;
        std::mem::take(&mut self.over)
    }

    fn pressed(&mut self) {
        self.pressed = true;
    }

    /// The button was let go. True when that ends a press on it: a click.
    fn released(&mut self) -> bool {
        std::mem::take(&mut self.pressed)
    }
}

/// Puts the invisible window over the page's maximise button at `area`, or
/// takes it away when `area` is `None` or empty. Does nothing before
/// Windows 11, nor outside Windows.
#[tauri::command]
pub fn set_maximize_button_area(
    window: tauri::WebviewWindow,
    area: Option<ButtonArea>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use tauri::Emitter;

        if !has_snap_layouts(native::windows_build()) {
            return Ok(());
        }
        // A plain number, so it can be sent to the main thread.
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let area = area.filter(ButtonArea::is_visible);
        let page = window.clone();
        // On the thread that owns the window. This command already runs there,
        // so this runs straight away and the page's updates stay in order.
        window
            .run_on_main_thread(move || {
                let on_hover = move |over: bool| {
                    let _ = page.emit_to(page.label(), HOVER_EVENT, over);
                };
                if let Err(err) = native::place(hwnd as native::Hwnd, area, on_hover) {
                    log::warn!("Could not set up Snap Layouts: {err}");
                }
            })
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    let _ = (window, area);
    Ok(())
}

#[cfg(windows)]
mod native {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::ptr::{null, null_mut};
    use std::rc::Rc;
    use std::sync::Once;

    use super::{button_name, toggle_command, ButtonArea, Pointer};

    pub type Hwnd = *mut c_void;

    const WM_NCDESTROY: u32 = 0x0082;
    pub(super) const WM_NCHITTEST: u32 = 0x0084;
    pub(super) const WM_NCMOUSEMOVE: u32 = 0x00A0;
    pub(super) const WM_NCLBUTTONDOWN: u32 = 0x00A1;
    pub(super) const WM_NCLBUTTONUP: u32 = 0x00A2;
    const WM_NCLBUTTONDBLCLK: u32 = 0x00A3;
    pub(super) const WM_SYSCOMMAND: u32 = 0x0112;
    pub(super) const WM_NCMOUSELEAVE: u32 = 0x02A2;
    pub(super) const HTMAXBUTTON: isize = 9;
    const WS_CLIPSIBLINGS: u32 = 0x0400_0000;
    const WS_CHILD: u32 = 0x4000_0000;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_SHOWWINDOW: u32 = 0x0040;
    const TME_LEAVE: u32 = 0x0002;
    const TME_NONCLIENT: u32 = 0x0010;
    const IDC_ARROW: usize = 32512;

    /// The invisible window's class.
    const CLASS: &str = "ScrivonSnapLayouts";
    /// Tauri's window for resizing by the edges (tauri-runtime-wry's
    /// undecorated_resizing.rs). The overlay stays under it, so the top edge
    /// over the button still resizes the window.
    const RESIZE_BORDERS_CLASS: &str = "TAURI_DRAG_RESIZE_BORDERS";

    type WndProc = unsafe extern "system" fn(Hwnd, u32, usize, isize) -> isize;

    #[repr(C)]
    struct WndClassExW {
        size: u32,
        style: u32,
        wnd_proc: Option<WndProc>,
        class_extra: i32,
        window_extra: i32,
        instance: *mut c_void,
        icon: *mut c_void,
        cursor: *mut c_void,
        background: *mut c_void,
        menu_name: *const u16,
        class_name: *const u16,
        small_icon: *mut c_void,
    }

    #[repr(C)]
    struct TrackMouseEventInfo {
        size: u32,
        flags: u32,
        track: Hwnd,
        hover_time: u32,
    }

    #[repr(C)]
    struct OsVersionInfo {
        size: u32,
        major: u32,
        minor: u32,
        build: u32,
        platform: u32,
        service_pack: [u16; 128],
    }

    #[link(name = "user32")]
    extern "system" {
        fn RegisterClassExW(class: *const WndClassExW) -> u16;
        fn CreateWindowExW(
            ex_style: u32,
            class_name: *const u16,
            window_name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: *mut c_void,
            instance: *mut c_void,
            param: *const c_void,
        ) -> Hwnd;
        fn DestroyWindow(hwnd: Hwnd) -> i32;
        fn DefWindowProcW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn SetWindowTextW(hwnd: Hwnd, text: *const u16) -> i32;
        fn SetWindowPos(
            hwnd: Hwnd,
            insert_after: Hwnd,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
        fn FindWindowExW(
            parent: Hwnd,
            child_after: Hwnd,
            class_name: *const u16,
            window_name: *const u16,
        ) -> Hwnd;
        fn LoadCursorW(instance: *mut c_void, name: *const u16) -> *mut c_void;
        fn TrackMouseEvent(info: *mut TrackMouseEventInfo) -> i32;
        fn IsZoomed(hwnd: Hwnd) -> i32;
        fn PostMessageW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> *mut c_void;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn RtlGetVersion(info: *mut OsVersionInfo) -> i32;
    }

    struct Overlay {
        hwnd: Hwnd,
        parent: Hwnd,
        pointer: Pointer,
        on_hover: OnHover,
    }

    /// Tells the page whether the pointer is on the button.
    type OnHover = Rc<dyn Fn(bool)>;

    thread_local! {
        /// The overlay, on the thread that owns it and its window.
        static OVERLAY: RefCell<Option<Overlay>> = const { RefCell::new(None) };
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain([0]).collect()
    }

    /// The Windows build number. RtlGetVersion gives the real one, which
    /// GetVersionEx doesn't always.
    pub fn windows_build() -> u32 {
        // SAFETY: `info` is the size the call expects, and says so.
        unsafe {
            let mut info: OsVersionInfo = std::mem::zeroed();
            info.size = std::mem::size_of::<OsVersionInfo>() as u32;
            if RtlGetVersion(&mut info) != 0 {
                return 0;
            }
            info.build
        }
    }

    /// The overlay on this thread, if there is one.
    #[cfg(test)]
    pub fn overlay() -> Option<Hwnd> {
        OVERLAY.with_borrow(|overlay| overlay.as_ref().map(|o| o.hwnd))
    }

    /// Puts the overlay over the button at `area` in `parent`, making it the
    /// first time, or takes it away for `None`. `on_hover` hears when the
    /// pointer comes onto (true) or goes off (false) the button. Must run on
    /// the thread that owns `parent`.
    pub fn place(
        parent: Hwnd,
        area: Option<ButtonArea>,
        on_hover: impl Fn(bool) + 'static,
    ) -> Result<(), String> {
        let Some(area) = area else {
            remove();
            return Ok(());
        };
        let current = OVERLAY.with_borrow(|overlay| {
            overlay
                .as_ref()
                .filter(|o| o.parent == parent)
                .map(|o| o.hwnd)
        });
        let hwnd = match current {
            Some(hwnd) => hwnd,
            None => {
                remove();
                let hwnd = create(parent)?;
                OVERLAY.set(Some(Overlay {
                    hwnd,
                    parent,
                    pointer: Pointer::default(),
                    on_hover: Rc::new(on_hover),
                }));
                hwnd
            }
        };
        let resize_borders = wide(RESIZE_BORDERS_CLASS);
        // SAFETY: `hwnd` is the overlay and `parent` its window, both owned by
        // this thread. The class name and window name outlive the calls.
        unsafe {
            // Screen readers name the button by the window's text. The page
            // moves the overlay when the window is maximized or restored,
            // because the button moves, so this keeps up.
            let name = wide(button_name(IsZoomed(parent) != 0));
            SetWindowTextW(hwnd, name.as_ptr());
            // Just under Tauri's resize window, or on top when there's none
            // (a null handle is HWND_TOP): over the page either way.
            let under = FindWindowExW(parent, null_mut(), resize_borders.as_ptr(), null());
            let flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
            if SetWindowPos(hwnd, under, area.x, area.y, area.width, area.height, flags) == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        Ok(())
    }

    fn remove() {
        if let Some(overlay) = OVERLAY.take() {
            // SAFETY: the overlay is a window of this thread.
            unsafe { DestroyWindow(overlay.hwnd) };
        }
    }

    fn create(parent: Hwnd) -> Result<Hwnd, String> {
        static REGISTER: Once = Once::new();
        let class = wide(CLASS);
        // SAFETY: the class and window are made with valid arguments, and
        // `class` outlives both calls. The class has no background brush and
        // the window never paints, so the page shows through it.
        unsafe {
            let instance = GetModuleHandleW(null());
            REGISTER.call_once(|| {
                RegisterClassExW(&WndClassExW {
                    size: std::mem::size_of::<WndClassExW>() as u32,
                    style: 0,
                    wnd_proc: Some(overlay_proc),
                    class_extra: 0,
                    window_extra: 0,
                    instance,
                    icon: null_mut(),
                    cursor: LoadCursorW(null_mut(), IDC_ARROW as *const u16),
                    background: null_mut(),
                    menu_name: null(),
                    class_name: class.as_ptr(),
                    small_icon: null_mut(),
                });
            });
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                null(),
                WS_CHILD | WS_CLIPSIBLINGS,
                0,
                0,
                0,
                0,
                parent,
                null_mut(),
                instance,
                null(),
            );
            if hwnd.is_null() {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(hwnd)
        }
    }

    /// Runs `f` on the pointer state when `hwnd` is the overlay, and hands
    /// back its answer, the page's hover callback and the parent window. The
    /// state is let go before anything is called, so a message that comes
    /// back in can't find it busy.
    fn with_pointer<T>(
        hwnd: Hwnd,
        f: impl FnOnce(&mut Pointer) -> T,
    ) -> Option<(T, OnHover, Hwnd)> {
        OVERLAY.with(|cell| {
            let mut overlay = cell.try_borrow_mut().ok()?;
            let overlay = overlay.as_mut().filter(|o| o.hwnd == hwnd)?;
            Some((
                f(&mut overlay.pointer),
                overlay.on_hover.clone(),
                overlay.parent,
            ))
        })
    }

    unsafe extern "system" fn overlay_proc(
        hwnd: Hwnd,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> isize {
        match msg {
            // The answer Windows 11 shows Snap Layouts for.
            WM_NCHITTEST => return HTMAXBUTTON,
            WM_NCMOUSEMOVE => {
                if let Some((true, on_hover, _)) = with_pointer(hwnd, Pointer::moved) {
                    // Ask for WM_NCMOUSELEAVE when the pointer goes off.
                    let mut track = TrackMouseEventInfo {
                        size: std::mem::size_of::<TrackMouseEventInfo>() as u32,
                        flags: TME_LEAVE | TME_NONCLIENT,
                        track: hwnd,
                        hover_time: 0,
                    };
                    TrackMouseEvent(&mut track);
                    on_hover(true);
                }
            }
            WM_NCMOUSELEAVE => {
                if let Some((true, on_hover, _)) = with_pointer(hwnd, Pointer::left) {
                    on_hover(false);
                }
            }
            // Handled here: Windows' own handling would maximize the overlay.
            WM_NCLBUTTONDOWN | WM_NCLBUTTONDBLCLK => {
                with_pointer(hwnd, Pointer::pressed);
                return 0;
            }
            WM_NCLBUTTONUP => {
                if let Some((true, _, parent)) = with_pointer(hwnd, Pointer::released) {
                    let command = toggle_command(IsZoomed(parent) != 0);
                    PostMessageW(parent, WM_SYSCOMMAND, command as usize, 0);
                }
                return 0;
            }
            // Destroyed with its window: forget it.
            WM_NCDESTROY => OVERLAY.with(|cell| {
                if let Ok(mut overlay) = cell.try_borrow_mut() {
                    if overlay.as_ref().is_some_and(|o| o.hwnd == hwnd) {
                        *overlay = None;
                    }
                }
            }),
            _ => {}
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snap_layouts_come_with_windows_11() {
        assert!(!has_snap_layouts(19045), "Windows 10 22H2");
        assert!(has_snap_layouts(22000), "Windows 11 21H2");
        assert!(has_snap_layouts(26200), "Windows 11 25H2");
    }

    #[test]
    fn the_button_lights_up_once_as_the_pointer_comes_on_and_goes_off() {
        let mut pointer = Pointer::default();
        assert!(pointer.moved(), "came on");
        assert!(!pointer.moved(), "still on");
        assert!(pointer.left(), "went off");
        assert!(!pointer.left(), "already off");
    }

    #[test]
    fn a_press_and_release_on_the_button_is_a_click() {
        let mut pointer = Pointer::default();
        pointer.moved();
        pointer.pressed();
        assert!(pointer.released());
        assert!(!pointer.released(), "one click per press");
    }

    #[test]
    fn a_press_that_leaves_the_button_is_not_a_click() {
        let mut pointer = Pointer::default();
        pointer.moved();
        pointer.pressed();
        pointer.left();
        pointer.moved();
        assert!(!pointer.released());
    }

    #[test]
    fn a_click_restores_a_maximized_window_and_maximizes_any_other() {
        assert_eq!(toggle_command(true), 0xF120, "SC_RESTORE");
        assert_eq!(toggle_command(false), 0xF030, "SC_MAXIMIZE");
    }

    #[test]
    fn screen_readers_hear_what_a_click_will_do() {
        assert_eq!(button_name(false), "Maximize");
        assert_eq!(button_name(true), "Restore");
    }

    #[test]
    fn an_empty_area_has_no_button_to_cover() {
        let area = |width, height| ButtonArea {
            x: 10,
            y: 0,
            width,
            height,
        };
        assert!(area(69, 48).is_visible());
        assert!(!area(0, 48).is_visible());
        assert!(!area(69, 0).is_visible());
    }
}

#[cfg(all(test, windows))]
mod native_tests {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::rc::Rc;

    use super::native::{
        self, Hwnd, WM_NCHITTEST, WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE,
        WM_NCMOUSEMOVE, WM_SYSCOMMAND,
    };
    use super::ButtonArea;

    const WS_OVERLAPPEDWINDOW: u32 = 0x00CF_0000;
    /// Which part of the window the pointer is on, as the mouse messages say.
    const HTMAXBUTTON: usize = native::HTMAXBUTTON as usize;
    const PM_REMOVE: u32 = 0x0001;

    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct Msg {
        hwnd: Hwnd,
        message: u32,
        wparam: usize,
        lparam: isize,
        time: u32,
        x: i32,
        y: i32,
        private: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn CreateWindowExW(
            ex_style: u32,
            class_name: *const u16,
            window_name: *const u16,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: *mut c_void,
            instance: *mut c_void,
            param: *const c_void,
        ) -> Hwnd;
        fn DestroyWindow(hwnd: Hwnd) -> i32;
        fn IsWindow(hwnd: Hwnd) -> i32;
        fn SendMessageW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> isize;
        fn GetWindowRect(hwnd: Hwnd, rect: *mut Rect) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, text: *mut u16, max: i32) -> i32;
        fn MapWindowPoints(from: Hwnd, to: Hwnd, points: *mut Rect, count: u32) -> i32;
        fn PeekMessageW(msg: *mut Msg, hwnd: Hwnd, min: u32, max: u32, remove: u32) -> i32;
    }

    /// A hidden top-level window standing in for Scrivon's.
    struct Parent(Hwnd);

    impl Parent {
        fn new() -> Self {
            let class: Vec<u16> = "STATIC".encode_utf16().chain([0]).collect();
            // SAFETY: plain window creation; `class` outlives the call.
            let hwnd = unsafe {
                CreateWindowExW(
                    0,
                    class.as_ptr(),
                    std::ptr::null(),
                    WS_OVERLAPPEDWINDOW,
                    0,
                    0,
                    800,
                    600,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null());
            Parent(hwnd)
        }
    }

    impl Drop for Parent {
        fn drop(&mut self) {
            // SAFETY: the window this test made, on this thread.
            unsafe { DestroyWindow(self.0) };
        }
    }

    const AREA: ButtonArea = ButtonArea {
        x: 662,
        y: 0,
        width: 69,
        height: 48,
    };

    fn place(parent: &Parent, area: Option<ButtonArea>) -> Rc<RefCell<Vec<bool>>> {
        let hovers = Rc::new(RefCell::new(Vec::new()));
        let seen = hovers.clone();
        native::place(parent.0, area, move |over| seen.borrow_mut().push(over)).unwrap();
        hovers
    }

    /// Where the overlay is, from the top-left of the parent's inside.
    fn area_in(parent: &Parent, overlay: Hwnd) -> Rect {
        let mut rect = Rect::default();
        // SAFETY: both are live windows of this thread; `rect` is two points.
        unsafe {
            GetWindowRect(overlay, &mut rect);
            MapWindowPoints(std::ptr::null_mut(), parent.0, &mut rect, 2);
        }
        rect
    }

    #[test]
    fn the_overlay_covers_the_button_and_tells_windows_it_is_a_maximize_button() {
        let parent = Parent::new();
        place(&parent, Some(AREA));
        let overlay = native::overlay().expect("an overlay");

        let rect = area_in(&parent, overlay);
        assert_eq!(
            (rect.left, rect.top, rect.right, rect.bottom),
            (662, 0, 731, 48)
        );
        // SAFETY: a live window of this thread.
        let hit = unsafe { SendMessageW(overlay, WM_NCHITTEST, 0, 0) };
        assert_eq!(hit, 9, "HTMAXBUTTON");
    }

    #[test]
    fn screen_readers_can_name_the_overlay() {
        let parent = Parent::new();
        place(&parent, Some(AREA));
        let overlay = native::overlay().unwrap();

        let mut text = [0u16; 32];
        // SAFETY: a live window of this thread; `text` holds `text.len()` characters.
        let len = unsafe { GetWindowTextW(overlay, text.as_mut_ptr(), text.len() as i32) };
        assert_eq!(String::from_utf16_lossy(&text[..len as usize]), "Maximize");
    }

    #[test]
    fn the_overlay_follows_the_button_and_goes_with_it() {
        let parent = Parent::new();
        place(&parent, Some(AREA));
        let overlay = native::overlay().unwrap();

        place(&parent, Some(ButtonArea { x: 100, ..AREA }));
        assert_eq!(native::overlay(), Some(overlay), "the same window, moved");
        assert_eq!(area_in(&parent, overlay).left, 100);

        place(&parent, None);
        assert_eq!(native::overlay(), None);
        // SAFETY: only asks whether the handle is still a window.
        assert_eq!(unsafe { IsWindow(overlay) }, 0);
    }

    #[test]
    fn the_page_hears_when_the_pointer_comes_on_and_goes_off() {
        let parent = Parent::new();
        let hovers = place(&parent, Some(AREA));
        let overlay = native::overlay().unwrap();

        // SAFETY: messages to a live window of this thread.
        unsafe {
            SendMessageW(overlay, WM_NCMOUSEMOVE, HTMAXBUTTON, 0);
            SendMessageW(overlay, WM_NCMOUSEMOVE, HTMAXBUTTON, 0);
            SendMessageW(overlay, WM_NCMOUSELEAVE, 0, 0);
        }

        assert_eq!(*hovers.borrow(), [true, false]);
    }

    #[test]
    fn a_click_on_the_overlay_maximizes_the_window() {
        let parent = Parent::new();
        place(&parent, Some(AREA));
        let overlay = native::overlay().unwrap();

        // SAFETY: messages to live windows of this thread; `msg` is written by PeekMessageW.
        let msg = unsafe {
            SendMessageW(overlay, WM_NCMOUSEMOVE, HTMAXBUTTON, 0);
            SendMessageW(overlay, WM_NCLBUTTONDOWN, HTMAXBUTTON, 0);
            SendMessageW(overlay, WM_NCLBUTTONUP, HTMAXBUTTON, 0);
            let mut msg = std::mem::zeroed::<Msg>();
            let found = PeekMessageW(&mut msg, parent.0, WM_SYSCOMMAND, WM_SYSCOMMAND, PM_REMOVE);
            assert_ne!(found, 0, "asked the window to maximize");
            msg
        };
        assert_eq!(msg.wparam, 0xF030, "SC_MAXIMIZE");
    }
}
