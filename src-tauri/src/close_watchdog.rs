//! Lets a crashed or frozen window still be closed or reloaded (B25).
//!
//! Once a folder is open the page listens for close requests, and Tauri then
//! leaves every close (the X, Alt+F4, the taskbar's Close) to the page. A page
//! that has crashed or hung never answers, and the frameless window could only
//! be ended from Task Manager. So the page acknowledges each close request
//! first thing (`close_ack`), and when no acknowledgement arrives within a few
//! seconds Scrivon asks whether to close anyway. On Windows, WebView2 also
//! reports a page process that exits or stops responding, and Scrivon then
//! offers to reload the window or quit.

use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// How long the page has to acknowledge a close request.
const ACK_TIMEOUT: Duration = Duration::from_secs(4);
/// Said whenever the window may go without the page saving first.
const KEPT_COPIES: &str =
    "Kept copies of unsaved edits are offered when you open the folder again.";

#[derive(Default)]
pub struct CloseWatchdog(Mutex<Watch>);

#[derive(Default)]
struct Watch {
    state: State,
    /// Numbers the close requests, so a timer left from an earlier one is ignored.
    requests: u64,
}

#[derive(Default, Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    #[default]
    Idle,
    /// Waiting for the page to acknowledge this close request.
    Armed(u64),
    /// The page didn't answer, and the user is being asked.
    Asking,
}

impl CloseWatchdog {
    /// A close request came in. Returns its number, or `None` while an earlier
    /// one is still waited for or asked about.
    fn arm(&self) -> Option<u64> {
        let mut watch = self.0.lock().unwrap();
        if watch.state != State::Idle {
            return None;
        }
        watch.requests += 1;
        watch.state = State::Armed(watch.requests);
        Some(watch.requests)
    }

    /// The page answered, so it handles the close itself (it may ask about
    /// unsaved changes, and the user may cancel).
    fn ack(&self) {
        let mut watch = self.0.lock().unwrap();
        if let State::Armed(_) = watch.state {
            watch.state = State::Idle;
        }
    }

    /// The wait for `request` is over: true when the page never answered it.
    fn timed_out(&self, request: u64) -> bool {
        let mut watch = self.0.lock().unwrap();
        if watch.state != State::Armed(request) {
            return false;
        }
        watch.state = State::Asking;
        true
    }

    /// The user answered, so the next close request is watched again.
    fn answered(&self) {
        self.0.lock().unwrap().state = State::Idle;
    }
}

/// Waits (`wait` is the timer) and, when the page never acknowledged
/// `request`, asks the user. True when the window should be closed anyway.
fn watch(
    watchdog: &CloseWatchdog,
    request: u64,
    wait: impl FnOnce(),
    ask: impl FnOnce() -> bool,
) -> bool {
    wait();
    if !watchdog.timed_out(request) {
        return false;
    }
    let close = ask();
    watchdog.answered();
    close
}

/// The page got a close request and is handling it.
#[tauri::command]
pub fn close_ack(watchdog: tauri::State<'_, CloseWatchdog>) {
    watchdog.ack();
}

/// Call for every close request on the main window.
pub fn on_close_requested(window: &tauri::Window) {
    let Some(request) = window.state::<CloseWatchdog>().arm() else {
        return;
    };
    let app = window.app_handle().clone();
    // The question blocks, so it can't be asked on the window's own thread.
    std::thread::spawn(move || {
        let close = watch(
            &app.state::<CloseWatchdog>(),
            request,
            || std::thread::sleep(ACK_TIMEOUT),
            || {
                // Closed after all: the page had no listener, or answered late.
                let Some(window) = app.get_webview_window("main") else {
                    return false;
                };
                app.dialog()
                    .message(format!(
                        "Scrivon isn't responding. Close anyway?\n\n{KEPT_COPIES}"
                    ))
                    .title("Scrivon")
                    .kind(MessageDialogKind::Warning)
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Close Anyway".into(),
                        "Keep Waiting".into(),
                    ))
                    .parent(&window)
                    .blocking_show()
            },
        );
        if close {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.destroy();
            }
        }
    });
}

/// Watches the main window's page process (Windows only: WebView2 reports it).
#[cfg(windows)]
pub fn watch_page_process(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    use tauri::webview::PlatformWebview;
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, ProcessFailedEventHandler};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app = app.clone();
    // One question at a time: a page that stays frozen is reported again and again.
    let asking = Arc::new(AtomicBool::new(false));
    let result = window.with_webview(move |webview: PlatformWebview| {
        let handler = ProcessFailedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
            // SAFETY: `args` is the live event argument WebView2 passed in.
            unsafe { args.ProcessFailedKind(&mut kind)? };
            let frozen = kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
            if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                // WebView2 itself is gone, and the window can't show anything again.
                log::error!("WebView2 stopped, so Scrivon is closing.");
                app.exit(1);
            } else if (frozen || kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED)
                && !asking.swap(true, Ordering::SeqCst)
            {
                let app = app.clone();
                let asking = asking.clone();
                std::thread::spawn(move || {
                    let choice = ask_after_page_failed(&app, frozen);
                    asking.store(false, Ordering::SeqCst);
                    match choice {
                        Some(PageChoice::Quit) => app.exit(0),
                        Some(PageChoice::Reload) => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.reload();
                            }
                        }
                        None => {}
                    }
                });
            }
            Ok(())
        }));
        let mut token = 0i64;
        // SAFETY: called on the window's thread with its live WebView2 controller.
        let added = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.add_ProcessFailed(&handler, &mut token))
        };
        if let Err(err) = added {
            log::warn!("Could not watch the window's page process: {err}");
        }
    });
    if let Err(err) = result {
        log::warn!("Could not watch the window's page process: {err}");
    }
}

#[cfg(any(windows, test))]
#[derive(Debug, PartialEq, Eq)]
enum PageChoice {
    Reload,
    Quit,
}

/// Reload or quit, or (for a page that is only frozen, which may recover)
/// keep waiting.
#[cfg(windows)]
fn ask_after_page_failed(app: &tauri::AppHandle, frozen: bool) -> Option<PageChoice> {
    let what = if frozen {
        "Scrivon isn't responding. You can reload the window, quit, or keep waiting."
    } else {
        "Scrivon's window stopped working. Reload it to carry on, or quit."
    };
    let mut dialog = app
        .dialog()
        .message(format!("{what}\n\n{KEPT_COPIES}"))
        .title("Scrivon")
        .kind(MessageDialogKind::Warning)
        .buttons(page_failed_buttons(frozen));
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    page_choice(dialog.blocking_show_with_result(), frozen)
}

/// Esc, the question's close button and Alt+F4 all pick the last (cancel)
/// button, so that one is the safe choice: keep waiting for a frozen page, and
/// reload one that has exited, since it shows nothing until then.
#[cfg(any(windows, test))]
fn page_failed_buttons(frozen: bool) -> MessageDialogButtons {
    if frozen {
        MessageDialogButtons::YesNoCancelCustom(
            "Reload".into(),
            "Quit".into(),
            "Keep Waiting".into(),
        )
    } else {
        MessageDialogButtons::OkCancelCustom("Quit".into(), "Reload".into())
    }
}

#[cfg(any(windows, test))]
fn page_choice(
    answer: tauri_plugin_dialog::MessageDialogResult,
    frozen: bool,
) -> Option<PageChoice> {
    use tauri_plugin_dialog::MessageDialogResult;

    match answer {
        MessageDialogResult::Custom(label) if label == "Quit" => Some(PageChoice::Quit),
        MessageDialogResult::Custom(label) if label == "Reload" => Some(PageChoice::Reload),
        // Not expected (the buttons above are all named), but a page that has
        // exited shows nothing, so it is reloaded rather than left blank.
        _ if !frozen => Some(PageChoice::Reload),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[test]
    fn a_close_the_page_acknowledged_is_left_to_the_page() {
        let watchdog = CloseWatchdog::default();
        let request = watchdog.arm().unwrap();
        watchdog.ack();

        let asked = Cell::new(false);
        let close = watch(
            &watchdog,
            request,
            || {},
            || {
                asked.set(true);
                true
            },
        );

        assert!(!close);
        assert!(!asked.get());
    }

    #[test]
    fn a_close_the_page_never_acknowledged_asks_the_user() {
        let watchdog = CloseWatchdog::default();
        let request = watchdog.arm().unwrap();

        assert!(watch(&watchdog, request, || {}, || true));

        let request = watchdog.arm().unwrap();
        assert!(!watch(&watchdog, request, || {}, || false));
    }

    #[test]
    fn a_close_the_user_cancelled_is_watched_again_next_time() {
        let watchdog = CloseWatchdog::default();
        let first = watchdog.arm().unwrap();
        watchdog.ack();
        // The page asked about unsaved changes and the user cancelled.
        let second = watchdog.arm().expect("watched again");

        // The first request's timer runs out after the second request came in.
        assert!(!watch(
            &watchdog,
            first,
            || {},
            || panic!("asked for the old request")
        ));
        // The page has frozen since, so the second one is asked about.
        assert!(watch(&watchdog, second, || {}, || true));
    }

    #[test]
    fn asks_once_however_often_the_window_is_closed_meanwhile() {
        let watchdog = CloseWatchdog::default();
        let request = watchdog.arm().unwrap();
        // The user clicks X again while the first request is waited for...
        assert_eq!(watchdog.arm(), None);

        let close = watch(
            &watchdog,
            request,
            || {},
            || {
                // ...and while being asked.
                assert_eq!(watchdog.arm(), None);
                false
            },
        );

        assert!(!close);
        assert!(watchdog.arm().is_some());
    }

    /// What dismissing a question answers: the dialog plugin turns Esc, the
    /// close button and Alt+F4 into the last (cancel) button's label.
    fn dismissed(buttons: MessageDialogButtons) -> tauri_plugin_dialog::MessageDialogResult {
        use tauri_plugin_dialog::MessageDialogResult;
        match buttons {
            MessageDialogButtons::OkCancelCustom(_, cancel)
            | MessageDialogButtons::YesNoCancelCustom(_, _, cancel) => {
                MessageDialogResult::Custom(cancel)
            }
            _ => MessageDialogResult::Cancel,
        }
    }

    #[test]
    fn dismissing_a_page_failure_question_never_quits() {
        // A frozen page may recover, and quitting would lose what it holds.
        assert_eq!(
            page_choice(dismissed(page_failed_buttons(true)), true),
            None
        );
        // A page that has exited is reloaded.
        assert_eq!(
            page_choice(dismissed(page_failed_buttons(false)), false),
            Some(PageChoice::Reload)
        );
    }

    #[test]
    fn a_page_failure_question_does_what_the_button_says() {
        use tauri_plugin_dialog::MessageDialogResult;
        let pressed = |label: &str| MessageDialogResult::Custom(label.into());

        for frozen in [true, false] {
            assert_eq!(page_choice(pressed("Quit"), frozen), Some(PageChoice::Quit));
            assert_eq!(
                page_choice(pressed("Reload"), frozen),
                Some(PageChoice::Reload)
            );
        }
        assert_eq!(page_choice(pressed("Keep Waiting"), true), None);
    }

    #[test]
    fn waits_before_deciding() {
        let watchdog = CloseWatchdog::default();
        let request = watchdog.arm().unwrap();

        // The acknowledgement arrives while the timer runs.
        assert!(!watch(&watchdog, request, || watchdog.ack(), || true));
    }
}
