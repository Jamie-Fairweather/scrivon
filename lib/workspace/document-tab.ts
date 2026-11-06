import { getBaseName, normalizePath } from '@/lib/tauri/fs'
import type { DocumentTab } from '@/lib/workspace/types'

export function tabFromPath(path: string, content: string): DocumentTab {
    const normalized = normalizePath(path)
    return {
        id: normalized,
        path: normalized,
        name: getBaseName(normalized),
        content,
        isDirty: false,
        isSaving: false,
    }
}
