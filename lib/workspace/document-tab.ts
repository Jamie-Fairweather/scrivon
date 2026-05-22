import { getBaseName } from '@/lib/tauri/fs'
import type { DocumentTab } from '@/lib/workspace/types'

export function tabFromPath(path: string, content: string): DocumentTab {
    return {
        id: path,
        path,
        name: getBaseName(path),
        content,
        isDirty: false,
        isSaving: false,
    }
}
