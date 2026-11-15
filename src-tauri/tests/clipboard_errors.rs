//! lib/tauri/clipboard.ts tells the clipboard plugin's errors apart by their English words, which are arboard's.
//! If an update to the plugin or to arboard changed those words, a pasted screenshot would show "Couldn't paste"
//! instead of pasting, and the tests there (which only copy the words) wouldn't notice. These would. Keep the
//! words here and there the same.

/// The error as the page gets it: the plugin turns arboard's error into a plain string.
fn as_the_page_gets_it(error: arboard::Error) -> String {
    let error = tauri_plugin_clipboard_manager::Error::from(error);
    let value = serde_json::to_value(&error).expect("the plugin's error turns into JSON");
    value
        .as_str()
        .expect("the plugin's error is a string")
        .to_owned()
}

#[test]
fn nothing_of_the_kind_on_the_clipboard_keeps_its_words() {
    let message = as_the_page_gets_it(arboard::Error::ContentNotAvailable);
    assert!(
        message.contains("not available in the requested format"),
        "{message}"
    );
}

#[test]
fn another_app_holding_the_clipboard_keeps_its_words() {
    let message = as_the_page_gets_it(arboard::Error::ClipboardOccupied);
    assert!(message.contains("held by another party"), "{message}");
}
