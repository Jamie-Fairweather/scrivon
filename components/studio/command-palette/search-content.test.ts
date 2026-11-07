import { describe, expect, it, vi } from 'vitest'
import {
    buildPreview,
    createContentCache,
    meetsTextQueryMinimum,
    searchWorkspaceContent,
    textHitToPaletteItem,
} from '@/components/studio/command-palette/search-content'
import type { FileStamp } from '@/lib/workspace/types'

/** A file's size, and when it was last changed (any fixed time unless a test changes it). */
function stamp(size: number, mtimeMs: number | null = 1_700_000_000_000): FileStamp {
    return { size, mtimeMs }
}

describe('buildPreview', () => {
    it('trims long lines with ellipsis', () => {
        const line = 'a'.repeat(200)
        const { preview } = buildPreview(line, 100, 4)
        expect(preview.startsWith('…')).toBe(true)
        expect(preview.endsWith('…')).toBe(true)
        expect(preview.length).toBeLessThanOrEqual(102)
    })

    it('returns short lines unchanged', () => {
        expect(buildPreview('hello world', 6, 5)).toEqual({ preview: 'hello world', matchStart: 6 })
    })

    it('adjusts start when the preview window is shorter than max', () => {
        const line = 'abc match xyz'
        expect(buildPreview(line, 4, 5).preview).toBe('abc match xyz')
    })

    it('reports where the match sits in a trimmed preview, after the leading ellipsis', () => {
        const line = `${'x'.repeat(150)}TARGET${'y'.repeat(150)}`
        const { preview, matchStart } = buildPreview(line, 150, 6)
        expect(preview.slice(matchStart, matchStart + 6)).toBe('TARGET')
    })
})

describe('textHitToPaletteItem', () => {
    it('maps a text hit to a palette item', () => {
        const item = textHitToPaletteItem(
            {
                path: '/workspace/docs/readme.md',
                line: 3,
                column: 5,
                length: 4,
                preview: 'oauth flow',
                previewMatchStart: 0,
                source: 'buffer',
            },
            '/workspace'
        )

        expect(item.kind).toBe('text')
        expect(item.name).toBe('readme.md')
        expect(item.relativePath).toBe('docs/readme.md')
        expect(item.value).toBe('text:/workspace/docs/readme.md:3:5')
        expect(item.documentKind).toBe('markdown')
    })

    it('treats upper-case extensions like the rest of the app', () => {
        const hit = { line: 1, column: 1, length: 4, preview: 'flow', previewMatchStart: 0, source: 'disk' as const }
        expect(textHitToPaletteItem({ ...hit, path: '/workspace/NOTES.Md' }, '/workspace').documentKind).toBe('markdown')
        expect(textHitToPaletteItem({ ...hit, path: '/workspace/FLOW.MMD' }, '/workspace').documentKind).toBe('mermaid')
    })
})

describe('searchWorkspaceContent', () => {
    it('searches open buffers before disk', async () => {
        const readFile = async (path: string) => {
            if (path === '/disk-only.md') return 'disk oauth token'
            return ''
        }

        const result = await searchWorkspaceContent({
            query: 'oauth',
            paths: ['/open.md', '/disk-only.md'],
            openBuffers: new Map([['/open.md', 'buffer oauth value']]),
            readFile,
            signal: new AbortController().signal,
            maxHits: 10,
            concurrency: 2,
        })

        expect(result.hits.some((hit) => hit.source === 'buffer' && hit.path === '/open.md')).toBe(true)
        expect(result.hits.some((hit) => hit.source === 'disk' && hit.path === '/disk-only.md')).toBe(true)
        expect(result.hits.find((hit) => hit.path === '/open.md')?.preview).toContain('oauth')
    })

    it('is case-insensitive', async () => {
        const result = await searchWorkspaceContent({
            query: 'OAuth',
            paths: [],
            openBuffers: new Map([['/a.md', 'configured OAUTH redirect']]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits).toHaveLength(1)
    })

    it('respects max hits cap', async () => {
        const content = 'match match match match'
        const result = await searchWorkspaceContent({
            query: 'match',
            paths: [],
            openBuffers: new Map([['/a.md', content]]),
            readFile: async () => '',
            signal: new AbortController().signal,
            maxHits: 2,
        })

        expect(result.hits).toHaveLength(2)
        expect(result.capped).toBe(true)
    })

    it('aborts in-flight work', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await searchWorkspaceContent({
            query: 'oauth',
            paths: ['/slow.md'],
            openBuffers: new Map(),
            readFile: async () => 'oauth',
            signal: controller.signal,
        })

        expect(result.hits).toEqual([])
    })

    it('skips files larger than max bytes', async () => {
        const result = await searchWorkspaceContent({
            query: 'secret',
            paths: ['/large.md'],
            openBuffers: new Map(),
            readFile: async () => 'should not be read',
            getFileStamp: async () => stamp(2_000_000),
            signal: new AbortController().signal,
            maxFileBytes: 1_048_576,
        })

        expect(result.hits).toHaveLength(0)
    })

    it('caps during buffer search', async () => {
        const result = await searchWorkspaceContent({
            query: 'x',
            paths: [],
            openBuffers: new Map([['/a.md', 'x x x x']]),
            readFile: async () => '',
            signal: new AbortController().signal,
            maxHits: 2,
        })

        expect(result.hits).toHaveLength(2)
        expect(result.capped).toBe(true)
    })

    it('skips disk files when read content exceeds max bytes', async () => {
        const result = await searchWorkspaceContent({
            query: 'secret',
            paths: ['/large.md'],
            openBuffers: new Map(),
            readFile: async () => 'x'.repeat(2_000_000),
            signal: new AbortController().signal,
            maxFileBytes: 100,
        })

        expect(result.hits).toHaveLength(0)
    })

    it('searches every disk file, not just the first 50', async () => {
        const paths = Array.from({ length: 60 }, (_, i) => `/workspace/docs/note-${i}.md`)
        paths.push('/workspace/README.md')
        const read: string[] = []

        const result = await searchWorkspaceContent({
            query: 'roadmap',
            paths,
            openBuffers: new Map(),
            readFile: async (path) => {
                read.push(path)
                return path === '/workspace/README.md' ? 'Our roadmap for 2027' : 'nothing here'
            },
            signal: new AbortController().signal,
        })

        expect(read).toHaveLength(61)
        expect(result.hits.map((hit) => hit.path)).toEqual(['/workspace/README.md'])
        expect(result.capped).toBe(false)
    })

    it('does not report capped when every file was searched without reaching the hit limit', async () => {
        const result = await searchWorkspaceContent({
            query: 'hit',
            paths: ['/one.md', '/two.md', '/three.md'],
            openBuffers: new Map(),
            readFile: async (path) => (path === '/one.md' ? 'hit' : ''),
            signal: new AbortController().signal,
            concurrency: 1,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.capped).toBe(false)
    })

    it('skips files that cannot be read and still returns hits from the rest', async () => {
        const result = await searchWorkspaceContent({
            query: 'oauth',
            paths: ['/a.md', '/gone.md', '/b.md'],
            openBuffers: new Map(),
            readFile: async (path) => {
                if (path === '/gone.md') throw new Error('The system cannot find the file specified. (os error 2)')
                return 'oauth flow'
            },
            signal: new AbortController().signal,
            concurrency: 1,
        })

        expect(result.hits.map((hit) => hit.path).sort()).toEqual(['/a.md', '/b.md'])
        expect(result.unreadableFiles).toBe(1)
    })

    it('skips files whose size check throws', async () => {
        const result = await searchWorkspaceContent({
            query: 'oauth',
            paths: ['/locked.md', '/ok.md'],
            openBuffers: new Map(),
            readFile: async () => 'oauth',
            getFileStamp: async (path) => {
                if (path === '/locked.md') throw new Error('Access is denied. (os error 5)')
                return stamp(10)
            },
            signal: new AbortController().signal,
        })

        expect(result.hits.map((hit) => hit.path)).toEqual(['/ok.md'])
        expect(result.unreadableFiles).toBe(1)
    })

    it('matches decomposed text against a composed query and reports the original position', async () => {
        const line = 'Le cafe\u0301 est bon'
        const result = await searchWorkspaceContent({
            query: 'caf\u00e9',
            paths: [],
            openBuffers: new Map([['/a.md', line]]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.hits[0]).toMatchObject({ column: 4, length: 5 })
        expect(line.slice(3, 3 + 5)).toBe('cafe\u0301')
    })

    it('keeps columns right after decomposed Korean text', async () => {
        const line = `${'한글'.normalize('NFD')} target`
        const result = await searchWorkspaceContent({
            query: 'target',
            paths: [],
            openBuffers: new Map([['/a.md', line]]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits[0]?.column).toBe(line.indexOf('target') + 1)
        expect(result.hits[0]?.length).toBe(6)
    })

    it('finds decomposed Korean when the query is typed composed', async () => {
        const result = await searchWorkspaceContent({
            query: '한글',
            paths: [],
            openBuffers: new Map([['/a.md', `notes ${'한글'.normalize('NFD')}`]]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.hits[0]).toMatchObject({ column: 7, length: '한글'.normalize('NFD').length })
    })

    it('finds Turkish text with dotted capital I and keeps columns right after it', async () => {
        const line = 'İSTANBUL İzmir Ankara notları'
        const search = (query: string) =>
            searchWorkspaceContent({
                query,
                paths: [],
                openBuffers: new Map([['/a.md', line]]),
                readFile: async () => '',
                signal: new AbortController().signal,
            })

        const izmir = await search('izmir')
        expect(izmir.hits).toHaveLength(1)
        expect(izmir.hits[0]).toMatchObject({ column: 10, length: 5 })

        const ankara = (await search('ankara')).hits[0]!
        expect(ankara).toMatchObject({ column: 16, length: 6 })
        expect(ankara.preview.slice(ankara.previewMatchStart, ankara.previewMatchStart + ankara.length)).toBe('Ankara')
    })

    it('matches Greek words however the sigma is written', async () => {
        const result = await searchWorkspaceContent({
            query: 'ΟΔΟΣ',
            paths: [],
            openBuffers: new Map([['/a.md', 'ΟΔΟΣΗ and οδος']]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits.map((hit) => hit.column)).toEqual([1, 11])
    })

    it('gives each hit on a line its own highlight position', async () => {
        const result = await searchWorkspaceContent({
            query: 'aa',
            paths: [],
            openBuffers: new Map([['/a.md', 'aa bb aa']]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits.map((hit) => hit.previewMatchStart)).toEqual([0, 6])
    })

    it('lists disk hits in file-tree order, not in the order reads finish', async () => {
        const paths = ['/a.md', '/b.md', '/c.md', '/d.md']
        // Later files finish first.
        const readFile = (path: string) =>
            new Promise<string>((resolve) => setTimeout(() => resolve('hit'), (paths.length - paths.indexOf(path)) * 5))

        const all = await searchWorkspaceContent({
            query: 'hit',
            paths,
            openBuffers: new Map(),
            readFile,
            signal: new AbortController().signal,
            concurrency: 4,
        })
        expect(all.hits.map((hit) => hit.path)).toEqual(paths)

        const firstTwo = await searchWorkspaceContent({
            query: 'hit',
            paths,
            openBuffers: new Map(),
            readFile,
            signal: new AbortController().signal,
            concurrency: 4,
            maxHits: 2,
        })
        expect(firstTwo.hits.map((hit) => hit.path)).toEqual(['/a.md', '/b.md'])
        expect(firstTwo.capped).toBe(true)
    })

    it("limits each file's hits so one busy file can't hide the rest", async () => {
        const busy = Array.from({ length: 50 }, () => 'A --> B').join('\n')
        const result = await searchWorkspaceContent({
            query: '-->',
            paths: ['/busy.mmd', '/other.mmd'],
            openBuffers: new Map(),
            readFile: async (path) => (path === '/busy.mmd' ? busy : 'C --> D'),
            signal: new AbortController().signal,
            maxHitsPerFile: 10,
        })

        expect(result.hits.filter((hit) => hit.path === '/busy.mmd')).toHaveLength(10)
        expect(result.hits.filter((hit) => hit.path === '/other.mmd')).toHaveLength(1)
        expect(result.truncatedFiles).toBe(1)
        expect(result.capped).toBe(false)
    })

    it('limits hits from a busy open tab too', async () => {
        const result = await searchWorkspaceContent({
            query: '-->',
            paths: ['/other.mmd'],
            openBuffers: new Map([['/open.mmd', Array.from({ length: 200 }, () => 'A --> B').join('\n')]]),
            readFile: async () => 'C --> D',
            signal: new AbortController().signal,
        })

        expect(result.hits.filter((hit) => hit.path === '/open.mmd')).toHaveLength(10)
        expect(result.hits.some((hit) => hit.path === '/other.mmd')).toBe(true)
        expect(result.truncatedFiles).toBe(1)
    })

    it('does not report a file as truncated when it has exactly the per-file limit', async () => {
        const result = await searchWorkspaceContent({
            query: 'x',
            paths: [],
            openBuffers: new Map([['/a.md', 'x x x']]),
            readFile: async () => '',
            signal: new AbortController().signal,
            maxHitsPerFile: 3,
        })

        expect(result.hits).toHaveLength(3)
        expect(result.truncatedFiles).toBe(0)
    })

    it('finds multiple matches on one line', async () => {
        const result = await searchWorkspaceContent({
            query: 'aa',
            paths: [],
            openBuffers: new Map([['/a.md', 'aa bb aa']]),
            readFile: async () => '',
            signal: new AbortController().signal,
        })

        expect(result.hits).toHaveLength(2)
    })

    it('returns early when aborted during buffer scan', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await searchWorkspaceContent({
            query: 'x',
            paths: [],
            openBuffers: new Map([['/a.md', 'x']]),
            readFile: async () => '',
            signal: controller.signal,
        })

        expect(result.hits).toEqual([])
        expect(result.capped).toBe(false)
    })

    it('reads disk when the file size is unknown', async () => {
        const result = await searchWorkspaceContent({
            query: 'token',
            paths: ['/disk.md'],
            openBuffers: new Map(),
            readFile: async () => 'token value',
            getFileStamp: async () => null,
            signal: new AbortController().signal,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.hits[0]?.source).toBe('disk')
    })

    it('stops collecting disk hits once max hits is reached', async () => {
        const result = await searchWorkspaceContent({
            query: 'hit',
            paths: ['/one.md', '/two.md'],
            openBuffers: new Map(),
            readFile: async () => 'hit',
            signal: new AbortController().signal,
            maxHits: 1,
            concurrency: 2,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.capped).toBe(true)
    })

    it('ignores disk content when aborted during read', async () => {
        const controller = new AbortController()
        const result = await searchWorkspaceContent({
            query: 'x',
            paths: ['/disk.md'],
            openBuffers: new Map(),
            readFile: async () => {
                controller.abort()
                return 'x'
            },
            signal: controller.signal,
        })

        expect(result.hits).toEqual([])
    })

    it('ignores disk scan when already aborted before read', async () => {
        const controller = new AbortController()
        controller.abort()

        const result = await searchWorkspaceContent({
            query: 'x',
            paths: ['/disk.md'],
            openBuffers: new Map(),
            readFile: async () => 'x',
            getFileStamp: async () => stamp(10),
            signal: controller.signal,
        })

        expect(result.hits).toEqual([])
    })

    it('reads disk files when size is within the limit', async () => {
        const result = await searchWorkspaceContent({
            query: 'token',
            paths: ['/disk.md'],
            openBuffers: new Map(),
            readFile: async () => 'token value',
            getFileStamp: async () => stamp(128),
            signal: new AbortController().signal,
        })

        expect(result.hits).toHaveLength(1)
    })

    it('aborts remaining disk scans after the signal is cancelled mid-pass', async () => {
        const controller = new AbortController()
        let calls = 0

        const result = await searchWorkspaceContent({
            query: 'x',
            paths: ['/one.md', '/two.md'],
            openBuffers: new Map(),
            readFile: async () => 'x',
            getFileStamp: async () => {
                calls += 1
                if (calls === 1) controller.abort()
                return stamp(10)
            },
            signal: controller.signal,
            concurrency: 2,
        })

        expect(result.hits).toEqual([])
    })
})

describe('searchWorkspaceContent file cache', () => {
    const files: Record<string, string> = { '/a.md': 'the oauth flow', '/b.md': 'oauth tokens' }

    function search(
        query: string,
        cache: ReturnType<typeof createContentCache>,
        readFile: (path: string) => Promise<string>,
        sizes = files,
        mtimes: Record<string, number> = {}
    ) {
        return searchWorkspaceContent({
            query,
            paths: Object.keys(files),
            openBuffers: new Map(),
            readFile,
            getFileStamp: async (path) => stamp(sizes[path]!.length, mtimes[path]),
            cache,
            signal: new AbortController().signal,
        })
    }

    it('does not read unchanged files again for the next query', async () => {
        const cache = createContentCache()
        const readFile = vi.fn(async (path: string) => files[path]!)

        await search('oauth', cache, readFile)
        expect(readFile).toHaveBeenCalledTimes(2)

        const result = await search('tokens', cache, readFile)
        expect(readFile).toHaveBeenCalledTimes(2)
        expect(result.hits.map((hit) => hit.path)).toEqual(['/b.md'])
    })

    it('reads a file again when its size on disk has changed', async () => {
        const cache = createContentCache()
        await search('oauth', cache, async (path) => files[path]!)

        const changed: Record<string, string> = { ...files, '/a.md': 'the oauth flow, now with tokens' }
        const readFile = vi.fn(async (path: string) => changed[path]!)
        const result = await search('tokens', cache, readFile, changed)

        expect(readFile).toHaveBeenCalledTimes(1)
        expect(readFile).toHaveBeenCalledWith('/a.md')
        expect(result.hits.map((hit) => hit.path)).toEqual(['/a.md', '/b.md'])
    })

    it('reads a file again when it was changed on disk but kept its size', async () => {
        const cache = createContentCache()
        await search('oauth', cache, async (path) => files[path]!)

        // Another app swapped 'oauth' for 'login' and saved: same number of bytes, newer time.
        const changed: Record<string, string> = { ...files, '/a.md': 'the login flow' }
        const readFile = vi.fn(async (path: string) => changed[path]!)
        const result = await search('oauth', cache, readFile, changed, { '/a.md': 1_700_000_005_000 })

        expect(readFile).toHaveBeenCalledTimes(1)
        expect(readFile).toHaveBeenCalledWith('/a.md')
        expect(result.hits.map((hit) => hit.path)).toEqual(['/b.md'])
    })

    it('reuses text by size alone when the system gives no modified time', async () => {
        const cache = createContentCache()
        cache.set('/a.md', stamp(5, null), 'cache')

        expect(cache.get('/a.md', stamp(5, 1))).toBe('cache')
        expect(cache.get('/a.md', stamp(6, 1))).toBeUndefined()
    })

    it('does not use the cache when the file size is unknown', async () => {
        const cache = createContentCache()
        const readFile = vi.fn(async () => 'oauth')
        const options = { paths: ['/a.md'], openBuffers: new Map<string, string>(), readFile, cache, signal: new AbortController().signal }

        await searchWorkspaceContent({ ...options, query: 'oauth' })
        await searchWorkspaceContent({ ...options, query: 'oau' })
        expect(readFile).toHaveBeenCalledTimes(2)
    })

    it('keeps text read by a search that was cancelled meanwhile', async () => {
        const cache = createContentCache()
        const controller = new AbortController()
        await searchWorkspaceContent({
            query: 'oauth',
            paths: ['/a.md'],
            openBuffers: new Map(),
            readFile: async () => {
                controller.abort()
                return 'the oauth flow'
            },
            getFileStamp: async () => stamp(14),
            cache,
            signal: controller.signal,
        })

        expect(cache.get('/a.md', stamp(14))).toBe('the oauth flow')
    })
})

describe('meetsTextQueryMinimum', () => {
    it('searches a single Chinese, Japanese or Korean character', () => {
        expect(meetsTextQueryMinimum('図', 'all')).toBe(true)
        expect(meetsTextQueryMinimum('ね', 'all')).toBe(true)
        expect(meetsTextQueryMinimum('표', 'all')).toBe(true)
    })

    it('searches from the first character in Find in Workspace', () => {
        expect(meetsTextQueryMinimum('x', 'text')).toBe(true)
        expect(meetsTextQueryMinimum('', 'text')).toBe(false)
    })

    it('needs two characters elsewhere, counting an emoji as one', () => {
        expect(meetsTextQueryMinimum('x', 'all')).toBe(false)
        expect(meetsTextQueryMinimum('\u{1F600}', 'all')).toBe(false)
        expect(meetsTextQueryMinimum('ab', 'all')).toBe(true)
    })
})

describe('createContentCache', () => {
    it('stops adding files once its size budget is used up', () => {
        const cache = createContentCache(10)
        cache.set('/a.md', stamp(6), 'aaaaaa')
        cache.set('/b.md', stamp(6), 'bbbbbb')

        expect(cache.get('/a.md', stamp(6))).toBe('aaaaaa')
        expect(cache.get('/b.md', stamp(6))).toBeUndefined()
    })

    it('frees the old text when a file is stored again', () => {
        const cache = createContentCache(10)
        cache.set('/a.md', stamp(6), 'aaaaaa')
        cache.set('/a.md', stamp(2), 'aa')
        cache.set('/b.md', stamp(6), 'bbbbbb')

        expect(cache.get('/a.md', stamp(2))).toBe('aa')
        expect(cache.get('/b.md', stamp(6))).toBe('bbbbbb')
    })

    it('forgets everything when cleared', () => {
        const cache = createContentCache()
        cache.set('/a.md', stamp(1), 'a')
        cache.clear()
        expect(cache.get('/a.md', stamp(1))).toBeUndefined()
    })
})
