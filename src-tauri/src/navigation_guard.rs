//! Keeps the main window on Scrivon's own pages. Without this, a link the page
//! doesn't handle itself would replace Scrivon with a website, with no way
//! back but closing the app. Chromium's PDF viewer, used by the export
//! dialog's preview, opens a clicked link in the top page, not in its frame.
//! Web and email links go to the system's browser or mail app instead, and
//! anything else is dropped.
//!
//! On Windows, WebView2 only asks about the top page, so frames (the preview's
//! blob: PDF) still load.

use tauri::utils::config::{FrontendDist, WindowConfig};
use tauri::Url;
use tauri_plugin_opener::OpenerExt;

/// What to do when the main window is about to load a page.
#[derive(Debug, PartialEq, Eq)]
enum Navigation {
    /// One of Scrivon's own pages (a reload, say): load it.
    Stay,
    /// A web or email link: open it outside the app.
    OpenOutside,
    /// Anything else: ignore it.
    Block,
}

/// The links opened outside the app, as in `lib/monaco/link-opener.ts`.
const OUTSIDE_SCHEMES: [&str; 3] = ["http", "https", "mailto"];

fn navigation(url: &Url, app_url: &Url) -> Navigation {
    if same_origin(url, app_url) {
        Navigation::Stay
    } else if OUTSIDE_SCHEMES.contains(&url.scheme()) {
        Navigation::OpenOutside
    } else {
        Navigation::Block
    }
}

/// Same scheme, host and port. Not `Url::origin`: a `tauri://` address has an
/// opaque origin, which never equals another.
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}

/// Where the main window's pages come from, picked the way Tauri picks it: the
/// dev server in a dev build, otherwise the app's built-in address.
fn app_url(config: &tauri::Config, window: &WindowConfig, dev: bool) -> Url {
    let served = if dev {
        config.build.dev_url.clone()
    } else {
        match &config.build.frontend_dist {
            Some(FrontendDist::Url(url)) => Some(url.clone()),
            _ => None,
        }
    };
    served.unwrap_or_else(|| built_in_url(window.use_https_scheme))
}

/// The address Tauri serves the app's built-in pages from.
fn built_in_url(https: bool) -> Url {
    let url = match (cfg!(windows), https) {
        (true, true) => "https://tauri.localhost",
        (true, false) => "http://tauri.localhost",
        (false, _) => "tauri://localhost",
    };
    Url::parse(url).expect("the built-in address is a valid URL")
}

/// The check for the main window's `on_navigation`: true lets a page load.
pub fn guard(
    app: &tauri::AppHandle,
    window: &WindowConfig,
) -> impl Fn(&Url) -> bool + Send + 'static {
    let app_url = app_url(app.config(), window, tauri::is_dev());
    let app = app.clone();
    move |url| match navigation(url, &app_url) {
        Navigation::Stay => true,
        Navigation::OpenOutside => {
            let (app, url) = (app.clone(), url.to_string());
            // Off the window's thread: starting the browser can take a moment.
            std::thread::spawn(move || {
                if let Err(err) = app.opener().open_url(url, None::<&str>) {
                    eprintln!("Could not open a link: {err}");
                }
            });
            false
        }
        Navigation::Block => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{app_url, navigation, Navigation, Url};

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    fn check(target: &str) -> Navigation {
        navigation(&url(target), &url("http://tauri.localhost"))
    }

    #[test]
    fn stays_on_the_apps_own_pages() {
        assert_eq!(check("http://tauri.localhost/"), Navigation::Stay);
        assert_eq!(
            check("http://tauri.localhost/index.html?x=1#top"),
            Navigation::Stay
        );
        assert_eq!(check("http://TAURI.localhost:80/"), Navigation::Stay);
    }

    #[test]
    fn opens_web_and_email_links_outside_the_app() {
        for link in [
            "https://example.com/",
            "http://example.com/page",
            "mailto:ada@example.com",
            // Look like the app's address, but aren't.
            "https://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "http://tauri.localhost.example.com/",
        ] {
            assert_eq!(check(link), Navigation::OpenOutside, "{link}");
        }
    }

    #[test]
    fn ignores_anything_else() {
        for link in [
            "file:///C:/Windows/notepad.exe",
            "blob:http://tauri.localhost/0d9c1e40",
            "data:text/html,<p>hi</p>",
            "about:blank",
            "ms-settings:privacy",
        ] {
            assert_eq!(check(link), Navigation::Block, "{link}");
        }
    }

    #[test]
    fn compares_tauri_addresses_by_name() {
        // Their origin is opaque, so `Url::origin` would never match.
        let app = url("tauri://localhost");
        assert_eq!(
            navigation(&url("tauri://localhost/index.html"), &app),
            Navigation::Stay
        );
    }

    #[test]
    fn knows_where_the_apps_pages_come_from() {
        let config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &config.app.windows[0];

        // A dev build loads the dev server.
        assert_eq!(
            app_url(&config, window, true),
            url("http://localhost:3000/")
        );
        // A release build serves its pages itself.
        let built_in = if cfg!(windows) {
            "http://tauri.localhost/"
        } else {
            "tauri://localhost"
        };
        assert_eq!(app_url(&config, window, false), url(built_in));
    }
}
