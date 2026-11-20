/**
 * What the editor says with no file open. In focus mode the explorer is hidden, so it says how to leave focus
 * mode instead, and the keys for Go to File when it has any.
 */
export function editorEmptyMessage(focusMode: boolean, goToFileKeys?: string): string {
    if (!focusMode) return 'Select a file from the explorer or create a new file.'
    const open = goToFileKeys ? `, or ${goToFileKeys} to open a file` : ''
    return `Focus mode is on. Press Esc to leave it${open}.`
}
