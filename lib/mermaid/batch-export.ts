import { errorMessage } from '@/lib/notify'
import type { NameClashChoice } from '@/lib/tauri/dialog'
import {
    createWorkspaceBinaryFile,
    createWorkspaceDirectory,
    createWorkspaceFile,
    comparablePath,
    getBaseName,
    isMermaidFile,
    isWindowsPath,
    joinPath,
    listFolderNames,
    listWorkspaceTree,
    newTempFileName,
    PathExistsError,
    readEntryKind,
    readStamp,
    readWorkspaceFile,
    renameWorkspacePath,
    trashWorkspacePath,
} from '@/lib/tauri/fs'
import {
    diagramExportProblem,
    exportBaseName,
    renderDiagramImage,
    smallerPngDescription,
    type DiagramImage,
    type DiagramLook,
    type PngExportScale,
} from '@/lib/mermaid/export'
import { uniqueNewName } from '@/lib/workspace/paths'
import type { FileNode } from '@/lib/workspace/types'

/** What each diagram is saved as. */
export type BatchImageFormat = { format: 'svg' } | { format: 'png'; scale: PngExportScale }

/** The choices in the options dialog. */
export type BatchExportSettings = {
    image: BatchImageFormat
    look: DiagramLook
    includeSubfolders: boolean
}

/** A diagram file found in the folder being exported. */
export type DiagramFile = {
    path: string
    name: string
    /** The folders between the exported folder and the file: [] at its top, ['sub', 'deeper'] further down. */
    folders: string[]
}

export type DiagramListing = {
    files: DiagramFile[]
    /** The folder has too many files and folders to list them all, so some diagrams may have been left out. */
    truncated: boolean
    /** Folders that couldn't be read, as paths from the exported folder (`sub\private`). */
    unreadable: string[]
}

/** `folders` and `name` as a path from the folder they are in, with that folder's separator (`sub\flow.svg`). */
function relativePath(base: string, folders: string[], name: string): string {
    return [...folders, name].join(isWindowsPath(base) ? '\\' : '/')
}

/**
 * The .mmd and .mermaid files in `folder`, read from disk, and with `includeSubfolders` those in its subfolders
 * too. Tool, cache and build output folders (.git, node_modules) are left out, as in the file list. Rejects when
 * `signal` stops it, or when the folder itself can't be read.
 */
export async function listDiagramFiles(
    folder: string,
    { includeSubfolders, signal }: { includeSubfolders: boolean; signal?: AbortSignal }
): Promise<DiagramListing> {
    const tree = await listWorkspaceTree(folder, { signal, subfolders: includeSubfolders })
    const listing: DiagramListing = { files: [], truncated: false, unreadable: [] }
    const walk = (nodes: FileNode[], folders: string[]) => {
        for (const node of nodes) {
            if (node.kind === 'file') {
                if (isMermaidFile(node.name)) listing.files.push({ path: node.path, name: node.name, folders })
                continue
            }
            if (!includeSubfolders) continue
            if (node.unreadable) listing.unreadable.push(relativePath(folder, folders, node.name))
            else if (node.truncated) listing.truncated = true
            else walk(node.children, [...folders, node.name])
        }
    }
    walk(tree, [])
    return listing
}

/** A diagram the export will save, and where. */
export type PlannedDiagram = {
    file: DiagramFile
    /** The folder it goes in: the output folder, or the same subfolder inside it. */
    folder: string
    /** The name it is saved as (`flow.svg`, or `flow 2.svg` next to another diagram of the same name). */
    fileName: string
    /** A file or folder in `folder` already has that name, ignoring letter case. */
    clash: boolean
}

export type BatchPlan = {
    outputFolder: string
    items: PlannedDiagram[]
    /** The names already taken, as paths from the output folder (`sub\flow.svg`), in the order of `items`. */
    clashes: string[]
    /** The names in use in each folder the export writes to (by comparablePath, in lower case): on disk, and planned. */
    taken: Map<string, Set<string>>
}

/** The names already in `folder` on disk. None when it isn't there yet; one that can't be read fails when it is written to. */
async function namesOnDisk(folder: string): Promise<string[]> {
    try {
        return await listFolderNames(folder)
    } catch {
        return []
    }
}

/**
 * Where each diagram goes and what it is called, and which names are already taken in the output folders, read
 * from disk and ignoring letter case as Windows does. Two diagrams that would get the same name (`flow.mmd` and
 * `flow.mermaid`) are told apart with a number. Nothing is written.
 */
export async function planBatchExport(files: DiagramFile[], outputFolder: string, extension: 'svg' | 'png'): Promise<BatchPlan> {
    const folderOf = (file: DiagramFile) => file.folders.reduce(joinPath, outputFolder)
    const folders = new Map<string, string>()
    for (const file of files) {
        const folder = folderOf(file)
        folders.set(comparablePath(folder), folder)
    }
    const onDisk = new Map<string, Set<string>>()
    await Promise.all(
        [...folders].map(async ([key, folder]) => onDisk.set(key, new Set((await namesOnDisk(folder)).map((name) => name.toLowerCase()))))
    )

    const taken = new Map<string, Set<string>>()
    const items: PlannedDiagram[] = []
    const clashes: string[] = []
    for (const file of files) {
        const folder = folderOf(file)
        const key = comparablePath(folder)
        const disk = onDisk.get(key)!
        const planned = taken.get(key) ?? new Set(disk)
        taken.set(key, planned)
        const base = `${exportBaseName(file.name)}.${extension}`
        if (disk.has(base.toLowerCase())) {
            // Named when the user says what to do (resolveNameClashes).
            items.push({ file, folder, fileName: base, clash: true })
            clashes.push(relativePath(outputFolder, file.folders, base))
            continue
        }
        const fileName = uniqueNewName(base, planned)
        planned.add(fileName.toLowerCase())
        items.push({ file, folder, fileName, clash: false })
    }
    return { outputFolder, items, clashes, taken }
}

/**
 * The plan once the user has answered the name question. Keep Both numbers each clashing diagram (`flow 2.svg`)
 * after a name used by nothing on disk or in the export; Skip leaves them out.
 */
export function resolveNameClashes(plan: BatchPlan, choice: 'keep-both' | 'skip'): { toWrite: PlannedDiagram[]; skipped: PlannedDiagram[] } {
    const toWrite: PlannedDiagram[] = []
    const skipped: PlannedDiagram[] = []
    for (const item of plan.items) {
        if (!item.clash) toWrite.push(item)
        else if (choice === 'skip') skipped.push(item)
        else {
            const taken = plan.taken.get(comparablePath(item.folder))!
            const fileName = uniqueNewName(item.fileName, taken)
            taken.add(fileName.toLowerCase())
            toWrite.push({ ...item, fileName })
        }
    }
    return { toWrite, skipped }
}

/** What happened to one diagram. `source` and `output` are paths from the exported and output folders, to show. */
export type BatchOutcome =
    | { status: 'saved'; source: string; output: string; outputPath: string; note?: string }
    | { status: 'skipped'; source: string; reason: string }
    | {
          status: 'failed'
          source: string
          reason: string
          /** A temporary file the export couldn't remove after the write failed. */
          leftover?: string
      }

export type BatchExportResult = {
    folder: string
    outputFolder: string
    /** Diagrams found in the folder. */
    found: number
    outcomes: BatchOutcome[]
    /** The user cancelled before every diagram was tried. */
    cancelled: boolean
    /** Diagrams not tried because the user cancelled. */
    notTried: number
    truncated: boolean
    unreadable: string[]
    /** Why the export couldn't start at all (the folder couldn't be read). */
    error?: string
}

export type BatchProgress = { phase: 'listing' } | { phase: 'checking' } | { phase: 'saving'; current: number; total: number }

export type BatchExportRequest = {
    /** The folder whose diagrams are exported. */
    folder: string
    outputFolder: string
    settings: BatchExportSettings
    /** The text of a tab with unsaved edits open on `path`, exported in place of the file on disk. */
    unsavedText: (path: string) => string | undefined
    /** Cancel: stops listing at once, and saving after the diagram being saved. */
    signal: AbortSignal
    onProgress: (progress: BatchProgress) => void
    /** Asks once what to do about names that are taken (see confirmNameClash). */
    askNameClash: (names: string[], canSkip: boolean) => Promise<NameClashChoice>
    /** Lets the window draw (the progress bar) between diagrams, since they are drawn on the main thread. */
    yieldToUi?: () => Promise<void>
}

/** One frame, or a moment when frames are paused (the window is minimised), so the export never stalls. */
export function yieldToBrowser(): Promise<void> {
    return new Promise((resolve) => {
        const fallback = setTimeout(resolve, 50)
        if (typeof requestAnimationFrame !== 'function') return
        requestAnimationFrame(() =>
            setTimeout(() => {
                clearTimeout(fallback)
                resolve()
            }, 0)
        )
    })
}

/** Makes the output folders a diagram goes in, once each, reusing any already there. */
function folderMaker(outputFolder: string): (folders: string[]) => Promise<void> {
    const made = new Map<string, Promise<void>>()
    const make = (path: string): Promise<void> => {
        const key = comparablePath(path)
        let done = made.get(key)
        if (!done) {
            done = createWorkspaceDirectory(path).catch(async (err: unknown) => {
                if (!(err instanceof PathExistsError)) throw err
                if ((await readEntryKind(path)) !== 'directory') throw new Error(`A file named ${getBaseName(path)} is where its folder would go.`)
            })
            made.set(key, done)
        }
        return done
    }
    return async (folders) => {
        let path = outputFolder
        for (const name of folders) {
            path = joinPath(path, name)
            await make(path)
        }
    }
}

/** Moves a temporary file to the Recycle Bin. Resolves to its path when it couldn't be, and is still there. */
async function removeTempFile(path: string): Promise<string | undefined> {
    try {
        await trashWorkspacePath(path)
        return undefined
    } catch {
        return (await readStamp(path)) ? path : undefined
    }
}

/**
 * Writes the picture to a temporary file in its folder, then moves that into place under its name, which never
 * replaces anything. So a failed write never leaves a part-written file under the real name.
 */
async function saveImage(item: PlannedDiagram, image: DiagramImage): Promise<{ reason: string; leftover?: string } | null> {
    const target = joinPath(item.folder, item.fileName)
    const temp = joinPath(item.folder, newTempFileName())
    try {
        if (image.format === 'svg') await createWorkspaceFile(temp, image.svg)
        else await createWorkspaceBinaryFile(temp, image.bytes)
        await renameWorkspacePath(temp, target)
        return null
    } catch (err) {
        // Another file took the temporary name first: it isn't ours to remove.
        if (err instanceof PathExistsError && comparablePath(err.path) === comparablePath(temp)) return { reason: errorMessage(err) }
        const appeared = err instanceof PathExistsError
        const reason = appeared ? `A file named ${item.fileName} appeared in the folder.` : `Couldn't save it. ${errorMessage(err)}`
        return { reason, leftover: await removeTempFile(temp) }
    }
}

function sourcePath(folder: string, file: DiagramFile): string {
    return relativePath(folder, file.folders, file.name)
}

/** Draws and saves one diagram. A broken one says why, and the export carries on. */
async function exportOne(
    request: BatchExportRequest,
    item: PlannedDiagram,
    makeFolders: (folders: string[]) => Promise<void>
): Promise<BatchOutcome> {
    const { folder, outputFolder, settings } = request
    const source = sourcePath(folder, item.file)
    let text: string
    try {
        text = request.unsavedText(item.file.path) ?? (await readWorkspaceFile(item.file.path))
    } catch (err) {
        return { status: 'failed', source, reason: `Couldn't read the file. ${errorMessage(err)}` }
    }

    let image: DiagramImage
    try {
        image = await renderDiagramImage(text, settings.look, settings.image)
    } catch (err) {
        const problem = diagramExportProblem(err)
        if (problem === 'empty' || problem === 'unsupported') return { status: 'skipped', source, reason: errorMessage(err) }
        return { status: 'failed', source, reason: errorMessage(err) }
    }

    try {
        await makeFolders(item.file.folders)
    } catch (err) {
        return { status: 'failed', source, reason: `Couldn't make its folder. ${errorMessage(err)}` }
    }
    const failed = await saveImage(item, image)
    if (failed) return { status: 'failed', source, ...failed }

    const output = relativePath(outputFolder, item.file.folders, item.fileName)
    const outputPath = joinPath(item.folder, item.fileName)
    const note =
        image.format === 'png' && image.smallerSize && settings.image.format === 'png'
            ? smallerPngDescription(settings.image.scale, image.smallerSize)
            : undefined
    return note ? { status: 'saved', source, output, outputPath, note } : { status: 'saved', source, output, outputPath }
}

/**
 * Exports every diagram in a folder: lists it from disk, checks which names are taken in the output folders and
 * asks once what to do, then draws and saves each diagram in turn. Nothing already there is ever replaced.
 * Resolves to 'cancelled' when the user cancels at the name question (nothing is written), and otherwise to
 * what happened to each diagram, also when the user cancelled along the way.
 */
export async function exportFolderDiagrams(request: BatchExportRequest): Promise<BatchExportResult | 'cancelled'> {
    const { folder, outputFolder, settings, signal, onProgress, yieldToUi = yieldToBrowser } = request
    const result: BatchExportResult = {
        folder,
        outputFolder,
        found: 0,
        outcomes: [],
        cancelled: false,
        notTried: 0,
        truncated: false,
        unreadable: [],
    }

    onProgress({ phase: 'listing' })
    let listing: DiagramListing
    try {
        listing = await listDiagramFiles(folder, { includeSubfolders: settings.includeSubfolders, signal })
    } catch (err) {
        if (signal.aborted) return { ...result, cancelled: true }
        return { ...result, error: `Couldn't read ${getBaseName(folder)}. ${errorMessage(err)}` }
    }
    Object.assign(result, { found: listing.files.length, truncated: listing.truncated, unreadable: listing.unreadable })
    if (signal.aborted) return { ...result, cancelled: true, notTried: listing.files.length }
    if (listing.files.length === 0) return result

    onProgress({ phase: 'checking' })
    const plan = await planBatchExport(listing.files, outputFolder, settings.image.format)
    if (signal.aborted) return { ...result, cancelled: true, notTried: listing.files.length }
    let choice: NameClashChoice = 'keep-both'
    if (plan.clashes.length > 0) {
        choice = await request.askNameClash(plan.clashes, plan.clashes.length < plan.items.length)
        if (choice === 'cancel') return 'cancelled'
    }
    const { toWrite, skipped } = resolveNameClashes(plan, choice)
    result.outcomes.push(
        ...skipped.map((item): BatchOutcome => ({
            status: 'skipped',
            source: sourcePath(folder, item.file),
            reason: `Skipped: ${relativePath(outputFolder, item.file.folders, item.fileName)} is already in the folder.`,
        }))
    )

    const makeFolders = folderMaker(outputFolder)
    for (const [index, item] of toWrite.entries()) {
        if (signal.aborted) {
            result.cancelled = true
            result.notTried = toWrite.length - index
            break
        }
        onProgress({ phase: 'saving', current: index + 1, total: toWrite.length })
        // Shows "Saving N of M" before the main thread is busy drawing.
        await yieldToUi()
        result.outcomes.push(await exportOne(request, item, makeFolders))
    }
    return result
}

export type BatchCounts = { saved: number; skipped: number; failed: number }

export function countOutcomes(outcomes: readonly BatchOutcome[]): BatchCounts {
    const counts: BatchCounts = { saved: 0, skipped: 0, failed: 0 }
    for (const outcome of outcomes) counts[outcome.status] += 1
    return counts
}

const diagrams = (n: number) => `${n} ${n === 1 ? 'diagram' : 'diagrams'}`

/** The summary's first line: how many diagrams were saved, out of how many, and whether the user cancelled. */
export function batchHeadline(result: BatchExportResult): string {
    if (result.error) return result.error
    const { saved } = countOutcomes(result.outcomes)
    if (result.cancelled) {
        const kept = saved === 0 ? 'No diagrams were saved.' : `The ${diagrams(saved)} already saved ${saved === 1 ? 'is' : 'are'} kept.`
        return `Export cancelled. ${kept}`
    }
    if (result.found === 0) return `No diagrams found in ${getBaseName(result.folder)}.`
    return `Saved ${saved} of ${diagrams(result.found)}.`
}
