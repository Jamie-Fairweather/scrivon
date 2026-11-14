//! Downloads web images for PDF and Word exports, so they are embedded in the
//! file instead of fetched while the page prints. The page itself may only
//! talk to the app, so the app fetches them.
//!
//! Only http and https addresses are fetched, without cookies or a referrer,
//! and only a real image (checked by its first bytes) up to the export image
//! size limit is handed back.

use std::sync::OnceLock;
use std::time::Duration;

use base64::Engine;
use reqwest::header::CONTENT_TYPE;

use crate::pdf_export::{self, IMAGE_TOO_LARGE, MAX_EXPORT_IMAGE_BYTES};

/// How long one image may take in all, and to connect: a slow site shouldn't hold up the export for long.
const TIMEOUT: Duration = Duration::from_secs(20);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_REDIRECTS: usize = 5;

const NOT_A_WEB_ADDRESS: &str = "Only web addresses (http or https) can be downloaded.";
const NOT_AN_IMAGE: &str = "The address doesn't give a PNG, JPEG, GIF, WebP or SVG image.";

/// The image types an export can embed, each known by its first bytes.
const IMAGE_TYPES: [&str; 5] = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/svg+xml",
];

/// Downloads the web image at `url` as a data URL, for an export to embed.
#[tauri::command]
pub async fn fetch_export_image(url: String) -> Result<String, String> {
    fetch_image(shared_client()?, &url, MAX_EXPORT_IMAGE_BYTES).await
}

/// One client for every download, so images from the same site share a connection.
fn shared_client() -> Result<&'static reqwest::Client, String> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = client_builder()
        .build()
        .map_err(|_| "Couldn't start the download.".to_string())?;
    // Two downloads may start at once; whichever client is kept first is used by both.
    Ok(CLIENT.get_or_init(|| client))
}

/// A client that sends no referrer and keeps no cookies. The updater shares
/// its TLS setup: rustls with the ring provider.
fn client_builder() -> reqwest::ClientBuilder {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // Fails only when another thread installed one first, which is as good.
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    reqwest::Client::builder()
        .user_agent(concat!("Scrivon/", env!("CARGO_PKG_VERSION")))
        .referer(false)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .timeout(TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
}

/// `fetch_export_image` with its client and size limit given.
async fn fetch_image(
    client: &reqwest::Client,
    address: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let url = reqwest::Url::parse(address.trim()).map_err(|_| NOT_A_WEB_ADDRESS.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(NOT_A_WEB_ADDRESS.into());
    }
    let mut response = client.get(url).send().await.map_err(|err| failed(&err))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("The site answered {status}."));
    }
    // A web page, such as a sign-in or error page, is never a picture, even one with an SVG icon in it.
    let page = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim().to_ascii_lowercase().starts_with("text/html"));
    if page {
        return Err(NOT_AN_IMAGE.into());
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(IMAGE_TOO_LARGE.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|err| failed(&err))? {
        if bytes.len() + chunk.len() > max_bytes {
            return Err(IMAGE_TOO_LARGE.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mime = IMAGE_TYPES
        .into_iter()
        .find(|mime| pdf_export::content_matches(mime, &bytes))
        .ok_or_else(|| NOT_AN_IMAGE.to_string())?;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Why a download failed, in words the user can act on.
fn failed(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "The site took too long to answer.".into()
    } else if err.is_connect() {
        "Couldn't reach the site.".into()
    } else if err.is_redirect() {
        "The address sends the download round too many times.".into()
    } else {
        "Couldn't download the image.".into()
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

    /// A client that never goes through a proxy, so it reaches the test server.
    fn local_client() -> reqwest::Client {
        client_builder().no_proxy().build().unwrap()
    }

    /// An HTTP response with `headers` (each ending `\r\n`) and `body`.
    fn response(status: &str, headers: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    /// Answers one request on a free local port with `reply`, and gives the address.
    fn serve_once(reply: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(&reply);
            }
        });
        format!("http://{address}/image")
    }

    fn fetch(address: &str) -> Result<String, String> {
        fetch_limited(address, 1024)
    }

    fn fetch_limited(address: &str, max_bytes: usize) -> Result<String, String> {
        tauri::async_runtime::block_on(fetch_image(&local_client(), address, max_bytes))
    }

    #[test]
    fn downloads_a_web_image_as_a_data_url() {
        let address = serve_once(response("200 OK", "Content-Type: image/png\r\n", PNG));

        assert_eq!(
            fetch(&address),
            Ok("data:image/png;base64,iVBORw0KGgo=".into())
        );
    }

    #[test]
    fn knows_an_image_by_its_bytes_whatever_the_site_calls_it() {
        let svg = b"<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>";
        let address = serve_once(response(
            "200 OK",
            "Content-Type: application/octet-stream\r\n",
            svg,
        ));

        let url = fetch(&address).unwrap();

        assert!(url.starts_with("data:image/svg+xml;base64,"), "{url}");
    }

    #[test]
    fn only_fetches_web_addresses() {
        for address in [
            "file:///C:/secret.png",
            "ftp://example.com/a.png",
            "not a url",
        ] {
            assert_eq!(
                fetch(address),
                Err("Only web addresses (http or https) can be downloaded.".into()),
                "{address}"
            );
        }
    }

    #[test]
    fn says_what_the_site_answered() {
        let address = serve_once(response("404 Not Found", "", b"gone"));

        assert_eq!(
            fetch(&address),
            Err("The site answered 404 Not Found.".into())
        );
    }

    #[test]
    fn refuses_a_web_page_or_anything_else_that_is_not_an_image() {
        let page = serve_once(response(
            "200 OK",
            "Content-Type: text/html; charset=utf-8\r\n",
            b"<html><svg></svg></html>",
        ));
        let text = serve_once(response("200 OK", "Content-Type: image/png\r\n", b"hello"));

        for address in [page, text] {
            assert_eq!(
                fetch(&address),
                Err("The address doesn't give a PNG, JPEG, GIF, WebP or SVG image.".into())
            );
        }
    }

    #[test]
    fn refuses_an_image_over_the_limit() {
        let mut big = PNG.to_vec();
        big.resize(2048, 0);
        let said = serve_once(response("200 OK", "", &big));
        // No length given up front: it is counted as it arrives.
        let mut unsaid = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
        unsaid.extend_from_slice(&big);
        let streamed = serve_once(unsaid);

        for address in [said, streamed] {
            assert_eq!(
                fetch(&address),
                Err("Image is too large to embed in the export (limit 12 MB).".into())
            );
        }
    }

    #[test]
    fn every_download_shares_one_client() {
        let first = shared_client().unwrap();

        assert!(std::ptr::eq(first, shared_client().unwrap()));
    }

    #[test]
    fn says_when_the_site_cannot_be_reached() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/a.png", listener.local_addr().unwrap());
        drop(listener);

        assert_eq!(fetch(&address), Err("Couldn't reach the site.".into()));
    }
}
