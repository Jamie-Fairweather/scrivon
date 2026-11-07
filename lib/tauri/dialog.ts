import { open, save, message, type DialogFilter } from '@tauri-apps/plugin-dialog'
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'

export type SaveDialogOptions = {
    title?: string
    defaultPath?: string
    filters?: DialogFilter[]
}

export async function pickSavePath(options: SaveDialogOptions): Promise<string | null> {
    if (!isTauri()) return null

    const selected = await save({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
    })

    if (!selected || Array.isArray(selected)) return null
    return selected
}

export async function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
    if (!isTauri()) return
    await writeFile(path, bytes)
}

export async function writeTextFileAtPath(path: string, content: string): Promise<void> {
    if (!isTauri()) return
    await writeTextFile(path, content)
}

export async function pickWorkspaceFolder(): Promise<string | null> {
    if (!isTauri()) return null

    const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Folder',
    })

    if (!selected || Array.isArray(selected)) return null

    await allowWorkspacePath(selected)
    return selected
}

export type OpenFileDialogOptions = {
    title?: string
    defaultPath?: string
    filters?: DialogFilter[]
}

/**
 * Asks the user for one file, such as a logo for exports. Nothing is added to the app's file access: the
 * picked file is read through the export's own command, so its folder doesn't need opening up.
 */
export async function pickOpenFile(options: OpenFileDialogOptions = {}): Promise<string | null> {
    if (!isTauri()) return null

    const selected = await open({
        directory: false,
        multiple: false,
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
    })

    if (!selected || Array.isArray(selected)) return null
    return selected
}

export async function showError(title: string, body: string): Promise<void> {
    if (!isTauri()) {
        console.error(title, body)
        return
    }

    await message(body, { title, kind: 'error' })
}

type ThreeButtons = { yes: string; no: string; cancel: string }

/** Asks a blocking question with three buttons. Anything other than the first two buttons counts as cancel. */
async function askThreeWay(title: string, body: string, buttons: ThreeButtons): Promise<'yes' | 'no' | 'cancel'> {
    if (!isTauri()) {
        // The browser build has no three-button dialog, so it can only go ahead or stop; it never drops work.
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') return 'cancel'
        return window.confirm(`${title}\n\n${body}\n\nOK: ${buttons.yes}. Cancel: ${buttons.cancel}.`) ? 'yes' : 'cancel'
    }

    const result = await message(body, { title, kind: 'warning', buttons })
    if (result === buttons.yes || result === 'Yes') return 'yes'
    if (result === buttons.no || result === 'No') return 'no'
    return 'cancel'
}

const MAX_LISTED_FILES = 10

function listFiles(lines: string[]): string {
    const shown = lines.slice(0, MAX_LISTED_FILES)
    const hidden = lines.length - shown.length
    return hidden > 0 ? [...shown, `…and ${hidden} more`].join('\n') : shown.join('\n')
}

export type UnsavedChangesChoice = 'save' | 'discard' | 'cancel'

/** Save / Don't Save / Cancel before closing files that have unsaved changes. */
export async function confirmUnsavedChanges(fileNames: string[]): Promise<UnsavedChangesChoice> {
    const question =
        fileNames.length === 1
            ? `Do you want to save the changes you made to ${fileNames[0]}?`
            : `Do you want to save the changes you made to ${fileNames.length} files?\n\n${listFiles(fileNames)}`
    const choice = await askThreeWay('Unsaved changes', `${question}\n\nYour changes will be lost if you don't save them.`, {
        yes: 'Save',
        no: "Don't Save",
        cancel: 'Cancel',
    })
    if (choice === 'yes') return 'save'
    if (choice === 'no') return 'discard'
    return 'cancel'
}

/** A file that couldn't be saved, or (`stillSaving`) whose save is taking too long and is still running. */
export type SaveFailure = { name: string; error?: string; stillSaving?: boolean }
export type SaveFailureChoice = 'retry' | 'discard' | 'cancel'

const STILL_SAVING = 'Still saving. The drive may be slow or offline.'

/**
 * Try Again / Close Without Saving / Cancel when files could not be saved before closing them. When every
 * save is only slow, the first button is Keep Waiting instead: trying again can only wait for the save
 * that is still running.
 */
export async function confirmCloseAfterSaveFailure(failures: SaveFailure[]): Promise<SaveFailureChoice> {
    const errorOf = (f: SaveFailure) => (f.stillSaving ? STILL_SAVING : f.error)
    const describe = (f: SaveFailure) => (errorOf(f) ? `${f.name}: ${errorOf(f)}` : f.name)
    const allSlow = failures.every((f) => f.stillSaving)
    let problem: string
    if (failures.length === 1) {
        const error = errorOf(failures[0]!)
        problem = allSlow
            ? `Scrivon is still saving ${failures[0]!.name}. The drive may be slow or offline.`
            : `Scrivon couldn't save ${failures[0]!.name}.${error ? `\n\n${error}` : ''}`
    } else {
        problem = `${allSlow ? `Scrivon is still saving ${failures.length} files.` : `Scrivon couldn't save ${failures.length} files.`}\n\n${listFiles(failures.map(describe))}`
    }
    const choice = await askThreeWay(
        allSlow ? 'Still saving' : "Couldn't save",
        `${problem}\n\nIf you close without saving, your changes will be lost.`,
        {
            yes: allSlow ? 'Keep Waiting' : 'Try Again',
            no: 'Close Without Saving',
            cancel: 'Cancel',
        }
    )
    if (choice === 'yes') return 'retry'
    if (choice === 'no') return 'discard'
    return 'cancel'
}

/**
 * Asks before opening a file big enough to make Scrivon slow. Resolves true when the user still wants it,
 * opened read-only; it can be made editable from there.
 */
export async function confirmOpenLargeFile(fileName: string, size: string): Promise<boolean> {
    const title = 'Large file'
    const body = `${fileName} is ${size}. Files this big can make Scrivon slow to respond.\n\nIt opens read-only. You can still choose to edit it.`
    const confirm = 'Open Read-Only'

    if (!isTauri()) {
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
        return window.confirm(`${title}\n\n${body}\n\nOK: ${confirm}.`)
    }

    const result = await message(body, { title, kind: 'warning', buttons: { ok: confirm, cancel: 'Cancel' } })
    return result === confirm || result === 'Ok'
}

/** What happened to a file outside Scrivon while it was open. */
export type DiskChange = 'changed' | 'deleted'

/**
 * Asks before a save replaces a file someone else changed, or puts back a file someone deleted.
 * Resolves true only when the user picks Overwrite (or Save Again); anything else keeps the file as it is.
 */
export async function confirmOverwriteDiskChange(fileName: string, change: DiskChange): Promise<boolean> {
    const changed = change === 'changed'
    const title = changed ? 'File changed on disk' : 'File deleted'
    const body = changed
        ? `${fileName} was changed outside Scrivon since you opened it.\n\nOverwrite it with your version? The other changes will be lost.`
        : `${fileName} was deleted or moved outside Scrivon.\n\nSave your version there again?`
    const confirm = changed ? 'Overwrite' : 'Save Again'
    const keep = "Don't Save"

    if (!isTauri()) {
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
        return window.confirm(`${title}\n\n${body}\n\nOK: ${confirm}. Cancel: ${keep}.`)
    }

    const result = await message(body, { title, kind: 'warning', buttons: { ok: confirm, cancel: keep } })
    return result === confirm || result === 'Ok'
}
