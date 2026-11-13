import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { notifyError, notifyInfo, notifySuccess } from '@/lib/notify'
import { pathInside } from '@/lib/tauri/fs'
import { displayPath } from '@/lib/workspace/display-path'

/** The path from the open folder (`docs\plan.md`), or null when it isn't inside it or no folder is open. */
export function relativeToWorkspace(path: string, workspaceRoot: string | null): string | null {
    return workspaceRoot ? pathInside(path, workspaceRoot) : null
}

/**
 * Opens File Explorer with the file or folder selected. Only for items inside the open folder, so a
 * menu can't be used to poke around the rest of the disk.
 */
export async function revealInFileExplorer(path: string, workspaceRoot: string | null): Promise<void> {
    if (relativeToWorkspace(path, workspaceRoot) === null) {
        notifyInfo("Can't show that in File Explorer", { description: 'Only files and folders inside the open folder can be shown.' })
        return
    }
    try {
        await revealItemInDir(path)
    } catch (err) {
        notifyError("Couldn't show it in File Explorer", err)
    }
}

/** Puts a path on the clipboard and confirms with a toast that shows it. */
export async function copyPath(path: string, kind: 'full' | 'relative' = 'full'): Promise<void> {
    try {
        // Missing where the page isn't allowed to use the clipboard.
        if (!navigator.clipboard?.writeText) throw new Error('No clipboard')
        await navigator.clipboard.writeText(path)
        notifySuccess(kind === 'relative' ? 'Relative path copied' : 'Path copied', { description: displayPath(path) })
    } catch (err) {
        notifyError("Couldn't copy the path", err)
    }
}
