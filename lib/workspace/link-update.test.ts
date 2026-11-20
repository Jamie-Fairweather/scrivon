import { describe, expect, it, vi } from 'vitest'
import { readDocumentLinks } from '@/lib/markdown/document-links'
import { DiskChangedError, type TextFileRead } from '@/lib/tauri/fs'
import {
    applyLinkUpdates,
    describeBlockedOnly,
    describeLinkUpdateOutcome,
    describeNothingFound,
    scanLinkUpdates,
    uncheckedNote,
    type LinkMove,
    type LinkUpdateSkip,
    type LinkUpdateTab,
} from '@/lib/workspace/link-update'
import { applyTextEdits, type TextEdit } from '@/lib/workspace/text-edits'
import type { FileNode, FileStamp } from '@/lib/workspace/types'
import type { TextDecodeIssue } from '@/lib/workspace/text-encoding'

const file = (path: string): FileNode => ({ kind: 'file', name: path.slice(path.lastIndexOf('\\') + 1), path })
const folder = (path: string, children: FileNode[], flags: Partial<Extract<FileNode, { kind: 'directory' }>> = {}): FileNode => ({
    kind: 'directory',
    name: path.slice(path.lastIndexOf('\\') + 1),
    path,
    children,
    ...flags,
})

type DiskFile = { text: string; issue?: TextDecodeIssue; size?: number }

/** Files on a pretend disk, by path as written here (every test uses one spelling). */
function createDisk(files: Record<string, DiskFile | string>) {
    const entries = new Map(Object.entries(files).map(([path, f]) => [path.toLowerCase(), typeof f === 'string' ? { text: f } : f]))
    let clock = 1
    const mtimes = new Map<string, number>()
    const stampOf = (path: string): FileStamp | null => {
        const f = entries.get(path.toLowerCase())
        return f ? { size: f.size ?? f.text.length, mtimeMs: mtimes.get(path.toLowerCase()) ?? 1 } : null
    }
    return {
        entries,
        readStamp: vi.fn(async (path: string) => stampOf(path)),
        readTextFile: vi.fn(async (path: string): Promise<TextFileRead> => {
            const f = entries.get(path.toLowerCase())
            if (!f) throw new Error(`not found: ${path} (os error 2)`)
            return { content: f.text, format: { encoding: 'utf-8', bom: false }, stamp: stampOf(path), ...(f.issue ? { issue: f.issue } : {}) }
        }),
        writeTextFile: vi.fn(async (path: string, content: string, options: { expected?: FileStamp | null }) => {
            const now = stampOf(path)
            if (options.expected && now && (now.size !== options.expected.size || now.mtimeMs !== options.expected.mtimeMs))
                throw new DiskChangedError(path, 'changed')
            entries.set(path.toLowerCase(), { text: content })
            mtimes.set(path.toLowerCase(), ++clock)
        }),
        /** Another app changes the file. */
        touch(path: string, text: string) {
            entries.set(path.toLowerCase(), { text })
            mtimes.set(path.toLowerCase(), ++clock)
        },
        text: (path: string) => entries.get(path.toLowerCase())?.text,
    }
}

const ROOT = 'C:\\ws'
// The tree from before setup.md moved from docs to guides.
const TREE: FileNode[] = [
    folder('C:\\ws\\docs', [file('C:\\ws\\docs\\setup.md'), file('C:\\ws\\docs\\other.md')]),
    folder('C:\\ws\\guides', []),
    file('C:\\ws\\README.md'),
    file('C:\\ws\\notes.md'),
    file('C:\\ws\\old.md'),
]
const MOVE: LinkMove = { root: ROOT, oldPath: 'C:\\ws\\docs\\setup.md', newPath: 'C:\\ws\\guides\\setup.md', isDirectory: false, tree: TREE }

/** The disk after the move. */
function movedDisk(extra: Record<string, DiskFile | string> = {}) {
    return createDisk({
        'C:\\ws\\guides\\setup.md': '# Setup\n\nSee [other](../docs/other.md).',
        'C:\\ws\\docs\\other.md': 'Back to [setup](setup.md#top).',
        'C:\\ws\\README.md': '[Setup](docs/setup.md) and [other](docs/other.md).',
        'C:\\ws\\notes.md': 'Nothing here.',
        'C:\\ws\\old.md': 'Old [setup](docs/setup.md).',
        ...extra,
    })
}

function scan(disk: ReturnType<typeof createDisk>, tabs: LinkUpdateTab[] = [], move: LinkMove = MOVE) {
    return scanLinkUpdates({ move, getTabs: () => tabs, readTextFile: disk.readTextFile, readStamp: disk.readStamp, yieldToUi: async () => {} })
}

describe('scanLinkUpdates', () => {
    it('finds the links the move broke, in the tree order', async () => {
        const disk = movedDisk()
        const result = await scan(disk)
        expect(result.files.map((f) => [f.path, f.rewrites.map((r) => `${r.oldAddress} -> ${r.newAddress}`)])).toEqual([
            ['C:\\ws\\docs\\other.md', ['setup.md#top -> ../guides/setup.md#top']],
            ['C:\\ws\\README.md', ['docs/setup.md -> guides/setup.md']],
            ['C:\\ws\\old.md', ['docs/setup.md -> guides/setup.md']],
        ])
        // setup.md's own link (../docs/other.md) still works from guides, so it isn't listed.
        expect(result.files.some((f) => f.path === 'C:\\ws\\guides\\setup.md')).toBe(false)
        expect(result.files[0]!.oldPath).toBe('C:\\ws\\docs\\other.md')
        expect(result).toMatchObject({ blocked: [], unchecked: 0, partialTree: false })
    })

    it('reads an open tab’s text rather than the disk, however its path is spelt', async () => {
        const disk = movedDisk()
        const tabs = [{ id: 't', path: 'c:/WS/notes.md', content: 'Now [setup](docs/setup.md).' }]
        const result = await scan(disk, tabs)
        expect(result.files.map((f) => f.path)).toContain('C:\\ws\\notes.md')
        expect(disk.readTextFile).not.toHaveBeenCalledWith('C:\\ws\\notes.md')
    })

    it('skips Markdown files over the size limit without reading them, and says so', async () => {
        const disk = movedDisk({ 'C:\\ws\\old.md': { text: '[s](docs/setup.md)', size: 2_000_000 } })
        const result = await scan(disk)
        expect(result.files.map((f) => f.path)).not.toContain('C:\\ws\\old.md')
        expect(result.unchecked).toBe(1)
        expect(disk.readTextFile).not.toHaveBeenCalledWith('C:\\ws\\old.md')
        expect(uncheckedNote(result)).toBe("Some files weren't checked: 1 file was too big or couldn't be read.")
    })

    it('marks a file with an encoding issue, or a read-only tab, as one that won’t change', async () => {
        const disk = movedDisk({ 'C:\\ws\\old.md': { text: 'Old [setup](docs/setup.md).', issue: 'legacy-encoding' } })
        const tabs = [{ id: 'C:\\ws\\README.md', path: 'C:\\ws\\README.md', content: '[Setup](docs/setup.md)', readOnly: true }]
        const result = await scan(disk, tabs)
        expect(result.blocked.map((b) => [b.path, b.reason])).toEqual([
            ['C:\\ws\\README.md', 'read-only'],
            ['C:\\ws\\old.md', 'encoding'],
        ])
        expect(result.files.map((f) => f.path)).toEqual(['C:\\ws\\docs\\other.md'])
        expect(describeBlockedOnly({ ...result, blocked: result.blocked.slice(0, 1) }).description).toBe(
            'Not updated: README.md (it is open read-only).'
        )
    })

    it('checks a target the tree doesn’t list on disk before calling it broken', async () => {
        // README.md moves into docs; its images are in .assets, which the tree leaves out.
        const hidden = createDisk({
            'C:\\ws\\docs\\README.md': '![logo](.assets/logo.png) ![gone](.assets/gone.png)',
            'C:\\ws\\.assets\\logo.png': 'png',
        })
        const moved = await scan(hidden, [], {
            root: ROOT,
            oldPath: 'C:\\ws\\README.md',
            newPath: 'C:\\ws\\docs\\README.md',
            isDirectory: false,
            tree: [folder('C:\\ws\\docs', []), file('C:\\ws\\README.md')],
        })
        expect(moved.files.map((f) => f.rewrites.map((r) => r.newAddress))).toEqual([['../.assets/logo.png']])
        expect(hidden.readStamp).toHaveBeenCalledWith('C:\\ws\\.assets\\logo.png')
    })

    it('says when the tree wasn’t listed in full', async () => {
        const result = await scan(movedDisk(), [], { ...MOVE, tree: [...TREE, folder('C:\\ws\\big', [], { truncated: true })] })
        expect(result.partialTree).toBe(true)
        expect(uncheckedNote(result)).toBe("Some files weren't checked: Scrivon didn't list every file in this folder.")
    })

    it('reads many files a few at a time', async () => {
        const many: Record<string, string> = {}
        const tree: FileNode[] = [folder('C:\\ws\\docs', [file('C:\\ws\\docs\\setup.md')])]
        for (let i = 0; i < 40; i++) {
            many[`C:\\ws\\n${i}.md`] = `[s](docs/setup.md)`
            tree.push(file(`C:\\ws\\n${i}.md`))
        }
        const disk = createDisk({ ...many, 'C:\\ws\\guides\\setup.md': '' })
        let reading = 0
        let most = 0
        const readTextFile = async (path: string) => {
            reading++
            most = Math.max(most, reading)
            await new Promise((resolve) => setTimeout(resolve, 1))
            reading--
            return disk.readTextFile(path)
        }
        const result = await scanLinkUpdates({
            move: { ...MOVE, tree },
            getTabs: () => [],
            readTextFile,
            readStamp: disk.readStamp,
            concurrency: 4,
            yieldToUi: async () => {},
        })
        expect(result.files).toHaveLength(40)
        expect(result.files[0]!.path).toBe('C:\\ws\\n0.md')
        expect(most).toBeLessThanOrEqual(4)
    })
})

describe('applyLinkUpdates', () => {
    function editor(tabs: LinkUpdateTab[]) {
        return vi.fn((tabId: string, edits: readonly TextEdit[]) => {
            const tab = tabs.find((t) => t.id === tabId)
            if (!tab || tab.readOnly) return false
            tab.content = applyTextEdits(tab.content, edits)
            return true
        })
    }

    it('changes open tabs in their buffer and writes the rest in their own encoding, checking the stamp', async () => {
        const disk = movedDisk()
        const tabs: LinkUpdateTab[] = [{ id: 'readme', path: 'C:\\ws\\README.md', content: 'Unsaved. [Setup](docs/setup.md)' }]
        const result = await scan(disk, tabs)
        const applyTabEdits = editor(tabs)
        const keepVersion = vi.fn(async () => undefined)
        const onWritten = vi.fn()

        const outcome = await applyLinkUpdates({
            scan: result,
            getTabs: () => tabs,
            applyTabEdits,
            readTextFile: disk.readTextFile,
            writeTextFile: disk.writeTextFile,
            keepVersion,
            onWritten,
        })

        expect(outcome.updated.map((u) => u.path)).toEqual(['C:\\ws\\docs\\other.md', 'C:\\ws\\README.md', 'C:\\ws\\old.md'])
        expect(outcome.skipped).toEqual([])
        expect(tabs[0]!.content).toBe('Unsaved. [Setup](guides/setup.md)')
        expect(applyTabEdits).toHaveBeenCalledTimes(1)
        expect(disk.text('C:\\ws\\README.md')).toBe('[Setup](docs/setup.md) and [other](docs/other.md).')
        expect(disk.text('C:\\ws\\docs\\other.md')).toBe('Back to [setup](../guides/setup.md#top).')
        expect(disk.writeTextFile).toHaveBeenCalledWith('C:\\ws\\old.md', 'Old [setup](guides/setup.md).', {
            format: { encoding: 'utf-8', bom: false },
            expected: expect.objectContaining({ size: 27 }),
        })
        expect(keepVersion).toHaveBeenCalledWith('C:\\ws\\old.md', 'Old [setup](docs/setup.md).')
        expect(onWritten).toHaveBeenCalledWith('C:\\ws\\old.md')
        expect(describeLinkUpdateOutcome(outcome, result)).toEqual({ kind: 'success', title: 'Updated 3 links in 3 files' })
    })

    it('updates a file edited elsewhere at the links’ new places, and skips one whose links changed', async () => {
        const disk = movedDisk()
        const result = await scan(disk)
        disk.touch('C:\\ws\\old.md', 'A new first line.\n\nOld [setup](docs/setup.md).')
        disk.touch('C:\\ws\\docs\\other.md', 'Back to [setup](setup.md#install).')

        const outcome = await applyLinkUpdates({
            scan: result,
            getTabs: () => [],
            applyTabEdits: vi.fn(() => true),
            readTextFile: disk.readTextFile,
            writeTextFile: disk.writeTextFile,
        })

        expect(disk.text('C:\\ws\\old.md')).toBe('A new first line.\n\nOld [setup](guides/setup.md).')
        expect(disk.text('C:\\ws\\docs\\other.md')).toBe('Back to [setup](setup.md#install).')
        expect(outcome.skipped).toEqual([{ path: 'C:\\ws\\docs\\other.md', reason: 'changed' }])
    })

    it('never overwrites a file that changed on disk between reading and writing it', async () => {
        const disk = movedDisk()
        const result = await scan(disk)
        const writeTextFile = vi.fn(async (path: string, content: string, options: { expected?: FileStamp | null }) => {
            if (path === 'C:\\ws\\old.md') disk.touch(path, 'Old [setup](docs/setup.md)!')
            return disk.writeTextFile(path, content, options)
        })

        const outcome = await applyLinkUpdates({
            scan: result,
            getTabs: () => [],
            applyTabEdits: vi.fn(),
            readTextFile: disk.readTextFile,
            writeTextFile,
        })

        expect(disk.text('C:\\ws\\old.md')).toBe('Old [setup](docs/setup.md)!')
        expect(outcome.skipped).toEqual([{ path: 'C:\\ws\\old.md', reason: 'disk-changed' }])
        const notice = describeLinkUpdateOutcome(outcome, result)
        expect(notice).toEqual({
            kind: 'warning',
            title: 'Updated 2 links in 2 files',
            description: 'Not updated: old.md (it was changed or deleted outside Scrivon).',
        })
    })

    it('changes a file opened since the scan in its tab, never on disk', async () => {
        const disk = movedDisk()
        const tabs: LinkUpdateTab[] = []
        const result = await scan(disk, tabs)
        tabs.push({ id: 'old', path: 'c:/ws/OLD.md', content: 'Old [setup](docs/setup.md). Typing…' })

        const outcome = await applyLinkUpdates({
            scan: result,
            getTabs: () => tabs,
            applyTabEdits: editor(tabs),
            readTextFile: disk.readTextFile,
            writeTextFile: disk.writeTextFile,
        })

        expect(tabs[0]!.content).toBe('Old [setup](guides/setup.md). Typing…')
        expect(disk.text('C:\\ws\\old.md')).toBe('Old [setup](docs/setup.md).')
        expect(outcome.updated.map((u) => u.path)).toContain('C:\\ws\\old.md')
    })

    it('never changes a tab that became read-only, nor a file that now reads with an encoding issue', async () => {
        const disk = movedDisk()
        const tabs: LinkUpdateTab[] = [{ id: 'readme', path: 'C:\\ws\\README.md', content: '[Setup](docs/setup.md)' }]
        const result = await scan(disk, tabs)
        tabs[0]!.readOnly = true
        disk.entries.set('c:\\ws\\old.md', { text: 'Old [setup](docs/setup.md).', issue: 'binary' })
        const applyTabEdits = editor(tabs)

        const outcome = await applyLinkUpdates({
            scan: result,
            getTabs: () => tabs,
            applyTabEdits,
            readTextFile: disk.readTextFile,
            writeTextFile: disk.writeTextFile,
        })

        expect(applyTabEdits).not.toHaveBeenCalled()
        expect(disk.writeTextFile).not.toHaveBeenCalledWith('C:\\ws\\old.md', expect.anything(), expect.anything())
        expect(outcome.skipped).toEqual([
            { path: 'C:\\ws\\README.md', reason: 'read-only' },
            { path: 'C:\\ws\\old.md', reason: 'binary' },
        ])
    })
})

describe('the notices after a link update', () => {
    const scanned = { move: { root: ROOT, newPath: 'C:\\ws\\guides\\setup.md' }, unchecked: 0, partialTree: false }

    it('names each file that wasn’t updated by its place in the folder, so two README.md files are told apart', () => {
        const notice = describeLinkUpdateOutcome(
            {
                updated: [{ path: 'C:\\ws\\notes.md', links: 1 }],
                skipped: [
                    { path: 'C:\\ws\\docs\\README.md', reason: 'read-only' },
                    { path: 'C:\\ws\\blog\\README.md', reason: 'encoding' },
                ],
            },
            scanned
        )
        expect(notice).toEqual({
            kind: 'warning',
            title: 'Updated 1 link in notes.md',
            description:
                "Not updated: docs\\README.md (it is open read-only); blog\\README.md (it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it).",
        })
    })

    it('names the first ten files that weren’t updated, and gives every one, with why, for Copy List', () => {
        const skipped: LinkUpdateSkip[] = Array.from({ length: 12 }, (_, i) => ({
            path: `C:\\ws\\notes\\n${i}.md`,
            reason: i % 2 ? 'disk-changed' : 'read-only',
        }))
        const notice = describeLinkUpdateOutcome({ updated: [], skipped }, scanned)
        expect(notice.description).toContain('notes\\n9.md (it was changed or deleted outside Scrivon); and 2 others (Copy List copies them all).')
        expect(notice.description).not.toContain('notes\\n10.md')
        const list = notice.list!.split('\n')
        expect(list).toHaveLength(12)
        expect(list[10]).toBe('notes\\n10.md (it is open read-only)')
        expect(list[11]).toBe('notes\\n11.md (it was changed or deleted outside Scrivon)')

        const blocked = skipped.map((s) => ({ ...s, file: { path: s.path, oldPath: s.path, rewrites: [], signature: '' } }))
        expect(describeBlockedOnly({ ...scanned, blocked }).list!.split('\n')).toHaveLength(12)
        // Ten or fewer are all named, with nothing more to copy.
        expect(describeLinkUpdateOutcome({ updated: [], skipped: skipped.slice(0, 10) }, scanned)).not.toHaveProperty('list')
    })

    it('says some files weren’t checked when none of those checked needs a change', () => {
        expect(describeNothingFound(scanned)).toBeNull()
        expect(describeNothingFound({ ...scanned, unchecked: 1 })).toEqual({
            kind: 'info',
            title: 'No links to setup.md needed updating',
            description: "Some files weren't checked: 1 file was too big or couldn't be read.",
        })
        expect(describeNothingFound({ ...scanned, partialTree: true })?.description).toBe(
            "Some files weren't checked: Scrivon didn't list every file in this folder."
        )
    })
})

describe('reading links for a link update', () => {
    it('reads each file’s links with the reader it is given, in the scan and again on Update Links', async () => {
        const disk = movedDisk()
        const readLinks = vi.fn(async (text: string) => readDocumentLinks(text))
        const result = await scanLinkUpdates({
            move: MOVE,
            getTabs: () => [],
            readTextFile: disk.readTextFile,
            readStamp: disk.readStamp,
            readLinks,
            yieldToUi: async () => {},
        })
        expect(result.files).toHaveLength(3)
        expect(readLinks).toHaveBeenCalledWith('[Setup](docs/setup.md) and [other](docs/other.md).')
        readLinks.mockClear()

        const outcome = await applyLinkUpdates({
            scan: result,
            getTabs: () => [],
            applyTabEdits: vi.fn(),
            readTextFile: disk.readTextFile,
            writeTextFile: disk.writeTextFile,
            readLinks,
            yieldToUi: async () => {},
        })
        expect(outcome.updated).toHaveLength(3)
        expect(readLinks).toHaveBeenCalledTimes(3)
    })

    it('passes over the files inside a folder renamed in place that don’t name it, without parsing them', async () => {
        const tree: FileNode[] = [folder('C:\\ws\\docs', [file('C:\\ws\\docs\\a.md'), file('C:\\ws\\docs\\b.md')]), file('C:\\ws\\README.md')]
        const move: LinkMove = { root: ROOT, oldPath: 'C:\\ws\\docs', newPath: 'C:\\ws\\manual', isDirectory: true, tree }
        const disk = createDisk({
            'C:\\ws\\manual\\a.md': 'See [readme](../README.md) and [b](b.md).',
            'C:\\ws\\manual\\b.md': 'Up to [a](../docs/a.md).',
            'C:\\ws\\README.md': 'Nothing to change.',
        })
        const readLinks = vi.fn(async (text: string) => readDocumentLinks(text))
        const result = await scanLinkUpdates({ move, getTabs: () => [], readTextFile: disk.readTextFile, readStamp: disk.readStamp, readLinks })
        expect(result.files.map((f) => [f.path, f.rewrites.map((r) => r.newAddress)])).toEqual([['C:\\ws\\manual\\b.md', ['a.md']]])
        // a.md's links still work from the renamed folder, and it doesn't name it: never parsed.
        expect(readLinks).toHaveBeenCalledExactlyOnceWith('Up to [a](../docs/a.md).')
    })
})
