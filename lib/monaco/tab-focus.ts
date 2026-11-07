// Monaco's own "Tab moves focus" switch, the one Ctrl+M (Ctrl+Shift+M on macOS) flips. It is
// shared by every editor. Only the editor panel loads this, with a dynamic import, so Monaco
// stays out of the static page.
export { TabFocus } from 'monaco-editor/editor/browser/config/tabFocus.js'
