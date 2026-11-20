import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

/**
 * A pretend Windows drive, behind the plugin-fs calls and app commands lib/tauri/fs.ts makes. Names ignore
 * letter case, as on Windows, and a write that would replace a file is refused as the app's commands refuse it.
 */
const disk = vi.hoisted(() => {
    type Entry = { path: string; dir: true } | { path: string; dir: false; data: Uint8Array }
    const entries = new Map<string, Entry>()
    const key = (path: string) => path.toLowerCase()
    const parentOf = (path: string) => path.slice(0, path.lastIndexOf('\\'))
    const notFound = (path: string) => `failed to open ${path}: The system cannot find the path specified. (os error 3)`
    const put = (path: string, data: Uint8Array) => {
        const parent = entries.get(key(parentOf(path)))
        if (!parent?.dir) throw notFound(path)
        entries.set(key(path), { path, dir: false, data })
    }
    return {
        entries,
        /** Paths that can't be listed. */
        unreadable: new Set<string>(),
        /** Called before each move into place: a file can turn up meanwhile. */
        beforeRename: null as null | ((newPath: string) => void),
        /** Moving to the Recycle Bin fails. */
        trashFails: false,
        /** Writes fail after creating part of the file. */
        writeFails: null as null | string,
        reset() {
            entries.clear()
            this.unreadable.clear()
            this.beforeRename = null
            this.trashFails = false
            this.writeFails = null
        },
        folder(path: string) {
            entries.set(key(path), { path, dir: true })
        },
        file(path: string, text = '') {
            entries.set(key(path), { path, dir: false, data: new TextEncoder().encode(text) })
        },
        has: (path: string) => entries.has(key(path)),
        text(path: string): string | undefined {
            const entry = entries.get(key(path))
            return entry && !entry.dir ? new TextDecoder().decode(entry.data) : undefined
        },
        bytes(path: string): Uint8Array | undefined {
            const entry = entries.get(key(path))
            return entry && !entry.dir ? entry.data : undefined
        },
        /** Every path, as written, in order. */
        paths: () => [...entries.values()].map((entry) => entry.path).sort(),
        readDir(path: string) {
            if (this.unreadable.has(path)) throw `failed to read directory at path: ${path} with error: Access is denied. (os error 5)`
            if (!entries.get(key(path))?.dir) throw notFound(path)
            return [...entries.values()]
                .filter((entry) => key(parentOf(entry.path)) === key(path))
                .map((entry) => ({ name: entry.path.slice(path.length + 1), isDirectory: entry.dir, isFile: !entry.dir, isSymlink: false }))
        },
        write(path: string, data: Uint8Array, createNew?: boolean) {
            if (createNew && entries.has(key(path))) throw 'Cannot create a file when that file already exists. (os error 80)'
            if (this.writeFails) {
                put(path, data.slice(0, 1))
                throw this.writeFails
            }
            put(path, data)
        },
        mkdir(path: string) {
            if (entries.has(key(path))) throw 'Cannot create a file when that file already exists. (os error 183)'
            if (!entries.get(key(parentOf(path)))?.dir) throw notFound(path)
            entries.set(key(path), { path, dir: true })
        },
        rename(oldPath: string, newPath: string) {
            this.beforeRename?.(newPath)
            if (entries.has(key(newPath))) throw 'Cannot create a file when that file already exists. (os error 183)'
            const entry = entries.get(key(oldPath))
            if (!entry) throw notFound(oldPath)
            entries.delete(key(oldPath))
            entries.set(key(newPath), { ...entry, path: newPath })
        },
        trash(path: string) {
            if (this.trashFails) throw 'The file is open in another program.'
            if (!entries.delete(key(path))) throw notFound(path)
        },
        stat(path: string) {
            const entry = entries.get(key(path))
            if (!entry) throw notFound(path)
            return { isFile: !entry.dir, isDirectory: entry.dir, isSymlink: false, size: entry.dir ? 0 : entry.data.length, mtime: null }
        },
    }
})

vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    readDir: vi.fn(async (path: string) => disk.readDir(path)),
    readFile: vi.fn(async (path: string) => {
        const bytes = disk.bytes(path)
        if (!bytes) throw `failed to open ${path}: The system cannot find the file specified. (os error 2)`
        return bytes
    }),
    writeFile: vi.fn(async (path: string, data: Uint8Array, options?: { createNew?: boolean }) => disk.write(path, data, options?.createNew)),
    writeTextFile: vi.fn(async (path: string, text: string, options?: { createNew?: boolean }) =>
        disk.write(path, new TextEncoder().encode(text), options?.createNew)
    ),
    mkdir: vi.fn(async (path: string) => disk.mkdir(path)),
    exists: vi.fn(async (path: string) => disk.has(path)),
    stat: vi.fn(async (path: string) => disk.stat(path)),
    lstat: vi.fn(async (path: string) => disk.stat(path)),
    copyFile: vi.fn(),
    watchImmediate: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(async (command: string, args: Record<string, string> | Uint8Array) => {
        if (command === 'create_workspace_file' && args instanceof Uint8Array) {
            // The path's length, the path, then the file's bytes (saveRequestBody in lib/tauri/fs.ts).
            const length = new DataView(args.buffer, args.byteOffset).getUint32(0, true)
            return disk.write(new TextDecoder().decode(args.subarray(4, 4 + length)), args.slice(4 + length), true)
        }
        if (args instanceof Uint8Array) throw new Error(`unexpected command ${command}`)
        if (command === 'rename_workspace_path') return disk.rename(args.oldPath!, args.newPath!)
        if (command === 'trash_workspace_path') return disk.trash(args.path!)
        throw new Error(`unexpected command ${command}`)
    }),
}))
vi.mock('@/lib/mermaid/export', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mermaid/export')>()
    return { ...actual, renderDiagramImage: vi.fn(actual.renderDiagramImage) }
})

import {
    batchHeadline,
    yieldToBrowser,
    countOutcomes,
    exportFolderDiagrams,
    listDiagramFiles,
    planBatchExport,
    resolveNameClashes,
    type BatchExportRequest,
    type BatchExportResult,
    type BatchExportSettings,
    type BatchProgress,
} from '@/lib/mermaid/batch-export'
import { DiagramExportError, renderDiagramImage, type DiagramLook } from '@/lib/mermaid/export'
import type { NameClashChoice } from '@/lib/tauri/dialog'

const FLOW = 'graph TD\n  A --> B'
const LOOK: DiagramLook = { themeId: 'scrivon-light', transparent: false }
const SVG: BatchExportSettings = { image: { format: 'svg' }, look: LOOK, includeSubfolders: true }
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

const render = vi.mocked(renderDiagramImage)

beforeEach(() => {
    disk.reset()
    render.mockClear()
    disk.folder('C:\\work')
    disk.folder('C:\\work\\notes')
    disk.folder('C:\\out')
})

type RequestOptions = Partial<Omit<BatchExportRequest, 'signal'>> & { signal?: AbortSignal; choice?: NameClashChoice }

/** Exports C:\work\notes to C:\out, answering the name question with `choice`. */
async function exportNotes({ choice = 'keep-both', ...options }: RequestOptions = {}) {
    const progress: BatchProgress[] = []
    const askNameClash = vi.fn(async () => choice)
    const result = await exportFolderDiagrams({
        folder: 'C:\\work\\notes',
        outputFolder: 'C:\\out',
        settings: SVG,
        unsavedText: () => undefined,
        signal: new AbortController().signal,
        onProgress: (step) => progress.push(step),
        askNameClash,
        yieldToUi: async () => undefined,
        ...options,
    })
    return { result, progress, askNameClash }
}

/** The result, when the export ran rather than being cancelled at the name question. */
function ran(result: BatchExportResult | 'cancelled'): BatchExportResult {
    if (result === 'cancelled') throw new Error('The export was cancelled at the name question')
    return result
}

describe('listing the folder', () => {
    it('finds .mmd and .mermaid files in the folder and its subfolders, leaving out hidden folders', async () => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
        disk.file('C:\\work\\notes\\readme.md', '# Notes')
        disk.file('C:\\work\\notes\\pic.png')
        disk.folder('C:\\work\\notes\\sub')
        disk.file('C:\\work\\notes\\sub\\deep.mermaid', FLOW)
        disk.folder('C:\\work\\notes\\node_modules')
        disk.file('C:\\work\\notes\\node_modules\\lib.mmd', FLOW)
        disk.folder('C:\\work\\notes\\.git')
        disk.file('C:\\work\\notes\\.git\\hook.mmd', FLOW)
        // Build output, next to the project file that marks it.
        disk.file('C:\\work\\notes\\package.json', '{}')
        disk.folder('C:\\work\\notes\\dist')
        disk.file('C:\\work\\notes\\dist\\built.mmd', FLOW)

        const listing = await listDiagramFiles('C:\\work\\notes', { includeSubfolders: true })

        expect(listing.files).toEqual([
            { path: 'C:\\work\\notes\\sub\\deep.mermaid', name: 'deep.mermaid', folders: ['sub'] },
            { path: 'C:\\work\\notes\\flow.mmd', name: 'flow.mmd', folders: [] },
        ])
        expect(listing).toMatchObject({ truncated: false, unreadable: [] })
    })

    it('stays in the folder itself with Include subfolders off, without reading the subfolders', async () => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
        disk.folder('C:\\work\\notes\\sub')
        disk.file('C:\\work\\notes\\sub\\deep.mmd', FLOW)
        disk.unreadable.add('C:\\work\\notes\\sub')

        const listing = await listDiagramFiles('C:\\work\\notes', { includeSubfolders: false })

        expect(listing.files.map((file) => file.name)).toEqual(['flow.mmd'])
        expect(listing.unreadable).toEqual([])
    })

    it('says which folders could not be read, and when the listing stopped at its limit', async () => {
        disk.folder('C:\\work\\notes\\private')
        disk.folder('C:\\work\\notes\\a')
        disk.folder('C:\\work\\notes\\a\\locked')
        disk.unreadable.add('C:\\work\\notes\\private')
        disk.unreadable.add('C:\\work\\notes\\a\\locked')

        const listing = await listDiagramFiles('C:\\work\\notes', { includeSubfolders: true })
        expect(listing.unreadable).toEqual(['a\\locked', 'private'])

        // The export reads the same tree the file list does, with the same limit on how much it lists.
        const fs = await import('@/lib/tauri/fs')
        const tree = vi
            .spyOn(fs, 'listWorkspaceTree')
            .mockResolvedValueOnce([{ kind: 'directory', name: 'huge', path: 'C:\\work\\notes\\huge', children: [], truncated: true }])
        await expect(listDiagramFiles('C:\\work\\notes', { includeSubfolders: true })).resolves.toMatchObject({ truncated: true })
        tree.mockRestore()
    })

    it('passes the Cancel signal on, so cancelling stops the listing', async () => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
        const controller = new AbortController()
        controller.abort()

        await expect(listDiagramFiles('C:\\work\\notes', { includeSubfolders: true, signal: controller.signal })).rejects.toThrow()
    })
})

describe('planning names', () => {
    const file = (name: string, folders: string[] = []) => ({ path: `C:\\work\\notes\\${[...folders, name].join('\\')}`, name, folders })

    it('finds names already taken, ignoring letter case, and lists those in subfolders with their subfolder', async () => {
        disk.file('C:\\out\\FLOW.svg')
        disk.folder('C:\\out\\sub')
        disk.file('C:\\out\\sub\\Flow.SVG')

        const plan = await planBatchExport([file('flow.mmd'), file('other.mmd'), file('flow.mmd', ['sub'])], 'C:\\out', 'svg')

        expect(plan.clashes).toEqual(['flow.svg', 'sub\\flow.svg'])
        expect(plan.items.map((item) => [item.folder, item.fileName, item.clash])).toEqual([
            ['C:\\out', 'flow.svg', true],
            ['C:\\out', 'other.svg', false],
            ['C:\\out\\sub', 'flow.svg', true],
        ])
        // Nothing was written while checking.
        expect(disk.paths()).toEqual(['C:\\out', 'C:\\out\\FLOW.svg', 'C:\\out\\sub', 'C:\\out\\sub\\Flow.SVG', 'C:\\work', 'C:\\work\\notes'])
    })

    it('numbers Keep Both copies after every name in use, on disk and in the export', async () => {
        disk.file('C:\\out\\flow.png')
        disk.file('C:\\out\\flow 2.png')

        const plan = await planBatchExport([file('flow.mmd'), file('flow 3.mmd'), file('flow.mermaid')], 'C:\\out', 'png')
        const { toWrite, skipped } = resolveNameClashes(plan, 'keep-both')

        expect(skipped).toEqual([])
        expect(toWrite.map((item) => item.fileName)).toEqual(['flow 4.png', 'flow 3.png', 'flow 5.png'])
    })

    it('tells apart two diagrams that would get the same name, without asking', async () => {
        const plan = await planBatchExport([file('flow.mmd'), file('Flow.mermaid')], 'C:\\out', 'svg')

        expect(plan.clashes).toEqual([])
        expect(plan.items.map((item) => item.fileName)).toEqual(['flow.svg', 'Flow 2.svg'])
    })

    it('leaves the taken names out with Skip', async () => {
        disk.file('C:\\out\\flow.svg')

        const { toWrite, skipped } = resolveNameClashes(await planBatchExport([file('flow.mmd'), file('other.mmd')], 'C:\\out', 'svg'), 'skip')

        expect(toWrite.map((item) => item.fileName)).toEqual(['other.svg'])
        expect(skipped.map((item) => item.fileName)).toEqual(['flow.svg'])
    })

    it('plans a subfolder that is not there yet as empty', async () => {
        const plan = await planBatchExport([file('flow.mmd', ['new', 'deeper'])], 'C:\\out', 'svg')

        expect(plan.items[0]).toMatchObject({ folder: 'C:\\out\\new\\deeper', fileName: 'flow.svg', clash: false })
    })
})

describe('exporting a folder', () => {
    it('saves each diagram as the single export would, keeping the subfolder layout', async () => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
        disk.folder('C:\\work\\notes\\sub')
        disk.file('C:\\work\\notes\\sub\\seq.mmd', 'sequenceDiagram\n  Alice->>Bob: Hello')
        // One subfolder of the output is there already, and is reused.
        disk.folder('C:\\out\\sub')

        const { result, progress, askNameClash } = await exportNotes()

        expect(askNameClash).not.toHaveBeenCalled()
        expect(progress).toEqual([
            { phase: 'listing' },
            { phase: 'checking' },
            { phase: 'saving', current: 1, total: 2 },
            { phase: 'saving', current: 2, total: 2 },
        ])
        expect(ran(result).outcomes).toEqual([
            { status: 'saved', source: 'sub\\seq.mmd', output: 'sub\\seq.svg', outputPath: 'C:\\out\\sub\\seq.svg' },
            { status: 'saved', source: 'flow.mmd', output: 'flow.svg', outputPath: 'C:\\out\\flow.svg' },
        ])
        // The same picture as Export Diagram as SVG…: drawn by the one shared function, with the same look, and saved as it is.
        const single = await renderDiagramImage(FLOW, LOOK, { format: 'svg' })
        expect(disk.text('C:\\out\\flow.svg')).toBe(single.svg)
        expect(disk.text('C:\\out\\sub\\seq.svg')).not.toContain('paint-order')
        // No temporary files are left behind.
        expect(disk.paths().filter((path) => path.includes('.tmp'))).toEqual([])
    })

    it('makes the subfolders that are not there yet', async () => {
        disk.folder('C:\\work\\notes\\a')
        disk.folder('C:\\work\\notes\\a\\b')
        disk.file('C:\\work\\notes\\a\\b\\flow.mmd', FLOW)

        const { result } = await exportNotes()

        expect(countOutcomes(ran(result).outcomes)).toEqual({ saved: 1, skipped: 0, failed: 0 })
        expect(disk.has('C:\\out\\a\\b\\flow.svg')).toBe(true)
    })

    it('saves PNG bytes from the shared function, and notes a PNG that had to be smaller', async () => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
        disk.file('C:\\work\\notes\\wide.mmd', FLOW)
        render.mockResolvedValueOnce({ format: 'png', bytes: PNG_BYTES }).mockResolvedValueOnce({
            format: 'png',
            bytes: PNG_BYTES,
            smallerSize: '32767 × 1311 px',
        })
        const settings: BatchExportSettings = {
            image: { format: 'png', scale: 4 },
            look: { themeId: 'scrivon-dark', transparent: true },
            includeSubfolders: true,
        }

        const { result } = await exportNotes({ settings })

        expect(render).toHaveBeenCalledWith(FLOW, { themeId: 'scrivon-dark', transparent: true }, { format: 'png', scale: 4 })
        expect(disk.bytes('C:\\out\\flow.png')).toEqual(PNG_BYTES)
        expect(ran(result).outcomes[1]).toEqual({
            status: 'saved',
            source: 'wide.mmd',
            output: 'wide.png',
            outputPath: 'C:\\out\\wide.png',
            note: 'This diagram is too big for 4×, so it was saved at 32767 × 1311 px.',
        })
    })

    it('exports the text of a tab with unsaved edits in place of the file on disk', async () => {
        disk.file('C:\\work\\notes\\flow.mmd', 'graph TD')

        await exportNotes({ unsavedText: (path) => (path === 'C:\\work\\notes\\flow.mmd' ? 'graph LR\n  Edited --> Text' : undefined) })

        expect(disk.text('C:\\out\\flow.svg')).toContain('Edited')
    })

    it('skips empty and unsupported diagrams, fails broken ones with the reason, and carries on', async () => {
        disk.file('C:\\work\\notes\\a-empty.mmd', '   ')
        disk.file('C:\\work\\notes\\b-blank.mmd', 'graph TD')
        disk.file('C:\\work\\notes\\c-pie.mmd', 'pie\n  "A": 1')
        disk.file('C:\\work\\notes\\d-broken.mmd', 'notADiagram\n  A --> B')
        disk.file('C:\\work\\notes\\e-fine.mmd', FLOW)

        const { result } = await exportNotes()

        const outcomes = ran(result).outcomes
        expect(outcomes).toEqual([
            { status: 'skipped', source: 'a-empty.mmd', reason: 'Nothing to export.' },
            { status: 'skipped', source: 'b-blank.mmd', reason: 'The diagram is empty, so there is nothing to export.' },
            { status: 'skipped', source: 'c-pie.mmd', reason: expect.stringContaining('Pie charts') },
            { status: 'failed', source: 'd-broken.mmd', reason: expect.stringContaining('Invalid mermaid header') },
            { status: 'saved', source: 'e-fine.mmd', output: 'e-fine.svg', outputPath: 'C:\\out\\e-fine.svg' },
        ])
        expect(countOutcomes(outcomes)).toEqual({ saved: 1, skipped: 3, failed: 1 })
        expect(batchHeadline(ran(result))).toBe('Saved 1 of 5 diagrams.')
        expect(disk.paths().filter((path) => path.startsWith('C:\\out\\'))).toEqual(['C:\\out\\e-fine.svg'])
    })

    it('fails a diagram too big for a PNG, and saves the next one', async () => {
        disk.file('C:\\work\\notes\\huge.mmd', FLOW)
        disk.file('C:\\work\\notes\\small.mmd', FLOW)
        render
            .mockRejectedValueOnce(new DiagramExportError('png-too-big', 'This diagram is too big to save as a PNG. Save it as SVG instead.'))
            .mockResolvedValueOnce({ format: 'png', bytes: PNG_BYTES })

        const { result } = await exportNotes({ settings: { ...SVG, image: { format: 'png', scale: 2 } } })

        expect(ran(result).outcomes).toEqual([
            { status: 'failed', source: 'huge.mmd', reason: 'This diagram is too big to save as a PNG. Save it as SVG instead.' },
            { status: 'saved', source: 'small.mmd', output: 'small.png', outputPath: 'C:\\out\\small.png' },
        ])
    })
})

describe('names already taken', () => {
    beforeEach(() => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
        disk.file('C:\\work\\notes\\other.mmd', FLOW)
        disk.folder('C:\\work\\notes\\sub')
        disk.file('C:\\work\\notes\\sub\\flow.mmd', FLOW)
        disk.file('C:\\out\\Flow.svg', 'theirs')
        disk.folder('C:\\out\\sub')
        disk.file('C:\\out\\sub\\flow.svg', 'theirs too')
    })

    it('asks once, before writing anything, listing each clash from the output folder', async () => {
        const { askNameClash } = await exportNotes({ choice: 'cancel' })

        expect(askNameClash).toHaveBeenCalledExactlyOnceWith(['sub\\flow.svg', 'flow.svg'], true)
    })

    it('writes nothing when the question is cancelled', async () => {
        const before = disk.paths()

        const { result } = await exportNotes({ choice: 'cancel' })

        expect(result).toBe('cancelled')
        expect(disk.paths()).toEqual(before)
    })

    it('keeps both, with a number, and never replaces a file', async () => {
        const { result } = await exportNotes({ choice: 'keep-both' })

        expect(disk.text('C:\\out\\Flow.svg')).toBe('theirs')
        expect(disk.text('C:\\out\\sub\\flow.svg')).toBe('theirs too')
        expect(disk.has('C:\\out\\flow 2.svg')).toBe(true)
        expect(disk.has('C:\\out\\sub\\flow 2.svg')).toBe(true)
        expect(countOutcomes(ran(result).outcomes)).toEqual({ saved: 3, skipped: 0, failed: 0 })
    })

    it('skips the taken names and saves the rest', async () => {
        const { result, progress } = await exportNotes({ choice: 'skip' })

        expect(ran(result).outcomes.filter((outcome) => outcome.status === 'skipped')).toEqual([
            { status: 'skipped', source: 'sub\\flow.mmd', reason: 'Skipped: sub\\flow.svg is already in the folder.' },
            { status: 'skipped', source: 'flow.mmd', reason: 'Skipped: flow.svg is already in the folder.' },
        ])
        expect(disk.has('C:\\out\\other.svg')).toBe(true)
        expect(progress.at(-1)).toEqual({ phase: 'saving', current: 1, total: 1 })
    })

    it('offers no Skip when every diagram clashes', async () => {
        disk.file('C:\\out\\other.svg')

        const { askNameClash } = await exportNotes({ choice: 'cancel' })

        expect(askNameClash).toHaveBeenCalledWith(expect.any(Array), false)
    })

    it('names a taken file once when two diagrams would both get its name, and numbers both with Keep Both', async () => {
        disk.file('C:\\work\\notes\\flow.mermaid', FLOW)

        const { askNameClash } = await exportNotes({ choice: 'cancel' })
        // other.mmd doesn't clash, so Skip is still offered.
        expect(askNameClash).toHaveBeenCalledExactlyOnceWith(['sub\\flow.svg', 'flow.svg'], true)

        const { result } = await exportNotes({ choice: 'keep-both' })
        expect(disk.text('C:\\out\\Flow.svg')).toBe('theirs')
        expect(disk.has('C:\\out\\flow 2.svg')).toBe(true)
        expect(disk.has('C:\\out\\flow 3.svg')).toBe(true)
        expect(countOutcomes(ran(result).outcomes)).toEqual({ saved: 4, skipped: 0, failed: 0 })
    })

    it('offers no Skip when every diagram clashes, also when two of them clash on the same name', async () => {
        disk.file('C:\\work\\notes\\flow.mermaid', FLOW)
        disk.file('C:\\out\\other.svg')

        const { askNameClash } = await exportNotes({ choice: 'cancel' })

        expect(askNameClash).toHaveBeenCalledExactlyOnceWith(['sub\\flow.svg', 'flow.svg', 'other.svg'], false)
    })
})

describe('checking a large output folder', () => {
    /** Each folder listing takes a moment, as a round trip to the app does; counts how many run at once. */
    async function slowListings() {
        const fs = await import('@tauri-apps/plugin-fs')
        const listings = { running: 0, most: 0, output: [] as string[] }
        vi.mocked(fs.readDir).mockImplementation(async (path: string | URL) => {
            const folder = String(path)
            if (folder.startsWith('C:\\out')) listings.output.push(folder)
            listings.running += 1
            listings.most = Math.max(listings.most, listings.running)
            try {
                await new Promise((resolve) => setTimeout(resolve, 1))
                return disk.readDir(folder) as Awaited<ReturnType<typeof fs.readDir>>
            } finally {
                listings.running -= 1
            }
        })
        onTestFinished(() => {
            vi.mocked(fs.readDir).mockImplementation(async (path: string | URL) => disk.readDir(String(path)) as never)
        })
        return listings
    }

    beforeEach(() => {
        for (let i = 0; i < 30; i++) {
            disk.folder(`C:\\work\\notes\\s${i}`)
            disk.file(`C:\\work\\notes\\s${i}\\flow.mmd`, FLOW)
            disk.folder(`C:\\out\\s${i}`)
        }
    })

    it('lists the output folders a few at a time, as the folder listing does', async () => {
        const listings = await slowListings()

        const { result } = await exportNotes()

        expect(listings.output).toHaveLength(30)
        expect(listings.most).toBeLessThanOrEqual(8)
        expect(countOutcomes(ran(result).outcomes)).toEqual({ saved: 30, skipped: 0, failed: 0 })
    })

    it('stops listing them when cancelled, before asking or writing anything', async () => {
        const listings = await slowListings()
        disk.file('C:\\out\\s0\\flow.svg')
        const controller = new AbortController()
        const { result, askNameClash } = await exportNotes({
            signal: controller.signal,
            onProgress: (step) => {
                // Cancel pressed once the checking has started.
                if (step.phase === 'checking') setTimeout(() => controller.abort(), 0)
            },
        })

        expect(ran(result)).toMatchObject({ cancelled: true, notTried: 30, outcomes: [] })
        expect(listings.output.length).toBeLessThan(30)
        expect(askNameClash).not.toHaveBeenCalled()
        expect(disk.paths().filter((path) => /\.svg$/.test(path))).toEqual(['C:\\out\\s0\\flow.svg'])
    })
})

describe('writing each file', () => {
    beforeEach(() => {
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)
    })

    it('writes to a temporary file in the folder, flushed to the disk, then moves it into place', async () => {
        const core = await import('@tauri-apps/api/core')
        const writes: string[] = []
        disk.beforeRename = () => writes.push(...disk.paths().filter((path) => path.endsWith('.tmp')))

        await exportNotes()

        // Through the app's create command, which flushes the file before the move (src-tauri/src/atomic_write.rs).
        const [temp] = writes
        expect(writes).toEqual([expect.stringMatching(/^C:\\out\\\.scrivon-save-[a-z0-9]+\.tmp$/)])
        expect(vi.mocked(core.invoke).mock.calls.filter(([command]) => command === 'create_workspace_file')).toHaveLength(1)
        expect(core.invoke).toHaveBeenCalledWith('rename_workspace_path', { oldPath: temp, newPath: 'C:\\out\\flow.svg' })
        expect(disk.text('C:\\out\\flow.svg')).toMatch(/^<svg/)
    })

    it('fails a diagram whose name is taken by the time it is written, rather than renaming it', async () => {
        disk.beforeRename = (path) => {
            if (path === 'C:\\out\\flow.svg') disk.file('C:\\out\\FLOW.SVG', 'someone else')
        }

        const { result } = await exportNotes()

        expect(ran(result).outcomes).toEqual([{ status: 'failed', source: 'flow.mmd', reason: 'A file named flow.svg appeared in the folder.' }])
        expect(disk.text('C:\\out\\FLOW.SVG')).toBe('someone else')
        // Its temporary file went to the Recycle Bin.
        expect(disk.paths()).toEqual(['C:\\out', 'C:\\out\\FLOW.SVG', 'C:\\work', 'C:\\work\\notes', 'C:\\work\\notes\\flow.mmd'])
    })

    it('never leaves a part-written file under the real name, and cleans up after a failed write', async () => {
        disk.writeFails = 'There is not enough space on the disk. (os error 112)'

        const { result } = await exportNotes()

        expect(ran(result).outcomes).toEqual([
            { status: 'failed', source: 'flow.mmd', reason: "Couldn't save it. There is not enough space on the disk. (os error 112)" },
        ])
        expect(disk.has('C:\\out\\flow.svg')).toBe(false)
        expect(disk.paths().filter((path) => path.startsWith('C:\\out\\'))).toEqual([])
    })

    it('gives the path of a temporary file it could not clean up', async () => {
        disk.writeFails = 'There is not enough space on the disk. (os error 112)'
        disk.trashFails = true

        const { result } = await exportNotes()

        const [outcome] = ran(result).outcomes
        expect(outcome).toMatchObject({ status: 'failed', leftover: expect.stringMatching(/^C:\\out\\\.scrivon-save-[a-z0-9]+\.tmp$/) })
        expect(disk.has((outcome as { leftover: string }).leftover)).toBe(true)
    })

    it('fails the diagrams of a subfolder whose name a file already has in the output', async () => {
        disk.folder('C:\\work\\notes\\sub')
        disk.file('C:\\work\\notes\\sub\\deep.mmd', FLOW)
        disk.file('C:\\out\\sub', 'a file')

        const { result } = await exportNotes()

        expect(ran(result).outcomes).toEqual([
            { status: 'failed', source: 'sub\\deep.mmd', reason: "Couldn't make its folder. A file named sub is where its folder would go." },
            { status: 'saved', source: 'flow.mmd', output: 'flow.svg', outputPath: 'C:\\out\\flow.svg' },
        ])
    })
})

describe('cancelling', () => {
    it('stops after the diagram being saved, keeps those saved, and says how many', async () => {
        for (const name of ['a', 'b', 'c', 'd']) disk.file(`C:\\work\\notes\\${name}.mmd`, FLOW)
        const controller = new AbortController()

        const { result } = await exportNotes({
            signal: controller.signal,
            onProgress: (step) => {
                // Cancel pressed while the second is being saved.
                if (step.phase === 'saving' && step.current === 2) controller.abort()
            },
        })

        const done = ran(result)
        expect(done.outcomes.map((outcome) => outcome.status)).toEqual(['saved', 'saved'])
        expect(done).toMatchObject({ cancelled: true, notTried: 2 })
        expect(disk.has('C:\\out\\b.svg')).toBe(true)
        expect(disk.has('C:\\out\\c.svg')).toBe(false)
        expect(batchHeadline(done)).toBe('Export cancelled. The 2 diagrams already saved are kept.')
    })

    it('stops while checking names, before asking or writing anything', async () => {
        disk.file('C:\\work\\notes\\a.mmd', FLOW)
        disk.file('C:\\out\\a.svg')
        const controller = new AbortController()

        const { result, askNameClash } = await exportNotes({
            signal: controller.signal,
            onProgress: (step) => {
                if (step.phase === 'checking') controller.abort()
            },
        })

        expect(ran(result)).toMatchObject({ cancelled: true, notTried: 1, outcomes: [] })
        expect(askNameClash).not.toHaveBeenCalled()
    })

    it('stops while listing the folder, with nothing saved', async () => {
        disk.file('C:\\work\\notes\\a.mmd', FLOW)
        const controller = new AbortController()

        const { result } = await exportNotes({
            signal: controller.signal,
            onProgress: (step) => {
                if (step.phase === 'listing') controller.abort()
            },
        })

        expect(ran(result)).toMatchObject({ cancelled: true, outcomes: [] })
        expect(batchHeadline(ran(result))).toBe('Export cancelled. No diagrams were saved.')
        expect(disk.has('C:\\out\\a.svg')).toBe(false)
    })
})

describe('the summary', () => {
    it('says when there was nothing to export, and when the folder could not be read', async () => {
        const { result } = await exportNotes()
        expect(batchHeadline(ran(result))).toBe('No diagrams found in notes.')

        disk.unreadable.add('C:\\work\\notes')
        const { result: unreadable } = await exportNotes()
        expect(batchHeadline(ran(unreadable))).toMatch(/^Couldn't read notes\. .*Access is denied/)
    })

    it('carries the listing notes through to the result', async () => {
        disk.folder('C:\\work\\notes\\private')
        disk.unreadable.add('C:\\work\\notes\\private')
        disk.file('C:\\work\\notes\\flow.mmd', FLOW)

        const { result } = await exportNotes()

        expect(ran(result)).toMatchObject({ found: 1, unreadable: ['private'], truncated: false })
        expect(batchHeadline(ran(result))).toBe('Saved 1 of 1 diagram.')
    })
})

describe('yieldToBrowser', () => {
    it('waits for a frame, or a moment when there are no frames, so the export never stalls', async () => {
        vi.useFakeTimers()
        try {
            let done = false
            const waiting = yieldToBrowser().then(() => (done = true))
            await vi.advanceTimersByTimeAsync(50)
            await waiting
            expect(done).toBe(true)

            vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
            const framed = yieldToBrowser()
            await vi.advanceTimersByTimeAsync(17)
            await framed
        } finally {
            vi.unstubAllGlobals()
            vi.useRealTimers()
        }
    })
})
