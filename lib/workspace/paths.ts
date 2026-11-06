import { samePath } from '@/lib/tauri/fs'
import { isSupportedDocument } from '@/lib/workspace/file-types'
import type { FileNode } from '@/lib/workspace/types'

const INVALID_CHARS = /[<>:"|?*\x00-\x1f]/
/** Device names Windows won't use for a file or folder, with or without an extension (`con`, `nul.md`). */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i
const MAX_NAME_LENGTH = 255

/** Checks a file or folder name against the rules of Windows, the strictest of the systems Scrivon runs on. */
export function validateFileName(name: string): string | null {
    const trimmed = name.trim()
    if (!trimmed) return 'Name cannot be empty'
    if (INVALID_CHARS.test(trimmed)) return 'Name contains invalid characters'
    if (trimmed === '.' || trimmed === '..') return 'Invalid name'
    if (trimmed.includes('/') || trimmed.includes('\\')) return 'Name cannot contain path separators'
    // Windows quietly drops a trailing dot, so the item would get a different name from the one the app tracks.
    if (trimmed.endsWith('.')) return 'Name cannot end with a dot'
    const stem = trimmed.split('.')[0]!.trim()
    if (WINDOWS_RESERVED_NAME.test(stem)) return `"${stem}" is a reserved name on Windows`
    if (trimmed.length > MAX_NAME_LENGTH) return `Name is too long (${MAX_NAME_LENGTH} characters at most)`
    return null
}

/**
 * A name for a copy of `base` that no sibling uses: `notes copy.md`, then `notes copy 2.md`…
 * Names are compared ignoring letter case, because Windows treats `Notes copy.md` and `notes copy.md` as one file.
 */
export function uniqueFileName(base: string, existing: Iterable<string>): string {
    const taken = new Set([...existing].map((name) => name.toLowerCase()))
    const isTaken = (name: string) => taken.has(name.toLowerCase())
    if (!isTaken(base)) return base
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let i = 1
    while (isTaken(`${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`)) {
        i += 1
    }
    return `${stem} copy${i > 1 ? ` ${i}` : ''}${ext}`
}

/**
 * A name for a new file or folder that no sibling uses: `diagram.mmd`, then `diagram 2.mmd`, `diagram 3.mmd`…
 * Names are compared ignoring letter case, because Windows treats `Diagram.mmd` and `diagram.mmd` as one file.
 */
export function uniqueNewName(base: string, existing: Iterable<string>): string {
    const taken = new Set([...existing].map((name) => name.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    const dot = base.lastIndexOf('.')
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ''
    let i = 2
    while (taken.has(`${stem} ${i}${ext}`.toLowerCase())) {
        i += 1
    }
    return `${stem} ${i}${ext}`
}

export function collectFilePaths(nodes: FileNode[]): Set<string> {
    const paths = new Set<string>()
    const walk = (items: FileNode[]) => {
        for (const node of items) {
            if (node.kind === 'file') paths.add(node.path)
            else walk(node.children)
        }
    }
    walk(nodes)
    return paths
}

export function collectFileNames(nodes: FileNode[]): Set<string> {
    const names = new Set<string>()
    const walk = (items: FileNode[]) => {
        for (const node of items) {
            names.add(node.name)
            if (node.kind === 'directory') walk(node.children)
        }
    }
    walk(nodes)
    return names
}

/** Folders in the tree that couldn't be read, so they show up empty. */
export function collectUnreadableFolders(nodes: FileNode[]): FileNode[] {
    const found: FileNode[] = []
    const walk = (items: FileNode[]) => {
        for (const node of items) {
            if (node.kind !== 'directory') continue
            if (node.unreadable) found.push(node)
            else walk(node.children)
        }
    }
    walk(nodes)
    return found
}

export function findNodeByPath(nodes: FileNode[], path: string): FileNode | null {
    for (const node of nodes) {
        if (samePath(node.path, path)) return node
        if (node.kind === 'directory') {
            const found = findNodeByPath(node.children, path)
            if (found) return found
        }
    }
    return null
}

/** The entries directly inside `folderPath`, which is the workspace root or a folder in its tree. */
export function childrenOf(tree: FileNode[], rootPath: string | null, folderPath: string): FileNode[] {
    if (rootPath && samePath(folderPath, rootPath)) return tree
    const folder = findNodeByPath(tree, folderPath)
    return folder?.kind === 'directory' ? folder.children : []
}

/**
 * The sibling already using `name`, ignoring letter case (one file on Windows), or null.
 * `ignorePath` leaves out the entry being renamed, so `notes.md` -> `Notes.md` is allowed.
 */
export function findNameClash(siblings: FileNode[], name: string, ignorePath?: string): FileNode | null {
    const wanted = name.trim().toLowerCase()
    return siblings.find((node) => node.name.toLowerCase() === wanted && !(ignorePath && samePath(node.path, ignorePath))) ?? null
}

export function nameTakenMessage(node: FileNode): string {
    return `A ${node.kind === 'directory' ? 'folder' : 'file'} named "${node.name}" already exists here.`
}

export const UNSUPPORTED_FILE_NAME_MESSAGE = 'File name must end with .md, .mmd or .mermaid.'

/**
 * Why `name` can't be used for a new or renamed entry among `siblings`, or null when it can.
 * `ignorePath` is the entry being renamed, which may keep its own name.
 */
export function entryNameError(name: string, kind: FileNode['kind'], siblings: FileNode[], ignorePath?: string): string | null {
    const invalid = validateFileName(name)
    if (invalid) return invalid
    if (kind === 'file' && !isSupportedDocument(name.trim())) return UNSUPPORTED_FILE_NAME_MESSAGE
    const clash = findNameClash(siblings, name, ignorePath)
    return clash ? nameTakenMessage(clash) : null
}
