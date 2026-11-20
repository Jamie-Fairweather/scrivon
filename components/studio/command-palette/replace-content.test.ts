import { describe, expect, it, vi } from 'vitest'
import { DiskChangedError, stampChanged, type TextFileRead, type WriteWorkspaceFileOptions } from '@/lib/tauri/fs'
import { decodeText, encodeText, type TextFileFormat } from '@/lib/workspace/text-encoding'
import { applyTextEdits, type TextEdit } from '@/lib/workspace/text-edits'
import type { FileStamp } from '@/lib/workspace/types'
import type { ReplaceFile } from '@/components/studio/command-palette/regex-match-client'
import {
    applyWorkspaceReplace,
    createYielder,
    describeOutcome,
    findOpenTab,
    planWorkspaceReplace,
    tabSkipReason,
    type ReplacePlan,
    type ReplaceTab,
} from '@/components/studio/command-palette/replace-content'
import { findReplacements } from '@/components/studio/command-palette/replace-text'
import {
    compileTextQuery,
    PLAIN_SEARCH_OPTIONS,
    REGEX_MAX_LINE_LENGTH,
    type WorkspaceSearchOptions,
} from '@/components/studio/command-palette/text-matcher'

function matcher(query: string, options: Partial<WorkspaceSearchOptions> = {}) {
    const compiled = compileTextQuery(query, { ...PLAIN_SEARCH_OPTIONS, ...options })
    if (!compiled.ok) throw new Error(compiled.error)
    return compiled.matcher
}

/** A stand-in for the regex worker, working out replacements as the real one does. */
const workerReplaceFile = vi.fn<ReplaceFile>(async (text, query, options, replacement, { maxHits }) => {
    const compiled = compileTextQuery(query, options)
    if (!compiled.ok) return { type: 'invalid', error: compiled.error }
    return { type: 'replacements', ...findReplacements(text, compiled.matcher, replacement, maxHits) }
})

const utf8 = (text: string) => new TextEncoder().encode(text)
const UTF16LE_BOM: TextFileFormat = { encoding: 'utf-16le', bom: true }

/**
 * Files as bytes, read and written as the app does: decoded with their encoding, written back in it, and a
 * write refused with DiskChangedError when the file changed or went since the stamp it was given.
 */
class FakeDisk {
    readonly files = new Map<string, { bytes: Uint8Array; mtimeMs: number }>()
    /** Runs after each read, so a test can change a file between reading and writing it. */
    afterRead: (path: string) => void = () => {}

    constructor(files: Record<string, string | Uint8Array> = {}) {
        for (const [path, content] of Object.entries(files)) this.put(path, content)
    }

    put(path: string, content: string | Uint8Array) {
        const previous = this.files.get(path)
        this.files.set(path, { bytes: typeof content === 'string' ? utf8(content) : content, mtimeMs: (previous?.mtimeMs ?? 1000) + 1 })
    }

    text(path: string): string {
        return decodeText(this.files.get(path)!.bytes).content
    }

    stamp(path: string): FileStamp | null {
        const file = this.files.get(path)
        return file ? { size: file.bytes.length, mtimeMs: file.mtimeMs } : null
    }

    read = vi.fn(async (path: string): Promise<TextFileRead> => {
        const file = this.files.get(path)
        if (!file) throw new Error(`The system cannot find the file specified. (os error 2)`)
        const result = { ...decodeText(file.bytes), stamp: this.stamp(path) }
        this.afterRead(path)
        return result
    })

    write = vi.fn(async (path: string, content: string, { format, expected }: WriteWorkspaceFileOptions) => {
        const now = this.stamp(path)
        if (expected !== undefined) {
            if (!now) throw new DiskChangedError(path, 'deleted')
            if (expected && stampChanged(expected, now)) throw new DiskChangedError(path, 'changed')
        }
        this.put(path, encodeText(content, format))
    })

    getStamp = vi.fn(async (path: string) => this.stamp(path))
}

/** Open tabs whose text applyTabEdits changes, as the editor does. */
function openTabs(tabs: ReplaceTab[]) {
    const state = { tabs }
    const applyTabEdits = vi.fn((tabId: string, edits: readonly TextEdit[]) => {
        const tab = state.tabs.find((t) => t.id === tabId)
        if (!tab || tab.readOnly) return false
        state.tabs = state.tabs.map((t) => (t.id === tabId ? { ...t, content: applyTextEdits(t.content, edits) } : t))
        return true
    })
    return { state, getTabs: () => state.tabs, applyTabEdits }
}

const isExample = (id: string) => id.startsWith('example:')
const noYield = async () => {}

async function plan(opts: {
    query?: string
    replacement?: string
    options?: Partial<WorkspaceSearchOptions>
    paths: string[]
    tabs?: ReplaceTab[]
    disk: FakeDisk
    maxFileBytes?: number
    yieldToUi?: () => Promise<void>
}) {
    const result = await planWorkspaceReplace({
        matcher: matcher(opts.query ?? 'cat', opts.options),
        replacement: opts.replacement ?? 'dog',
        replaceFile: workerReplaceFile,
        paths: opts.paths,
        tabs: opts.tabs ?? [],
        isExample,
        readTextFile: opts.disk.read,
        getFileStamp: opts.disk.getStamp,
        signal: new AbortController().signal,
        maxFileBytes: opts.maxFileBytes,
        yieldToUi: opts.yieldToUi ?? noYield,
    })
    if (result.type !== 'plan') throw new Error(`No plan: ${result.type}`)
    return result.plan
}

function apply(opts: {
    plan: ReplacePlan
    query?: string
    replacement?: string
    options?: Partial<WorkspaceSearchOptions>
    disk: FakeDisk
    tabs?: ReturnType<typeof openTabs>
    signal?: AbortSignal
    onProgress?: (done: number, total: number) => void
    yieldToUi?: () => Promise<void>
}) {
    const tabs = opts.tabs ?? openTabs([])
    return applyWorkspaceReplace({
        plan: opts.plan,
        matcher: matcher(opts.query ?? 'cat', opts.options),
        replacement: opts.replacement ?? 'dog',
        replaceFile: workerReplaceFile,
        getTabs: tabs.getTabs,
        isExample,
        applyTabEdits: tabs.applyTabEdits,
        readTextFile: opts.disk.read,
        writeTextFile: opts.disk.write,
        signal: opts.signal ?? new AbortController().signal,
        onProgress: opts.onProgress,
        yieldToUi: opts.yieldToUi ?? noYield,
    })
}

describe('planWorkspaceReplace', () => {
    it('counts every match, with no per-file or overall cap, open tabs first', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat '.repeat(150), '/w/b.md': 'no match', '/w/c.md': 'cat' })
        const result = await plan({
            paths: ['/w/a.md', '/w/b.md', '/w/c.md', '/w/open.md'],
            tabs: [{ id: '/w/open.md', path: '/w/open.md', content: 'cat cat' }],
            disk,
        })
        expect(result.files.map(({ path, source, count }) => ({ path, source, count }))).toEqual([
            { path: '/w/open.md', source: 'buffer', count: 2 },
            { path: '/w/a.md', source: 'disk', count: 150 },
            { path: '/w/c.md', source: 'disk', count: 1 },
        ])
        expect(result.totalMatches).toBe(153)
        expect(result.skipped).toEqual([])
    })

    it('counts an open file from its tab, never from disk, however the folder listing spells its path', async () => {
        const disk = new FakeDisk({ 'c:/notes/a.md': 'cat on disk' })
        const result = await plan({
            paths: ['c:/notes/a.md'],
            tabs: [{ id: 'C:\\Notes\\A.md', path: 'C:\\Notes\\A.md', content: 'cat cat in tab' }],
            disk,
        })
        expect(disk.read).not.toHaveBeenCalled()
        expect(result.files).toEqual([expect.objectContaining({ path: 'C:\\Notes\\A.md', source: 'buffer', count: 2 })])
    })

    it('names the files it will leave alone, and why', async () => {
        const windows1252 = new Uint8Array([0x63, 0x61, 0x74, 0x20, 0xe9]) // 'cat é' in Windows-1252, not valid UTF-8
        const disk = new FakeDisk({
            '/w/ansi.md': windows1252,
            '/w/binary.md': 'cat\0',
            '/w/big.md': `cat ${'x'.repeat(100)}`,
            '/w/ansi-no-match.md': new Uint8Array([0x78, 0xe9]),
        })
        const result = await plan({
            paths: ['/w/ansi.md', '/w/binary.md', '/w/big.md', '/w/gone.md', '/w/ansi-no-match.md'],
            tabs: [
                { id: '/w/ro.md', path: '/w/ro.md', content: 'cat', readOnly: true },
                { id: 'example:flow', path: 'example:flow', content: 'cat' },
            ],
            disk,
            maxFileBytes: 50,
        })
        expect(result.files).toEqual([])
        expect(result.skipped).toEqual([
            { path: '/w/ro.md', reason: 'read-only' },
            { path: '/w/ansi.md', reason: 'encoding' },
            { path: '/w/binary.md', reason: 'binary' },
            { path: '/w/big.md', reason: 'too-large' },
            { path: '/w/gone.md', reason: 'unreadable' },
        ])
    })

    it('stops when a regular expression takes too long, so nothing is replaced on a count that missed files', async () => {
        const replaceFile = vi.fn<ReplaceFile>(async (text, ...rest) =>
            text.includes('slow') ? { type: 'timedOut' } : workerReplaceFile(text, ...rest)
        )
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/slow.md': 'slow cat' })
        const result = await planWorkspaceReplace({
            matcher: matcher('cat', { useRegex: true }),
            replacement: 'dog',
            replaceFile,
            paths: ['/w/a.md', '/w/slow.md'],
            tabs: [],
            isExample,
            readTextFile: disk.read,
            signal: new AbortController().signal,
            concurrency: 1,
            yieldToUi: noYield,
        })
        expect(result).toEqual({ type: 'stopped', reason: 'timed-out', path: '/w/slow.md' })
    })

    it('reports progress and stops when cancelled', async () => {
        const controller = new AbortController()
        const progress: number[] = []
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/b.md': 'cat', '/w/c.md': 'cat' })
        const result = await planWorkspaceReplace({
            matcher: matcher('cat'),
            replacement: 'dog',
            paths: ['/w/a.md', '/w/b.md', '/w/c.md'],
            tabs: [],
            isExample,
            readTextFile: disk.read,
            signal: controller.signal,
            concurrency: 1,
            onProgress: (done) => {
                progress.push(done)
                if (done === 2) controller.abort()
            },
            yieldToUi: noYield,
        })
        expect(result).toEqual({ type: 'aborted' })
        expect(progress).toEqual([1, 2])
    })
})

describe('applyWorkspaceReplace', () => {
    it("writes files that aren't open in their own encoding, keeping the byte-order mark and line endings", async () => {
        const disk = new FakeDisk({ '/w/u16.md': encodeText('cat\r\nthe cat\r\n', UTF16LE_BOM), '/w/u8.md': 'a cat\nb' })
        const counted = await plan({ paths: ['/w/u16.md', '/w/u8.md'], disk })
        const outcome = await apply({ plan: counted, disk })

        expect(outcome).toMatchObject({ replacedMatches: 3, skipped: [], cancelled: false })
        const bytes = disk.files.get('/w/u16.md')!.bytes
        expect([...bytes.slice(0, 2)]).toEqual([0xff, 0xfe])
        expect(decodeText(bytes)).toEqual({ content: 'dog\r\nthe dog\r\n', format: UTF16LE_BOM })
        expect(disk.text('/w/u8.md')).toBe('a dog\nb')
        // Each write is told the stamp read with it, so one changed meanwhile is refused.
        expect(disk.write).toHaveBeenCalledWith('/w/u8.md', 'a dog\nb', {
            format: { encoding: 'utf-8', bom: false },
            expected: expect.objectContaining({ size: 7 }),
        })
    })

    it('changes open tabs only through applyTabEdits, as one edit list per tab, and never writes them', async () => {
        const disk = new FakeDisk({ 'c:/notes/a.md': 'cat on disk' })
        const tabs = openTabs([{ id: 'C:\\Notes\\A.md', path: 'C:\\Notes\\A.md', content: 'cat\r\ncat' }])
        const counted = await plan({ paths: ['c:/notes/a.md'], tabs: tabs.state.tabs, disk })
        const outcome = await apply({ plan: counted, disk, tabs })

        expect(tabs.applyTabEdits).toHaveBeenCalledTimes(1)
        expect(tabs.state.tabs[0]!.content).toBe('dog\r\ndog')
        expect(disk.write).not.toHaveBeenCalled()
        expect(disk.text('c:/notes/a.md')).toBe('cat on disk')
        expect(outcome.replaced).toEqual([{ path: 'C:\\Notes\\A.md', count: 2, route: 'buffer' }])
    })

    it('changes a file opened after the count in its tab, not on disk', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat' })
        const counted = await plan({ paths: ['/w/a.md'], disk })
        expect(counted.files[0]!.source).toBe('disk')

        const tabs = openTabs([{ id: '/W/A.md', path: '/w/a.md', content: 'cat' }])
        const outcome = await apply({ plan: counted, disk, tabs })
        expect(disk.write).not.toHaveBeenCalled()
        expect(tabs.state.tabs[0]!.content).toBe('dog')
        expect(outcome.replaced).toEqual([{ path: '/w/a.md', count: 1, route: 'buffer' }])
    })

    it('leaves a read-only or example tab alone, even if it became so after the count', async () => {
        const disk = new FakeDisk()
        const tabs = openTabs([{ id: '/w/a.md', path: '/w/a.md', content: 'cat' }])
        const counted = await plan({ paths: [], tabs: tabs.state.tabs, disk })
        tabs.state.tabs = [{ ...tabs.state.tabs[0]!, readOnly: true }]
        const outcome = await apply({ plan: counted, disk, tabs })
        expect(tabs.applyTabEdits).not.toHaveBeenCalled()
        expect(outcome.skipped).toEqual([{ path: '/w/a.md', reason: 'read-only' }])
    })

    it('skips a file whose matches changed since the count', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat cat', '/w/tab.md': '' })
        const tabs = openTabs([{ id: '/w/tab.md', path: '/w/tab.md', content: 'cat' }])
        const counted = await plan({ paths: ['/w/a.md'], tabs: tabs.state.tabs, disk })
        disk.put('/w/a.md', 'cat')
        tabs.state.tabs = [{ ...tabs.state.tabs[0]!, content: 'x cat' }]

        const outcome = await apply({ plan: counted, disk, tabs })
        expect(outcome.skipped).toEqual([
            { path: '/w/tab.md', reason: 'changed' },
            { path: '/w/a.md', reason: 'changed' },
        ])
        expect(disk.write).not.toHaveBeenCalled()
        expect(tabs.applyTabEdits).not.toHaveBeenCalled()
    })

    it('skips a file changed or deleted on disk between reading and writing it', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/b.md': 'cat' })
        const counted = await plan({ paths: ['/w/a.md', '/w/b.md'], disk })
        disk.afterRead = (path) => {
            if (path === '/w/a.md') disk.put('/w/a.md', 'cat, edited elsewhere')
            if (path === '/w/b.md') disk.files.delete('/w/b.md')
        }
        const outcome = await apply({ plan: counted, disk })
        expect(outcome.skipped).toEqual([
            { path: '/w/a.md', reason: 'disk-changed' },
            { path: '/w/b.md', reason: 'disk-changed' },
        ])
        expect(disk.text('/w/a.md')).toBe('cat, edited elsewhere')
    })

    it('skips a file deleted since the count', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat' })
        const counted = await plan({ paths: ['/w/a.md'], disk })
        disk.files.delete('/w/a.md')
        expect((await apply({ plan: counted, disk })).skipped).toEqual([{ path: '/w/a.md', reason: 'disk-changed' }])
    })

    it('never writes a file that now reads as Windows-1252 or binary', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/b.md': 'cat' })
        const counted = await plan({ paths: ['/w/a.md', '/w/b.md'], disk })
        disk.put('/w/a.md', new Uint8Array([0x63, 0x61, 0x74, 0xe9]))
        disk.put('/w/b.md', 'cat\0')
        const outcome = await apply({ plan: counted, disk })
        expect(disk.write).not.toHaveBeenCalled()
        expect(outcome.skipped).toEqual([
            { path: '/w/a.md', reason: 'encoding' },
            { path: '/w/b.md', reason: 'binary' },
        ])
    })

    it('fills in groups in regex mode, and leaves long lines alone', async () => {
        const long = `cat ${'x'.repeat(REGEX_MAX_LINE_LENGTH)}`
        const disk = new FakeDisk({ '/w/a.md': `big cat\n${long}\nsmall cat` })
        const options = { useRegex: true }
        const counted = await plan({ query: '(\\w+) cat', replacement: 'cat, $1', options, paths: ['/w/a.md'], disk })
        expect(counted.longLinesSkipped).toBe(1)
        const outcome = await apply({ plan: counted, query: '(\\w+) cat', replacement: 'cat, $1', options, disk })
        expect(disk.text('/w/a.md')).toBe(`cat, big\n${long}\ncat, small`)
        expect(outcome.longLinesSkipped).toBe(1)
    })

    it('stops before the next file when cancelled, keeping what was written, with progress along the way', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/b.md': 'cat', '/w/c.md': 'cat' })
        const counted = await plan({ paths: ['/w/a.md', '/w/b.md', '/w/c.md'], disk })
        const controller = new AbortController()
        const progress: Array<[number, number]> = []
        const outcome = await apply({
            plan: counted,
            disk,
            signal: controller.signal,
            onProgress: (done, total) => {
                progress.push([done, total])
                if (done === 2) controller.abort()
            },
        })
        expect(progress).toEqual([
            [1, 3],
            [2, 3],
        ])
        expect(outcome.cancelled).toBe(true)
        expect(outcome.replaced.map((r) => r.path)).toEqual(['/w/a.md', '/w/b.md'])
        expect(disk.text('/w/c.md')).toBe('cat')
    })

    it('lists the files the count left alone in its outcome, so the notice after Replace All names them', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/ansi.md': new Uint8Array([0x63, 0x61, 0x74, 0x20, 0xe9]) })
        const tabs = openTabs([{ id: '/w/ro.md', path: '/w/ro.md', content: 'cat', readOnly: true }])
        const counted = await plan({ paths: ['/w/a.md', '/w/ansi.md'], tabs: tabs.state.tabs, disk })
        expect(counted.files.map((f) => f.path)).toEqual(['/w/a.md'])

        const outcome = await apply({ plan: counted, disk, tabs })
        expect(outcome.skipped).toEqual([
            { path: '/w/ro.md', reason: 'read-only' },
            { path: '/w/ansi.md', reason: 'encoding' },
        ])
        expect(outcome.cancelled).toBe(false)
        expect(describeOutcome(outcome, counted.files.length)).toEqual({
            message: 'Replaced 1 match in a.md.',
            details: ["Skipped 2 files: ro.md (it is open read-only); ansi.md (it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it)."],
        })
    })

    it('counts only the files it set out to change when it is stopped, not those the count left alone', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/b.md': 'cat', '/w/ansi.md': new Uint8Array([0x63, 0x61, 0x74, 0xe9]) })
        const counted = await plan({ paths: ['/w/a.md', '/w/b.md', '/w/ansi.md'], disk })
        const controller = new AbortController()
        const outcome = await apply({
            plan: counted,
            disk,
            signal: controller.signal,
            onProgress: (done) => {
                if (done === 1) controller.abort()
            },
        })
        expect(outcome).toMatchObject({ cancelled: true, filesDone: 1 })
        expect(describeOutcome(outcome, counted.files.length).message).toBe('Replace All stopped after 1 file of 2. Replaced 1 match.')
    })

    it('goes on to the next file when changing one throws, and names it', async () => {
        const disk = new FakeDisk({ '/w/b.md': 'cat' })
        const tabs = openTabs([{ id: '/w/a.md', path: '/w/a.md', content: 'cat' }])
        const counted = await plan({ paths: ['/w/b.md'], tabs: tabs.state.tabs, disk })
        tabs.applyTabEdits.mockImplementationOnce(() => {
            throw new Error('Overlapping ranges are not allowed!')
        })
        const outcome = await apply({ plan: counted, disk, tabs })
        expect(outcome.skipped).toEqual([{ path: '/w/a.md', reason: 'error', detail: 'Overlapping ranges are not allowed!' }])
        expect(outcome.replaced).toEqual([{ path: '/w/b.md', count: 1, route: 'disk' }])
        expect(disk.text('/w/b.md')).toBe('dog')
    })

    it('hands the window back between files, in the count and in the run', async () => {
        const disk = new FakeDisk({ '/w/a.md': 'cat', '/w/b.md': 'cat', '/w/c.md': 'no match' })
        const tabs = openTabs([{ id: '/w/t.md', path: '/w/t.md', content: 'cat' }])
        const countYield = vi.fn(async () => {})
        const counted = await plan({ paths: ['/w/a.md', '/w/b.md', '/w/c.md'], tabs: tabs.state.tabs, disk, yieldToUi: countYield })
        // Once for each file looked at: the tab and the three on disk.
        expect(countYield).toHaveBeenCalledTimes(4)

        const runYield = vi.fn(async () => {})
        await apply({ plan: counted, disk, tabs, yieldToUi: runYield })
        expect(runYield).toHaveBeenCalledTimes(counted.files.length)
        expect(counted.files).toHaveLength(3)
    })
})

describe('createYielder', () => {
    it('lets the window draw once the time budget has gone by, and not before', async () => {
        vi.useFakeTimers()
        /** Whether the yield is over without any timer running. */
        const doneAtOnce = async (pending: Promise<void>) => {
            let done = false
            void pending.then(() => (done = true))
            for (let i = 0; i < 5; i++) await Promise.resolve()
            return done
        }
        try {
            let clock = 0
            const yieldToUi = createYielder(12, () => clock)

            clock = 5
            expect(await doneAtOnce(yieldToUi())).toBe(true) // Within the budget: carries straight on.

            clock = 13
            const pending = yieldToUi()
            expect(await doneAtOnce(pending)).toBe(false) // Waits for a timer, so the window can draw and take keys.
            await vi.runAllTimersAsync()
            await pending

            clock = 20
            expect(await doneAtOnce(yieldToUi())).toBe(true) // The budget starts again after each yield.
            clock = 26
            expect(await doneAtOnce(yieldToUi())).toBe(false)
            await vi.runAllTimersAsync()
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('tabSkipReason', () => {
    it('says why an open tab is left alone, the encoding first for a file that opened read-only for it', () => {
        expect(tabSkipReason({ id: 'example:flow', path: 'flow', content: '' }, isExample)).toBe('example')
        expect(tabSkipReason({ id: '/w/a.md', path: '/w/a.md', content: '', readOnly: true }, isExample)).toBe('read-only')
        expect(tabSkipReason({ id: '/w/a.md', path: '/w/a.md', content: '', readOnly: true, encodingIssue: 'legacy-encoding' }, isExample)).toBe(
            'encoding'
        )
        expect(tabSkipReason({ id: '/w/a.md', path: '/w/a.md', content: '', readOnly: true, encodingIssue: 'binary' }, isExample)).toBe('binary')
        // Made editable since (saved as UTF-8 from then on): the user chose that.
        expect(tabSkipReason({ id: '/w/a.md', path: '/w/a.md', content: '', encodingIssue: 'legacy-encoding' }, isExample)).toBeNull()
    })
})

describe('findOpenTab', () => {
    it('matches paths that differ only in letter case or slash direction on Windows', () => {
        const tabs = [{ path: 'C:\\Notes\\A.md' }]
        expect(findOpenTab(tabs, 'c:/notes/a.md')).toBe(tabs[0])
        expect(findOpenTab(tabs, 'c:/notes/b.md')).toBeUndefined()
    })
})

describe('describeOutcome', () => {
    it('says how many matches were replaced in how many files', () => {
        const outcome = {
            replaced: [{ path: '/w/a.md', count: 2, route: 'disk' as const }],
            replacedMatches: 2,
            skipped: [],
            longLinesSkipped: 0,
            cancelled: false,
        }
        expect(describeOutcome(outcome)).toEqual({ message: 'Replaced 2 matches in a.md.', details: [] })
        expect(
            describeOutcome({ ...outcome, replaced: [...outcome.replaced, { path: '/w/b.md', count: 32, route: 'buffer' }], replacedMatches: 34 })
                .message
        ).toBe('Replaced 34 matches in 2 files.')
    })

    it('lists skipped files with why, long lines, and on cancel what was already written', () => {
        const notice = describeOutcome(
            {
                replaced: [{ path: '/w/a.md', count: 1, route: 'disk' }],
                replacedMatches: 1,
                skipped: [{ path: '/w/old.md', reason: 'encoding' }],
                longLinesSkipped: 2,
                cancelled: true,
            },
            5
        )
        expect(notice.message).toBe('Replace All stopped after 2 files of 5. Replaced 1 match.')
        expect(notice.details).toEqual([
            'Already replaced in a.md.',
            "Skipped 1 file: old.md (it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it).",
            'Left 2 lines longer than 10,000 characters unchanged.',
        ])
    })
})
