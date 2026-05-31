import { describe, expect, it } from 'vitest'
import { buildPreview, searchWorkspaceContent, textHitToPaletteItem } from '@/components/studio/command-palette/search-content'

describe('buildPreview', () => {
    it('trims long lines with ellipsis', () => {
        const line = 'a'.repeat(200)
        const preview = buildPreview(line, 100, 4)
        expect(preview.startsWith('…')).toBe(true)
        expect(preview.endsWith('…')).toBe(true)
        expect(preview.length).toBeLessThanOrEqual(102)
    })

    it('returns short lines unchanged', () => {
        expect(buildPreview('hello world', 6, 5)).toBe('hello world')
    })

    it('adjusts start when the preview window is shorter than max', () => {
        const line = 'abc match xyz'
        expect(buildPreview(line, 4, 5)).toBe('abc match xyz')
    })
})

describe('textHitToPaletteItem', () => {
    it('maps a text hit to a palette item', () => {
        const item = textHitToPaletteItem({
            path: '/workspace/docs/readme.md',
            line: 3,
            column: 5,
            length: 4,
            preview: 'oauth flow',
            source: 'buffer',
        })

        expect(item.kind).toBe('text')
        expect(item.name).toBe('readme.md')
        expect(item.value).toBe('text:/workspace/docs/readme.md:3:5')
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
            maxFilesScanned: 10,
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
            getFileSize: async () => 2_000_000,
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

    it('reports capped when more disk paths remain unscanned', async () => {
        const result = await searchWorkspaceContent({
            query: 'hit',
            paths: ['/one.md', '/two.md', '/three.md'],
            openBuffers: new Map(),
            readFile: async (path) => (path === '/one.md' ? 'hit' : ''),
            signal: new AbortController().signal,
            maxFilesScanned: 1,
            concurrency: 1,
        })

        expect(result.hits).toHaveLength(1)
        expect(result.capped).toBe(true)
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

    it('reads disk when file size is unknown', async () => {
        const result = await searchWorkspaceContent({
            query: 'token',
            paths: ['/disk.md'],
            openBuffers: new Map(),
            readFile: async () => 'token value',
            getFileSize: async () => null,
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
            maxFilesScanned: 2,
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
            getFileSize: async () => 10,
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
            getFileSize: async () => 128,
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
            getFileSize: async () => {
                calls += 1
                if (calls === 1) controller.abort()
                return 10
            },
            signal: controller.signal,
            concurrency: 2,
            maxFilesScanned: 2,
        })

        expect(result.hits).toEqual([])
    })
})
