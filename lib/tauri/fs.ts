import {
    readDir,
    readFile,
    writeFile,
    writeTextFile,
    mkdir,
    rename,
    remove,
    stat,
    lstat,
    exists,
    copyFile,
    type DirEntry,
} from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { isSupportedDocument } from '@/lib/workspace/file-types'
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

/**
 * Tool, dependency and cache folders, skipped wherever they are. They can hold many thousands of folders,
 * never the user's documents, and their names aren't ones people give their own folders.
 */
const SKIP_DIRS = new Set([
    '.git',
    'node_modules',
    'bower_components',
    '.next',
    '.nuxt',
    '.svelte-kit',
    '.turbo',
    '.cache',
    '.parcel-cache',
    '.venv',
    'venv',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.tox',
    '.gradle',
    '.idea',
    '.vs',
])

const isDotNetProject = (name: string) => /\.(cs|fs|vb)proj$/.test(name)

/**
 * Build output folders whose names are ordinary words, plus AppData. Each is skipped only next to the file
 * that marks what made it: a tool's project file, or for AppData the NTUSER.DAT of a user's home folder,
 * which holds every app's own files and never documents. So a writer's own 'build', 'dist', 'target' or
 * 'AppData' folder still shows. Names are lower case.
 */
const BUILD_OUTPUT_DIRS = new Map<string, (siblingName: string) => boolean>([
    ['appdata', (name) => name === 'ntuser.dat'],
    ['target', (name) => name === 'cargo.toml' || name === 'pom.xml'],
    ['dist', (name) => name === 'package.json' || name === 'pyproject.toml' || name === 'setup.py'],
    [
        'build',
        (name) => ['package.json', 'build.gradle', 'build.gradle.kts', 'cmakelists.txt', 'pyproject.toml', 'setup.py', 'pubspec.yaml'].includes(name),
    ],
    ['obj', isDotNetProject],
    ['coverage', (name) => name === 'package.json'],
    ['pods', (name) => name === 'podfile'],
])

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

/**
 * True for a folder the file list leaves out: a tool, cache or system folder, or a build output folder
 * next to its project file. `siblingNames` are the names of everything else in the same folder.
 * Letter case doesn't matter, as on Windows.
 */
export function isHiddenFolder(name: string, siblingNames: readonly string[]): boolean {
    const lower = name.toLowerCase()
    if (SKIP_DIRS.has(lower) || SKIP_SYSTEM_DIRS.has(lower)) return true
    const isItsProjectFile = BUILD_OUTPUT_DIRS.get(lower)
    return isItsProjectFile ? siblingNames.some((sibling) => isItsProjectFile(sibling.toLowerCase())) : false
}

/** The text of an error from the app (plugin errors arrive as plain strings). */
function errorText(err: unknown): string {
    return err instanceof Error ? err.message : typeof err === 'string' ? err : ''
}

/** Folders listed at once while reading a tree. Each listing is a round trip to the app, so they overlap. */
const MAX_PARALLEL_READS = 8

type Limit = <T>(task: () => Promise<T>) => Promise<T>

/** Runs at most `max` tasks at a time; the rest wait their turn in order. */
function createLimit(max: number): Limit {
    let running = 0
    const waiting: Array<() => void> = []
    return async (task) => {
        if (running < max) running += 1
        // A finishing task hands its place straight to the next one, so `running` never goes over `max`.
        else await new Promise<void>((resolve) => waiting.push(resolve))
        try {
            return await task()
        } finally {
            const next = waiting.shift()
            if (next) next()
            else running -= 1
        }
    }
}

/** Sorts names as File Explorer does: numbers by value (chapter2 before chapter10), letter case ignored. */
const nameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

function compareEntries(a: FileNode, b: FileNode): number {
    if (a.kind !== b.kind) {
        if (a.kind === 'directory') return -1
        return 1
    }
    // Names that differ only in letter case (possible on Linux) still keep one order.
    return nameCollator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/**
 * Links Windows itself puts in user folders for old programs ('My Music' in Documents, 'All Users' in
 * C:\Users). Nobody can list them, and they only lead to folders that have their own place.
 */
const WINDOWS_COMPAT_LINKS = new Set([
    'my music',
    'my pictures',
    'my videos',
    'my documents',
    'all users',
    'default user',
    'application data',
    'local settings',
    'documents and settings',
])

/**
 * The app may only open what is inside the opened folder, and it checks where a link really leads. So a
 * link to a folder elsewhere (a shared notes folder on another drive) is refused with this error.
 */
const OUTSIDE_OPENED_FOLDER = /forbidden path/i

/**
 * A symlink or junction, as the file or folder it points to. Links inside a linked folder aren't followed,
 * so a link back up the tree can't lead round in a circle. Broken links are left out, and so are linked
 * folders that can't be listed: Windows puts such links in every user folder ('My Music' in Documents).
 * A link that leads outside the opened folder can't be followed yet; it is kept, empty and marked.
 */
async function readLink(entry: DirEntry, fullPath: string, siblingNames: string[], limit: Limit, insideLink: boolean): Promise<FileNode | null> {
    if (insideLink) return null
    let target: Awaited<ReturnType<typeof stat>>
    try {
        target = await stat(fullPath)
    } catch (err) {
        const name = entry.name
        if (!OUTSIDE_OPENED_FOLDER.test(errorText(err)) || WINDOWS_COMPAT_LINKS.has(name.toLowerCase()) || isHiddenFolder(name, siblingNames)) {
            return null
        }
        // Without its target, only the name tells a linked document from a linked folder.
        if (isSupportedDocument(name)) return { kind: 'file', name, path: fullPath }
        return { kind: 'directory', name, path: fullPath, children: [], unreadable: true, linksOutside: true }
    }
    if (target.isFile) return { kind: 'file', name: entry.name, path: fullPath }
    if (!target.isDirectory || isHiddenFolder(entry.name, siblingNames)) return null
    try {
        return { kind: 'directory', name: entry.name, path: fullPath, children: await readDirTree(fullPath, limit, true) }
    } catch {
        return null
    }
}

async function readDirTree(dirPath: string, limit: Limit, insideLink = false): Promise<FileNode[]> {
    // Only the listing itself takes a place, never the wait for subfolders, so nested folders can't block each other.
    const entries = await limit(() => readDir(dirPath))
    const names = entries.map((entry) => entry.name)
    const nodes = await Promise.all(
        entries.map(async (entry): Promise<FileNode | null> => {
            const fullPath = joinPath(dirPath, entry.name)
            if (entry.isDirectory) {
                if (isHiddenFolder(entry.name, names)) return null
                try {
                    return { kind: 'directory', name: entry.name, path: fullPath, children: await readDirTree(fullPath, limit, insideLink) }
                } catch {
                    // One folder that can't be read (no permission, or deleted mid-scan) mustn't stop the rest from opening.
                    return { kind: 'directory', name: entry.name, path: fullPath, children: [], unreadable: true }
                }
            }
            if (isSaveTempFile(entry.name)) return null
            if (entry.isFile) return { kind: 'file', name: entry.name, path: fullPath }
            if (entry.isSymlink) return readLink(entry, fullPath, names, limit, insideLink)
            return null
        })
    )
    return nodes.filter((node): node is FileNode => node !== null).sort(compareEntries)
}

/**
 * Reads the whole folder, listing several subfolders at once. Throws when the folder itself can't be
 * read; a subfolder that can't be read is kept, empty and marked `unreadable`.
 */
export async function listWorkspaceTree(rootPath: string): Promise<FileNode[]> {
    if (!isTauri()) return []
    return readDirTree(normalizePath(rootPath), createLimit(MAX_PARALLEL_READS))
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

/** Just the text, decoded as readWorkspaceTextFile does, for reads that never save (such as searching every file). */
export async function readWorkspaceFile(path: string): Promise<string> {
    if (!isTauri()) return ''
    return decodeText(await readFile(path)).content
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

/** Windows file attributes that a file put in place of the original wouldn't have. */
const FILE_ATTRIBUTE_HIDDEN = 0x2
const FILE_ATTRIBUTE_SYSTEM = 0x4

type FileOnDisk = {
    /** Written straight into the file rather than replaced; see inspectFile. */
    inPlace: boolean
    /** Its Unix permission bits (macOS, Linux), which the file that replaces it is given too. */
    mode?: number
    stamp: FileStamp
}

/** What is at `path` now, or null when nothing is. */
async function inspectFile(path: string): Promise<FileOnDisk | null> {
    let info: Awaited<ReturnType<typeof lstat>>
    try {
        info = await lstat(path)
    } catch (err) {
        if (!(await exists(path))) return null
        throw err
    }
    // A link is written through, not replaced: replacing would turn it into a plain file cut off from the file
    // it points to. A hidden or system file is too, since the new file would show up without those marks.
    const attributes = info.fileAttributes ?? 0
    const inPlace = info.isSymlink || (info.nlink ?? 1) > 1 || (attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) !== 0
    const mode = typeof info.mode === 'number' ? info.mode & 0o7777 : undefined
    if (!info.isSymlink) return { inPlace, mode, stamp: stampOf(info) }
    try {
        return { inPlace, stamp: stampOf(await stat(path)) }
    } catch {
        // The link points at a file that is gone.
        return null
    }
}

/**
 * Access denied, or the file is open in another program that doesn't let it be replaced (Windows errors 5,
 * 32 and 33; EPERM and EACCES elsewhere). Writing straight into the file can still work then.
 */
const CANNOT_REPLACE = /\(os error (?:1|5|13|32|33)\)/

function cannotReplace(err: unknown): boolean {
    return CANNOT_REPLACE.test(errorText(err))
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
 * old version, never an empty or half-written file. If the write or the replace fails, the temporary file is removed.
 * Where a file can be changed but not replaced (no right to add files to its folder, or another program has
 * it open), it is written in place as before, rather than never saving. Resolves to the saved file's new
 * stamp (null if it couldn't be read).
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
    if (current?.inPlace) {
        await writeFile(path, bytes)
        return readStamp(path)
    }
    const tempPath = saveTempPath(path)
    try {
        // A private (600) note or a script (755) stays that way.
        await writeFile(tempPath, bytes, current?.mode === undefined ? { createNew: true } : { createNew: true, mode: current.mode })
        await replaceFile(tempPath, path)
    } catch (err) {
        // A write cut short (full disk, drive gone) can leave part of the temporary file behind too.
        try {
            await removeWorkspacePath(tempPath)
        } catch {
            // Never created, or already gone with the drive.
        }
        if (!current || !cannotReplace(err)) throw err
        console.warn(`Couldn't replace ${path}, so it is written in place`, err)
        await writeFile(path, bytes)
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

/** A tab's edits that aren't saved yet, and how its file is stored. */
export type UnsavedText = { content: string; format?: TextFileFormat }

/**
 * Files up to this size are copied through the app, which can refuse to replace a file that turns up
 * meanwhile. Bigger ones (videos, archives) are copied on disk, as holding them in the app could run it out of memory.
 */
const MAX_APP_COPY_BYTES = 32 * 1024 * 1024

/**
 * Copies a file to a new name. Never replaces an existing file (plain copy does): throws PathExistsError
 * instead. With `unsaved`, a tab's edits, the copy holds that text instead of the disk version, stored
 * the way the file is (UTF-16, a byte-order mark) as saving it would.
 */
export async function duplicateWorkspaceFile(sourcePath: string, destPath: string, unsaved?: UnsavedText): Promise<void> {
    if (!isTauri()) return
    if (await exists(destPath)) throw new PathExistsError(destPath)
    // createNew also refuses a file that turns up between the check and the write.
    if (unsaved) {
        await writeFile(destPath, encodeText(unsaved.content, unsaved.format ?? DEFAULT_TEXT_FORMAT), { createNew: true })
        return
    }
    if ((await stat(sourcePath)).size > MAX_APP_COPY_BYTES) {
        // Only a file made under the same name in the moment since the check above could be replaced.
        await copyFile(sourcePath, destPath)
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

/**
 * The last part of a path: `notes.md`, or `docs` for `C:\work\docs\`. A drive or the file system root has
 * no name of its own, so it goes by its path (`E:\`, `/`) rather than showing up blank.
 */
export function getBaseName(path: string): string {
    const trimmed = path.replace(/[/\\]+$/, '')
    const name = trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
    return name && !/^[a-zA-Z]:$/.test(name) ? name : path
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
