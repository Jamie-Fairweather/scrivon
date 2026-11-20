import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createContentCache } from '@/components/studio/command-palette/search-content'
import { documentLinks } from '@/lib/markdown/document-links'
import {
    BACKLINKS_DELAY_MS,
    createBacklinksScanner,
    scanBacklinks,
    type BacklinksResult,
    type ParsedLinksCache,
    type ScanBacklinksOptions,
} from '@/lib/workspace/backlinks'
import type { FileNode, FileStamp } from '@/lib/workspace/types'
import { buildWikiIndex } from '@/lib/workspace/wiki-link-lookup'

const ROOT = 'C:\\notes'
const file = (path: string): FileNode => ({ kind: 'file', name: path.split('\\').at(-1)!, path: `${ROOT}\\${path}` })
const folder = (path: string, children: FileNode[], extra: object = {}): FileNode => ({
    kind: 'directory',
    name: path.split('\\').at(-1)!,
    path: `${ROOT}\\${path}`,
    children,
    ...extra,
})

const PLAN = `${ROOT}\\work\\Plan.md`
const TREE: FileNode[] = [folder('work', [file('work\\Plan.md'), file('work\\Today.md')]), file('Home.md'), file('Big.md'), file('Quiet.md')]

const DISK: Record<string, string> = {
    [`${ROOT}\\work\\Today.md`]: '# Today\n\n- Read [[Plan]] first\n- and [[Plan#Goals|its goals]]\n- not [[Home]]',
    [`${ROOT}\\Home.md`]: 'Start at [[work/plan]].\n\n`[[Plan]]` in code is not a link.',
    [`${ROOT}\\Big.md`]: '[[Plan]] '.repeat(10),
    [`${ROOT}\\Quiet.md`]: 'No links here.',
    [PLAN]: 'Links to [[Plan]] itself are left out.',
}

function options(overrides: Partial<ScanBacklinksOptions> = {}): ScanBacklinksOptions {
    return {
        target: PLAN,
        index: buildWikiIndex(ROOT, TREE),
        openTexts: [],
        readLinks: vi.fn(async (text: string) => documentLinks(text).wikiLinks),
        readFile: vi.fn(async (path: string) => DISK[path] ?? ''),
        getFileStamp: vi.fn(async (path: string): Promise<FileStamp> => ({ mtimeMs: 1, size: (DISK[path] ?? '').length })),
        signal: new AbortController().signal,
        maxFileBytes: 80,
        ...overrides,
    }
}

describe('scanBacklinks', () => {
    it('lists the wiki links in other notes that lead to the file, in tree order, with each line’s text', async () => {
        const result = await scanBacklinks(options())
        expect(result).toEqual({
            target: PLAN,
            incomplete: false,
            links: [
                { path: `${ROOT}\\work\\Today.md`, relative: 'work/Today', line: 3, column: 8, text: '- Read [[Plan]] first' },
                { path: `${ROOT}\\work\\Today.md`, relative: 'work/Today', line: 4, column: 7, text: '- and [[Plan#Goals|its goals]]' },
                { path: `${ROOT}\\Home.md`, relative: 'Home', line: 1, column: 10, text: 'Start at [[work/plan]].' },
            ],
        })
    })

    it('reads an open tab’s unsaved text over the disk’s, however its path is written', async () => {
        const readFile = vi.fn(async (path: string) => DISK[path] ?? '')
        const result = await scanBacklinks(options({ readFile, openTexts: [{ path: 'c:/notes/home.md', content: 'Nothing now.' }] }))
        expect(result!.links.map((link) => link.relative)).toEqual(['work/Today', 'work/Today'])
        expect(readFile).not.toHaveBeenCalledWith(`${ROOT}\\Home.md`)
    })

    it('skips files over the size limit, and parses no note without [[ in it', async () => {
        const readLinks = vi.fn(async (text: string) => documentLinks(text).wikiLinks)
        const readFile = vi.fn(async (path: string) => DISK[path] ?? '')
        const result = await scanBacklinks(options({ readLinks, readFile }))
        expect(result!.links.some((link) => link.relative === 'Big')).toBe(false)
        expect(readFile).not.toHaveBeenCalledWith(`${ROOT}\\Big.md`)
        expect(readLinks.mock.calls.map(([text]) => text)).not.toContain('No links here.')
    })

    it('takes unchanged files from the stamp-keyed cache, and parses unchanged text once', async () => {
        const cache = createContentCache()
        const parsed: ParsedLinksCache = new Map()
        const readFile = vi.fn(async (path: string) => DISK[path] ?? '')
        const readLinks = vi.fn(async (text: string) => documentLinks(text).wikiLinks)
        await scanBacklinks(options({ cache, parsed, readFile, readLinks }))
        const reads = readFile.mock.calls.length
        const parses = readLinks.mock.calls.length
        const again = await scanBacklinks(options({ cache, parsed, readFile, readLinks }))
        expect(readFile).toHaveBeenCalledTimes(reads)
        expect(readLinks).toHaveBeenCalledTimes(parses)
        expect(again!.links).toHaveLength(3)
    })

    it('reads at most `concurrency` files at a time', async () => {
        let reading = 0
        let most = 0
        const readFile = vi.fn(async (path: string) => {
            reading += 1
            most = Math.max(most, reading)
            await new Promise((resolve) => setTimeout(resolve, 1))
            reading -= 1
            return DISK[path] ?? ''
        })
        await scanBacklinks(options({ readFile, concurrency: 2 }))
        expect(most).toBe(2)
    })

    it('stops reading and reports nothing once aborted', async () => {
        const controller = new AbortController()
        const readFile = vi.fn(async (path: string) => {
            controller.abort()
            return DISK[path] ?? ''
        })
        expect(await scanBacklinks(options({ readFile, signal: controller.signal, concurrency: 1 }))).toBeNull()
        expect(readFile).toHaveBeenCalledTimes(1)
    })

    it('says the list may be incomplete when the tree was cut short, and leaves out a note it can’t read', async () => {
        const readFile = vi.fn(async (path: string) => {
            if (path.endsWith('Home.md')) throw new Error('locked')
            return DISK[path] ?? ''
        })
        const index = buildWikiIndex(ROOT, [...TREE, folder('big', [], { truncated: true })])
        const result = await scanBacklinks(options({ index, readFile }))
        expect(result!.incomplete).toBe(true)
        expect(result!.links.map((link) => link.relative)).toEqual(['work/Today', 'work/Today'])
    })
})

describe('createBacklinksScanner', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    const result = (target: string): BacklinksResult => ({ target, links: [], incomplete: false })

    it('scans once requests pause, for the newest request only', async () => {
        const scan = vi.fn(async (input: string) => result(input))
        const onResult = vi.fn()
        const scanner = createBacklinksScanner(scan, onResult)
        scanner.request('a')
        await vi.advanceTimersByTimeAsync(BACKLINKS_DELAY_MS - 50)
        scanner.request('b')
        await vi.advanceTimersByTimeAsync(BACKLINKS_DELAY_MS - 50)
        expect(scan).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(50)
        expect(scan.mock.calls.map(([input]) => input)).toEqual(['b'])
        expect(onResult).toHaveBeenCalledWith(result('b'))
    })

    it('aborts the scan in progress when a newer one is asked for, and never reports it', async () => {
        const signals: AbortSignal[] = []
        let finishFirst: (value: BacklinksResult) => void = () => {}
        const scan = vi.fn((input: string, signal: AbortSignal) => {
            signals.push(signal)
            return input === 'old' ? new Promise<BacklinksResult>((resolve) => (finishFirst = resolve)) : Promise.resolve(result(input))
        })
        const onResult = vi.fn()
        const scanner = createBacklinksScanner(scan, onResult)
        scanner.request('old')
        await vi.advanceTimersByTimeAsync(BACKLINKS_DELAY_MS)
        scanner.request('new')
        expect(signals[0]!.aborted).toBe(true)
        finishFirst(result('old'))
        await vi.advanceTimersByTimeAsync(BACKLINKS_DELAY_MS)
        expect(onResult.mock.calls.map(([found]) => found.target)).toEqual(['new'])
    })

    it('reports nothing after it is cancelled', async () => {
        const onResult = vi.fn()
        const scanner = createBacklinksScanner(async (input: string) => result(input), onResult)
        scanner.request('a')
        scanner.cancel()
        await vi.advanceTimersByTimeAsync(BACKLINKS_DELAY_MS * 2)
        expect(onResult).not.toHaveBeenCalled()
    })
})
