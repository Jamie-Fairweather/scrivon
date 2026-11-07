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

/** Picks one file. Its folder is not added to the fs scope: export images are read by the read_export_image command. */
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
