import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { notifyError, notifySuccess, type NotifyAction } from '@/lib/notify'
import { getBaseName } from '@/lib/tauri/fs'

/** Long enough to reach the toast's Show in folder button. */
const SAVED_NOTICE_MS = 8_000

/** A toast button that opens File Explorer with the saved file selected. */
export function showInFolderAction(path: string): NotifyAction {
    return {
        label: 'Show in folder',
        onClick: () => {
            revealItemInDir(path).catch((err: unknown) => notifyError('Could not show the file', err))
        },
    }
}

/** Says a file was saved, with a Show in folder button. Under the name goes `description`, or else the path. */
export function notifyFileSaved(path: string, description = path): void {
    notifySuccess(`Saved ${getBaseName(path)}`, { description, timeout: SAVED_NOTICE_MS, action: showInFolderAction(path) })
}
