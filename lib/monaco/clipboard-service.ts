import type { IClipboardService } from 'monaco-editor/platform/clipboard/common/clipboardService.js'
import { notifyError } from '@/lib/notify'
import { readClipboardText, writeClipboardText } from '@/lib/tauri/clipboard'

/**
 * Monaco's clipboard, through lib/tauri/clipboard.ts. Monaco's own uses the browser's navigator.clipboard, which
 * can make WebView2 ask the user for clipboard access (#208): it reads the clipboard on every Ctrl+V (to look for
 * copied files), and writes it from the Copy button on hover popups (a spelling note, say). setup-monaco.ts hands
 * this to Monaco in its place.
 */
export function createMonacoClipboardService(): IClipboardService {
    // Kept in memory, as Monaco's own does: the find box's text, and text Monaco stores under a name of its own.
    let findText = ''
    const named = new Map<string, string>()
    return {
        _serviceBrand: undefined,
        // Nothing to do: the menus' Paste is lib/monaco/paste-command.ts, and Ctrl+V is the browser's paste.
        triggerPaste: () => undefined,
        async readText(type) {
            if (type) return named.get(type) ?? ''
            try {
                return await readClipboardText()
            } catch {
                // As Monaco's own: a snippet that takes in the clipboard gets nothing.
                return ''
            }
        },
        async writeText(text, type) {
            if (type) {
                named.set(type, text)
                return
            }
            try {
                await writeClipboardText(text)
            } catch (error) {
                notifyError("Couldn't copy", error)
            }
        },
        readFindText: async () => findText,
        async writeFindText(text) {
            findText = text
        },
        // Files copied in the app: Scrivon's editor never copies any, so a paste has none to look for.
        writeResources: async () => {},
        readResources: async () => [],
        hasResources: async () => false,
        readImage: async () => new Uint8Array(),
    }
}
