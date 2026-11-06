import { readDir, readFile, writeFile, writeTextFile, mkdir, rename, remove, stat, lstat, exists, type DirEntry } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { decodeText, DEFAULT_TEXT_FORMAT, encodeText, type DecodedText, type TextFileFormat } from '@/lib/workspace/text-encoding'
import type { FileNode, FileStamp } from '@/lib/workspace/types'

/** Thrown instead of saving over a file that was changed, or deleted, outside Scrivon since it was read. */
export class DiskChangedError extends Error {
    readonly path: string
    readonly change: 'changed' | 'deleted'

    constructor(path: string, change: 'changed' | 'deleted') {
        super(change === 'changed' ? 'It was changed outside Scrivon since you opened it.' : 'It was deleted or moved outside Scrivon.')
        this.name = 'DiskChangedError'
        this.path = path
        this.change = change
    }
}

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
            if (isSaveTempFile(entry.name)) continue
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

function stampOf(info: { size: number; mtime: Date | null }): FileStamp {
    return { mtimeMs: info.mtime ? info.mtime.getTime() : null, size: info.size }
}

/** True when the file now on disk isn't the one `before` was taken from. Sizes always count; times only when both are known. */
export function stampChanged(before: FileStamp, now: FileStamp): boolean {
    if (before.size !== now.size) return true
    return before.mtimeMs !== null && now.mtimeMs !== null && before.mtimeMs !== now.mtimeMs
}

async function readStamp(path: string): Promise<FileStamp | null> {
    try {
        return stampOf(await stat(path))
    } catch {
        return null
    }
}

export type TextFileRead = DecodedText & { stamp: FileStamp | null }

/**
 * Reads a file as text, noting how it is stored (UTF-8 or UTF-16, with or without a mark) so a save can
 * keep it that way, and its stamp so a save can tell whether someone else changed it in the meantime.
 */
export async function readWorkspaceTextFile(path: string): Promise<TextFileRead> {
    if (!isTauri()) return { content: '', format: DEFAULT_TEXT_FORMAT, stamp: null }
    // Stamped before reading: a change made during the read then looks like a change, never the other way round.
    const stamp = await readStamp(path)
    return { ...decodeText(await readFile(path)), stamp }
}

export async function readWorkspaceFile(path: string): Promise<string> {
    return (await readWorkspaceTextFile(path)).content
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

const SAVE_TEMP_FILE = /^\.scrivon-save-[a-z0-9]+\.tmp$/

/** The temporary file a save writes before it replaces the real one. Left behind only if the app dies mid-save. */
function isSaveTempFile(name: string): boolean {
    return SAVE_TEMP_FILE.test(name)
}

function saveTempPath(path: string): string {
    const id = Math.random().toString(36).slice(2, 10) || '0'
    return joinPath(getParentPath(path), `.scrivon-save-${id}.tmp`)
}

/** Antivirus, sync and search tools can hold a just-written file for a moment, so replacing it is tried a few times. */
const REPLACE_ATTEMPTS = 5
const REPLACE_RETRY_MS = 50

async function replaceFile(tempPath: string, path: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await rename(tempPath, path)
            return
        } catch (err) {
            if (attempt >= REPLACE_ATTEMPTS) throw err
            await new Promise((resolve) => setTimeout(resolve, REPLACE_RETRY_MS))
        }
    }
}

/** What is at `path` now, or null when nothing is. */
async function inspectFile(path: string): Promise<{ link: boolean; stamp: FileStamp } | null> {
    let info: Awaited<ReturnType<typeof lstat>>
    try {
        info = await lstat(path)
    } catch (err) {
        if (!(await exists(path))) return null
        throw err
    }
    // A link is written through, not replaced: replacing would turn it into a plain file cut off from the file it points to.
    const link = info.isSymlink || (info.nlink ?? 1) > 1
    if (!info.isSymlink) return { link, stamp: stampOf(info) }
    try {
        return { link, stamp: stampOf(await stat(path)) }
    } catch {
        // The link points at a file that is gone.
        return null
    }
}

export type WriteWorkspaceFileOptions = {
    /** The file's encoding, from readWorkspaceTextFile. UTF-8 when left out. */
    format?: TextFileFormat
    /**
     * The stamp from when the file was read or last saved. When given, the save is refused with
     * DiskChangedError if the file changed or went away since; `null` only checks it is still there.
     */
    expected?: FileStamp | null
}

/**
 * Saves text in the file's own encoding. The bytes go to a temporary file next to it, which then replaces
 * the file in one step. So a save that fails or is cut short (full disk, unplugged drive, crash) leaves the
 * old version, never an empty or half-written file. If the replace fails, the temporary file is removed.
 * Resolves to the saved file's new stamp (null if it couldn't be read).
 */
export async function writeWorkspaceFile(
    path: string,
    content: string,
    { format = DEFAULT_TEXT_FORMAT, expected }: WriteWorkspaceFileOptions = {}
): Promise<FileStamp | null> {
    if (!isTauri()) return null
    const current = await inspectFile(path)
    if (expected !== undefined) {
        if (!current) throw new DiskChangedError(path, 'deleted')
        if (expected && stampChanged(expected, current.stamp)) throw new DiskChangedError(path, 'changed')
    }
    const bytes = encodeText(content, format)
    if (current?.link) {
        await writeFile(path, bytes)
        return readStamp(path)
    }
    const tempPath = saveTempPath(path)
    await writeFile(tempPath, bytes, { createNew: true })
    try {
        await replaceFile(tempPath, path)
    } catch (err) {
        try {
            await removeWorkspacePath(tempPath)
        } catch {
            // The save already failed; a stray temporary file is hidden from the explorer anyway.
        }
        throw err
    }
    return readStamp(path)
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
