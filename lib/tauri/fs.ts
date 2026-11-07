import {
    readDir,
    readFile,
    writeFile,
    writeTextFile,
    mkdir,
    remove,
    stat,
    lstat,
    exists,
    copyFile,
    watchImmediate,
    type DirEntry,
    type WatchEvent,
} from '@tauri-apps/plugin-fs'
import { invoke } from '@tauri-apps/api/core'
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
 * The most files and folders one read of the tree lists. Opening a whole drive or a big network share would
 * otherwise read all of it, hundreds of thousands of round trips, and hold it all in memory.
 */
export const MAX_TREE_ENTRIES = 50_000

/** One read of a tree: its share of the parallel listings, the entries it may still list, and when to stop. */
type TreeRead = { limit: Limit; budget: { left: number }; signal?: AbortSignal }

/** A folder's node, read through `read`: empty and marked when it can't be listed, or isn't because the budget ran out. */
async function readFolderNode(name: string, fullPath: string, read: TreeRead, insideLink: boolean): Promise<FileNode> {
    try {
        const children = await readDirTree(fullPath, read, insideLink)
        return children
            ? { kind: 'directory', name, path: fullPath, children }
            : { kind: 'directory', name, path: fullPath, children: [], truncated: true }
    } catch (err) {
        // A read that was replaced stops altogether.
        if (read.signal?.aborted) throw err
        // One folder that can't be read (no permission, or deleted mid-scan) mustn't stop the rest from opening.
        return { kind: 'directory', name, path: fullPath, children: [], unreadable: true }
    }
}

/**
 * A symlink or junction, as the file or folder it points to. Links inside a linked folder aren't followed,
 * so a link back up the tree can't lead round in a circle. Broken links are left out, and so are linked
 * folders that can't be listed: Windows puts such links in every user folder ('My Music' in Documents).
 * A link that leads outside the opened folder can't be followed yet; it is kept, empty and marked.
 */
async function readLink(entry: DirEntry, fullPath: string, siblingNames: string[], read: TreeRead, insideLink: boolean): Promise<FileNode | null> {
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
    const node = await readFolderNode(entry.name, fullPath, read, true)
    return node.kind === 'directory' && node.unreadable ? null : node
}

/** The entries of a folder and everything in it, or null when it wasn't listed because the budget had run out. */
async function readDirTree(dirPath: string, read: TreeRead, insideLink = false): Promise<FileNode[] | null> {
    // Only the listing itself takes a place, never the wait for subfolders, so nested folders can't block each other.
    // The budget is checked when the listing's turn comes, so folders queued behind others stop as soon as it is used up.
    const entries = await read.limit(async () => {
        read.signal?.throwIfAborted()
        if (read.budget.left <= 0) return null
        const listed = await readDir(dirPath)
        read.budget.left -= listed.length
        return listed
    })
    if (!entries) return null
    const names = entries.map((entry) => entry.name)
    const nodes = await Promise.all(
        entries.map(async (entry): Promise<FileNode | null> => {
            const fullPath = joinPath(dirPath, entry.name)
            if (entry.isDirectory) return isHiddenFolder(entry.name, names) ? null : readFolderNode(entry.name, fullPath, read, insideLink)
            if (isSaveTempFile(entry.name)) return null
            if (entry.isFile) return { kind: 'file', name: entry.name, path: fullPath }
            if (entry.isSymlink) return readLink(entry, fullPath, names, read, insideLink)
            return null
        })
    )
    return nodes.filter((node): node is FileNode => node !== null).sort(compareEntries)
}

export type ListWorkspaceTreeOptions = {
    /** Stops the read (it then rejects) once another read replaces it, such as another folder being opened. */
    signal?: AbortSignal
    /** MAX_TREE_ENTRIES unless given. */
    maxEntries?: number
}

/**
 * Reads the whole folder, listing several subfolders at once. Throws when the folder itself can't be
 * read; a subfolder that can't be read is kept, empty and marked `unreadable`. Once `maxEntries` files and
 * folders are listed, the folders not read yet are kept empty and marked `truncated` (see isTreeTruncated).
 */
export async function listWorkspaceTree(
    rootPath: string,
    { signal, maxEntries = MAX_TREE_ENTRIES }: ListWorkspaceTreeOptions = {}
): Promise<FileNode[]> {
    if (!isTauri()) return []
    const tree = await readDirTree(normalizePath(rootPath), { limit: createLimit(MAX_PARALLEL_READS), budget: { left: maxEntries }, signal })
    return tree ?? []
}

function stampOf(info: { size: number; mtime: Date | null }): FileStamp {
    return { mtimeMs: info.mtime ? info.mtime.getTime() : null, size: info.size }
}

/** True when the file now on disk isn't the one `before` was taken from. Sizes always count; times only when both are known. */
export function stampChanged(before: FileStamp, now: FileStamp): boolean {
    if (before.size !== now.size) return true
    return before.mtimeMs !== null && now.mtimeMs !== null && before.mtimeMs !== now.mtimeMs
}

/** When the file at `path` was last changed and how big it is now; null when it can't be read (or is gone). */
export async function readStamp(path: string): Promise<FileStamp | null> {
    if (!isTauri()) return null
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

/**
 * True for the error a read gives when the file, or a folder on its path, isn't there: "(os error 2)" or
 * "(os error 3)". Not for one that is there but can't be read just now, such as a locked file.
 */
export function isFileMissingError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
    return /\(os error [23]\)/.test(message)
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

/**
 * The temporary file a save writes before it replaces the real one (src-tauri/src/atomic_write.rs names it).
 * Left behind only if the app dies mid-save.
 */
function isSaveTempFile(name: string): boolean {
    return SAVE_TEMP_FILE.test(name)
}

/**
 * The app's save command takes raw bytes, so a file of several MB isn't sent as a list of numbers: the
 * path's length in bytes (4, little endian), the path as UTF-8, then the file's bytes.
 */
function saveRequestBody(path: string, bytes: Uint8Array): Uint8Array {
    const pathBytes = new TextEncoder().encode(path)
    const body = new Uint8Array(4 + pathBytes.length + bytes.length)
    new DataView(body.buffer).setUint32(0, pathBytes.length, true)
    body.set(pathBytes, 4)
    body.set(bytes, 4 + pathBytes.length)
    return body
}

/** Windows file attributes that a file put in place of the original wouldn't have. */
const FILE_ATTRIBUTE_HIDDEN = 0x2
const FILE_ATTRIBUTE_SYSTEM = 0x4

type FileOnDisk = {
    /** Written straight into the file rather than replaced; see inspectFile. */
    inPlace: boolean
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
    // (A hard link is written through as well; the save command checks that, since only it can tell on Windows.)
    const inPlace = info.isSymlink || (info.nlink ?? 1) > 1 || (attributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)) !== 0
    if (!info.isSymlink) return { inPlace, stamp: stampOf(info) }
    try {
        return { inPlace, stamp: stampOf(await stat(path)) }
    } catch {
        // The link points at a file that is gone.
        return null
    }
}

/**
 * Access denied, or the file is open in another program that doesn't let it be replaced (Windows errors 5,
 * 32, 33 and 1175, "unable to remove the file to be replaced"; EPERM and EACCES elsewhere). Writing straight
 * into the file can still work then.
 */
const CANNOT_REPLACE = /\(os error (?:1|5|13|32|33|1175)\)/

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
 * Saves text in the file's own encoding. The app's save command writes the bytes to a temporary file next
 * to it, flushes them to the disk, and then puts that file in its place in one step (on Windows keeping its
 * permissions, attributes and other streams). So a save that fails or is cut short (full disk, unplugged
 * drive, crash, power cut) leaves the old version, never an empty or half-written file. Where a file can be
 * changed but not replaced (no right to add files to its folder, or another program has it open), it is
 * written in place as before, rather than never saving. Resolves to the saved file's new stamp (null if it
 * couldn't be read).
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
    try {
        // It removes its temporary file itself when anything fails.
        await invoke('save_workspace_file', saveRequestBody(normalizePath(path), bytes))
    } catch (err) {
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

/** Creates a new file, as UTF-8 or in `format`. Never replaces an existing one: throws PathExistsError instead. */
export async function createWorkspaceFile(path: string, content: string, format?: TextFileFormat): Promise<void> {
    if (!isTauri()) return
    if (await exists(path)) throw new PathExistsError(path)
    // createNew also refuses a file that turns up between the check and the write (and ignores letter case on Windows).
    if (format) await writeFile(path, encodeText(content, format), { createNew: true })
    else await writeTextFile(path, content, { createNew: true })
}

/**
 * What the app's rename command fails with when something is already at the new path: Windows errors 80
 * and 183, EEXIST (17) elsewhere (src-tauri/src/atomic_write.rs).
 */
function isPathTakenError(err: unknown, path: string): boolean {
    return (isWindowsPath(path) ? /\(os error (?:80|183)\)/ : /\(os error 17\)/).test(errorText(err))
}

/**
 * Renames a file or folder through the app's rename command, which never replaces a file or folder already
 * at the target, even one that turns up a moment before (a sync client, git): this throws PathExistsError
 * instead. A change of letter case only (`a.md` -> `A.md`) is one entry on Windows and macOS, so it is
 * allowed unless the folder holds another entry with exactly the new name (Linux).
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
    }
    try {
        await invoke('rename_workspace_path', { oldPath: normalizePath(oldPath), newPath: normalizePath(newPath) })
    } catch (err) {
        if (isPathTakenError(err, newPath)) throw new PathExistsError(newPath)
        throw err
    }
}

/**
 * Deletes a file, or a folder with `recursive` (everything inside it goes too). Without `recursive`
 * a folder that isn't empty is refused.
 */
export async function removeWorkspacePath(path: string, { recursive = false }: { recursive?: boolean } = {}): Promise<void> {
    if (!isTauri()) return
    await remove(path, { recursive })
}

/**
 * Folders inside `dirPath` that the file list leaves out (.git, node_modules, build output), as paths
 * relative to it, so deleting it can say what else goes. Stops after `max`; links aren't followed (deleting
 * a folder removes a link inside it, not what it leads to). A subfolder that can't be read is skipped.
 */
export async function findHiddenFolders(dirPath: string, max = 4): Promise<string[]> {
    if (!isTauri()) return []
    const found: string[] = []
    const limit = createLimit(MAX_PARALLEL_READS)
    const root = normalizePath(dirPath)
    const sep = separatorFor(root)
    const walk = async (path: string, prefix: string): Promise<void> => {
        if (found.length >= max) return
        let entries: DirEntry[]
        try {
            entries = await limit(() => readDir(path))
        } catch {
            return
        }
        const names = entries.map((entry) => entry.name)
        await Promise.all(
            entries
                .filter((entry) => entry.isDirectory)
                .map(async (entry) => {
                    const relative = prefix ? `${prefix}${sep}${entry.name}` : entry.name
                    if (!isHiddenFolder(entry.name, names)) return walk(joinPath(path, entry.name), relative)
                    if (found.length < max) found.push(relative)
                })
        )
    }
    await walk(root, '')
    return found
}

/** What a change another app made inside the opened folder did, as far as the watcher can tell. */
export type WorkspaceChange = {
    /** May be new: created, or renamed to. */
    added: string[]
    /** May be gone: deleted, or renamed from. */
    removed: string[]
    /** Their content or details changed. */
    changed: string[]
}

/** A path the file list leaves out: a save's temporary file, or anything inside a tool or cache folder (.git, node_modules). */
function isUnlistedPath(root: string, path: string): boolean {
    const rest = pathInside(path, root)
    if (rest === null) return false
    const parts = rest.split(/[\\/]/)
    return isSaveTempFile(parts.at(-1)!) || parts.some((part) => isHiddenFolder(part, []))
}

/**
 * Sorts out one event from the watcher of `root`. Reads (Scrivon's own too) and paths the file list
 * leaves out are dropped, since git and build tools change those all the time; null when nothing is left.
 */
export function classifyWatchEvent(root: string, event: WatchEvent): WorkspaceChange | null {
    const keep = (paths: string[]) => paths.map(normalizePath).filter((path) => !isUnlistedPath(root, path))
    const change: WorkspaceChange = { added: [], removed: [], changed: [] }
    const type = event.type
    if (typeof type !== 'object') {
        // 'any' or 'other': it could be any of them.
        change.added = keep(event.paths)
        change.removed = change.added
    } else if ('access' in type) {
        return null
    } else if ('create' in type) {
        change.added = keep(event.paths)
    } else if ('remove' in type) {
        change.removed = keep(event.paths)
    } else if (type.modify.kind === 'rename') {
        const mode = type.modify.mode
        if (mode === 'from') change.removed = keep(event.paths)
        else if (mode === 'to') change.added = keep(event.paths)
        else if (mode === 'both') {
            change.removed = keep(event.paths.slice(0, 1))
            change.added = keep(event.paths.slice(1))
        } else {
            change.added = keep(event.paths)
            change.removed = change.added
        }
    } else if (type.modify.kind === 'metadata' && type.modify.mode === 'access-time') {
        return null
    } else {
        change.changed = keep(event.paths)
    }
    return change.added.length + change.removed.length + change.changed.length > 0 ? change : null
}

/** How long changes are gathered before they are reported together (a git checkout touches many files at once). */
const WATCH_BATCH_MS = 300

/**
 * Tells `onChange` about files and folders that change inside `root`, everything in it included, leaving
 * out what classifyWatchEvent drops. Resolves to a function that stops watching; rejects where the folder
 * can't be watched (some network drives).
 */
export async function watchWorkspace(root: string, onChange: (change: WorkspaceChange) => void): Promise<() => void> {
    if (!isTauri()) return () => {}
    const base = normalizePath(root)
    let gathered: WorkspaceChange | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const report = () => {
        timer = undefined
        const change = gathered
        gathered = null
        if (change) onChange(change)
    }
    // Not plugin-fs `watch`: with its delay the plugin first goes through the whole folder, .git and
    // node_modules too, to note every file's ID, which takes a long while in a big folder or a whole drive
    // and holds up the window. The system's own change reports cost nothing to set up.
    const stop = await watchImmediate(
        base,
        (event) => {
            const change = classifyWatchEvent(base, event)
            if (!change) return
            if (gathered) {
                gathered.added.push(...change.added)
                gathered.removed.push(...change.removed)
                gathered.changed.push(...change.changed)
            } else {
                gathered = change
            }
            timer ??= setTimeout(report, WATCH_BATCH_MS)
        },
        { recursive: true }
    )
    return () => {
        clearTimeout(timer)
        gathered = null
        stop()
    }
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
