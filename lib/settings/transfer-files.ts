import { pickOpenFile, pickSavePath } from '@/lib/tauri/dialog'
import { readWorkspaceFile } from '@/lib/tauri/fs'

/** Settings and export profiles are shared as JSON files. */
const JSON_FILES = [
    { name: 'JSON files', extensions: ['json'] },
    { name: 'All files', extensions: ['*'] },
]

/** Asks where to save a JSON file, starting at `defaultName`. Null when cancelled. */
export function pickJsonSavePath(title: string, defaultName: string): Promise<string | null> {
    return pickSavePath({ title, defaultPath: defaultName, filters: JSON_FILES })
}

/** Asks for a JSON file and reads it. Null when cancelled. */
export async function readChosenJsonFile(title: string): Promise<string | null> {
    const path = await pickOpenFile({ title, filters: JSON_FILES })
    return path ? readWorkspaceFile(path) : null
}
