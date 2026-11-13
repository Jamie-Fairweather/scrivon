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

/** Asks for a folder and lets the app read and write in it. `title` says what it is for. */
export async function pickWorkspaceFolder(title = 'Open Folder'): Promise<string | null> {
    if (!isTauri()) return null

    const selected = await open({
        directory: true,
        multiple: false,
        title,
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
 * Asks the user for one file, such as a logo for exports. The dialog plugin adds the picked file to the fs
 * scope; remember_export_image records it so the export can still read it after a restart.
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

/**
 * Asks a blocking question with three buttons. Anything other than the first two buttons counts as cancel.
 * The system dialog gives the keyboard to the first button, and Esc or closing it answers with the last, so
 * a choice that loses work only ever goes in the middle (`no`): a key typed as the question opens can't pick it.
 */
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

/**
 * Asks before deleting a folder that also holds folders the file list doesn't show (`hidden`, such as .git
 * or node_modules, from findHiddenFolders), since the user hasn't seen them. Resolves true only for Delete All.
 */
export async function confirmDeleteHiddenFolders(folderName: string, hidden: string[]): Promise<boolean> {
    const shown = hidden.slice(0, 3)
    const names =
        hidden.length > shown.length
            ? `${shown.join(', ')} and more`
            : shown.length === 1
              ? shown[0]!
              : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`
    const title = 'Delete hidden folders too?'
    const body = `${folderName} also has ${names} in it, which Scrivon doesn't show in the file list.\n\nDeleting ${folderName} moves them to the Recycle Bin too.`
    const confirm = 'Delete All'

    if (!isTauri()) {
        if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
        return window.confirm(`${title}\n\n${body}\n\nOK: ${confirm}.`)
    }

    return (await askThreeWay(title, body, { yes: 'Keep Folder', no: confirm, cancel: 'Cancel' })) === 'no'
}

export type KeptChangesChoice = 'save' | 'discard' | 'keep'

/**
 * Asks what to do with unsaved changes kept from last time when their folder can't be opened (moved, renamed
 * or deleted): save them as new files in another folder, discard them, or keep them for when it is back.
 * Closing the question keeps them.
 */
export async function confirmKeptChangesWithoutFolder(folderName: string, fileNames: string[]): Promise<KeptChangesChoice> {
    const what = fileNames.length === 1 ? `your unsaved changes to ${fileNames[0]}` : `your unsaved changes to ${fileNames.length} files`
    const list = fileNames.length > 1 ? `\n\n${listFiles(fileNames)}` : ''
    const body =
        `Scrivon kept ${what} from last time, but it can't open ${folderName} to put them back.${list}\n\n` +
        'You can save them as new files in another folder, or discard them. If the folder is only missing for now (on a drive that is unplugged, say), keep them for later.'
    const choice = await askThreeWay('Unsaved changes from last time', body, { yes: 'Save Copies…', no: 'Discard', cancel: 'Keep for Later' })
    if (choice === 'yes') return 'save'
    if (choice === 'no') return 'discard'
    return 'keep'
}
