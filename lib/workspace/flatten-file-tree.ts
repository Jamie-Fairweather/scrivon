import { getBaseName, isSupportedDocument } from '@/lib/tauri/fs'
import { collectFilePaths } from '@/lib/workspace/paths'
import type { FileNode } from '@/lib/workspace/types'

export function flattenSupportedFilePaths(nodes: FileNode[]): string[] {
    const paths = collectFilePaths(nodes)
    return [...paths].filter((path) => isSupportedDocument(getBaseName(path)))
}
