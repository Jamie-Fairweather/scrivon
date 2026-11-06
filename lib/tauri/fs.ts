import { readDir, readFile, readTextFile, writeFile, writeTextFile, mkdir, rename, remove, stat, exists, type DirEntry } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import type { FileNode } from '@/lib/workspace/types'

/** Thrown instead of replacing a file or folder that is already there. */
export class PathExistsError extends Error {
    readonly path: string

    constructor(path: string) {
        super(`A file or folder named "${getBaseName(path)}" already exists here.`)
        this.name = 'PathExistsError'
        this.path = path
    }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'target', 'dist', 'build'])

/** Windows system folders at the top of a drive. Most can only be read by Windows itself, and none hold documents. */
const SKIP_SYSTEM_DIRS = new Set([
    'system volume information',
    '$recycle.bin',
    '$windows.~bt',
    '$windows.~ws',
    '$winreagent',
    '$sysreset',
    'config.msi',
])

function isSkippedDirectory(name: string): boolean {
    return SKIP_DIRS.has(name) || SKIP_SYSTEM_DIRS.has(name.toLowerCase())
}

function compareEntries(a: FileNode, b: FileNode): number {
    if (a.kind !== b.kind) {
        if (a.kind === 'directory') return -1
        return 1
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

async function readDirTree(dirPath: string): Promise<FileNode[]> {
    const entries = await readDir(dirPath)
    const nodes: FileNode[] = []

    for (const entry of entries) {
        const fullPath = joinPath(dirPath, entry.name)
        if (entry.isDirectory) {
            if (isSkippedDirectory(entry.name)) continue
            try {
                const children = await readDirTree(fullPath)
                nodes.push({ kind: 'directory', name: entry.name, path: fullPath, children })
            } catch {
                // One folder that can't be read (no permission, or deleted mid-scan) mustn't stop the rest from opening.
                nodes.push({ kind: 'directory', name: entry.name, path: fullPath, children: [], unreadable: true })
            }
        } else if (entry.isFile) {
            nodes.push({
                kind: 'file',
                name: entry.name,
                path: fullPath,
            })
        }
    }

    return nodes.sort(compareEntries)
}

/**
 * Reads the whole folder. Throws when the folder itself can't be read; a subfolder that can't be read
 * is kept, empty and marked `unreadable`.
 */
export async function listWorkspaceTree(rootPath: string): Promise<FileNode[]> {
    if (!isTauri()) return []
    return readDirTree(normalizePath(rootPath))
}

export async function readWorkspaceFile(path: string): Promise<string> {
    if (!isTauri()) return ''
    return readTextFile(path)
}

export async function getWorkspaceFileSize(path: string): Promise<number | null> {
    if (!isTauri()) return null
    try {
        const info = await stat(path)
        return typeof info.size === 'number' ? info.size : null
    } catch {
        return null
    }
}

export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
    if (!isTauri()) return
    await writeTextFile(path, content)
}

/** Creates a new folder. Throws PathExistsError if something with that name is already there. */
export async function createWorkspaceDirectory(path: string): Promise<void> {
    if (!isTauri()) return
    if (await exists(path)) throw new PathExistsError(path)
    // Not recursive: that quietly succeeds for an existing folder and recreates a parent deleted elsewhere.
    await mkdir(path)
}

/** Creates a new file. Never replaces an existing one: throws PathExistsError instead. */
export async function createWorkspaceFile(path: string, content: string): Promise<void> {
    if (!isTauri()) return
    if (await exists(path)) throw new PathExistsError(path)
    // createNew also refuses a file that turns up between the check and the write (and ignores letter case on Windows).
    await writeTextFile(path, content, { createNew: true })
}

/**
 * Renames a file or folder. The plugin's rename replaces a file already at the target, so this throws
 * PathExistsError instead. A change of letter case only (`a.md` -> `A.md`) is one entry on Windows and
 * macOS, so it is allowed unless the folder holds another entry with exactly the new name (Linux).
 */
export async function renameWorkspacePath(oldPath: string, newPath: string): Promise<void> {
    if (!isTauri()) return
    const oldName = getBaseName(oldPath)
    const newName = getBaseName(newPath)
    const parent = getParentPath(newPath)
    const caseOnly = samePath(getParentPath(oldPath), parent) && oldName.toLowerCase() === newName.toLowerCase()
    if (caseOnly) {
        if (oldName === newName) return
        const entries = await readDir(parent)
        if (entries.some((entry) => entry.name === newName)) throw new PathExistsError(newPath)
    } else if (await exists(newPath)) {
        throw new PathExistsError(newPath)
    }
    await rename(oldPath, newPath)
}

/**
 * Deletes a file, or a folder with `recursive` (everything inside it goes too). Without `recursive`
 * a folder that isn't empty is refused.
 */
export async function removeWorkspacePath(path: string, { recursive = false }: { recursive?: boolean } = {}): Promise<void> {
    if (!isTauri()) return
    await remove(path, { recursive })
}

/** The names of everything directly inside a folder, read from disk rather than the cached tree. */
export async function listFolderNames(dirPath: string): Promise<string[]> {
    if (!isTauri()) return []
    return (await readDir(dirPath)).map((entry) => entry.name)
}

/**
 * Copies a file to a new name. Never replaces an existing file (plain copy does): throws PathExistsError
 * instead. With `content`, such as a tab's unsaved edits, the copy holds that text instead of the disk version.
 */
export async function duplicateWorkspaceFile(sourcePath: string, destPath: string, content?: string): Promise<void> {
    if (!isTauri()) return
    if (await exists(destPath)) throw new PathExistsError(destPath)
    // createNew also refuses a file that turns up between the check and the write.
    if (content !== undefined) {
        await writeTextFile(destPath, content, { createNew: true })
        return
    }
    // Copying the bytes keeps the file's encoding exactly as it is.
    await writeFile(destPath, await readFile(sourcePath), { createNew: true })
}

export function compareFileNodes(a: FileNode, b: FileNode): number {
    return compareEntries(a, b)
}

const DRIVE_PREFIX = /^[a-zA-Z]:(?:[\\/]|$)/
const DRIVE_ROOT = /^[a-zA-Z]:\\?$/

/** True for Windows paths: a drive letter (`C:\…`) or a network share (`\\server\share`). */
export function isWindowsPath(path: string): boolean {
    return DRIVE_PREFIX.test(path) || path.startsWith('\\\\')
}

function separatorFor(path: string): '\\' | '/' {
    return isWindowsPath(path) ? '\\' : '/'
}

/**
 * Puts a path in the one form the app uses everywhere (tab ids, tree nodes, sessions).
 * Windows paths use `\` only; other paths use `/`. Repeated and trailing separators are
 * removed, except for a root such as `C:\` or `/`.
 */
export function normalizePath(path: string): string {
    if (isWindowsPath(path)) {
        const isShare = path.startsWith('\\\\')
        let result = path.replace(/[\\/]+/g, '\\')
        if (isShare) result = `\\${result}`
        result = result.replace(/\\+$/, '')
        return DRIVE_ROOT.test(result) ? `${result.slice(0, 2)}\\` : result
    }
    const result = path.replace(/\/+/g, '/')
    return result === '/' ? result : result.replace(/\/+$/, '')
}

function comparablePath(path: string): string {
    const normalized = normalizePath(path)
    // Windows file names ignore case, so `C:\Notes\A.md` and `c:\notes\a.md` are one file.
    return isWindowsPath(normalized) ? normalized.toLowerCase() : normalized
}

/** True when both paths point at the same file, whatever separators they use. */
export function samePath(a: string, b: string): boolean {
    return comparablePath(a) === comparablePath(b)
}

/** If `child` is inside the folder `parent`, returns the rest of its path; otherwise null. */
export function pathInside(child: string, parent: string): string | null {
    const normalizedChild = normalizePath(child)
    const normalizedParent = normalizePath(parent)
    const sep = separatorFor(normalizedParent)
    const prefix = normalizedParent.endsWith(sep) ? normalizedParent : `${normalizedParent}${sep}`
    if (normalizedChild.length <= prefix.length) return null
    if (!samePath(normalizedChild.slice(0, prefix.length), prefix)) return null
    return normalizedChild.slice(prefix.length)
}

export function isPathInside(child: string, parent: string): boolean {
    return pathInside(child, parent) !== null
}

export function joinPath(parent: string, name: string): string {
    const base = normalizePath(parent)
    const sep = separatorFor(base)
    return normalizePath(base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`)
}

export function getBaseName(path: string): string {
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1]!
}

export function getParentPath(path: string): string {
    const normalized = normalizePath(path)
    const sep = separatorFor(normalized)
    const index = normalized.lastIndexOf(sep)
    if (index < 0) return ''
    const parent = normalized.slice(0, index)
    if (sep === '/') return index === 0 ? '/' : parent
    return DRIVE_ROOT.test(parent) ? `${parent}\\` : parent
}

export { isMarkdownFile, isMermaidFile, isSupportedDocument, documentKind } from '@/lib/workspace/file-types'
export type { DocumentKind } from '@/lib/workspace/file-types'

export type { DirEntry }
