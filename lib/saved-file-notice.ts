import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { notifyError, notifySuccess, type NotifyAction } from '@/lib/notify'

/** Long enough to reach the toast's Show in folder button. */
export const SAVED_NOTICE_MS = 8_000

/** A toast button that opens File Explorer with the saved file selected. */
export function showInFolderAction(path: string): NotifyAction {
    return {
        label: 'Show in folder',
        onClick: () => {
            revealItemInDir(path).catch((err: unknown) => notifyError('Could not show the file', err))
        },
    }
}

/** Says a file was saved and where, with a Show in folder button. */
export function notifyFileSaved(path: string): void {
    const name = path.split(/[\\/]/).pop() || path
    notifySuccess(`Saved ${name}`, { description: path, timeout: SAVED_NOTICE_MS, action: showInFolderAction(path) })
}
