import { describe, expect, it } from 'vitest'
import { searchFiles, searchOpenTabs, searchRecentFiles } from '@/components/studio/command-palette/search-files'

describe('searchFiles', () => {
    const root = '/workspace'

    it('ranks matching paths and caps results', () => {
        const paths = Array.from({ length: 30 }, (_, i) => `/workspace/docs/file-${i}.md`)
        paths.push('/workspace/docs/readme.md')

        const results = searchFiles(paths, root, 'readme')
        expect(results.length).toBeLessThanOrEqual(20)
        expect(results[0]?.path).toContain('readme.md')
    })

    it('uses backslash-relative paths on Windows-style roots', () => {
        const results = searchFiles(['C:\\workspace\\readme.md'], 'C:\\workspace', 'readme')
        expect(results[0]?.relativePath).toBe('readme.md')
    })

    it('normalizes workspace roots with trailing separators', () => {
        const results = searchFiles(['/workspace/readme.md'], '/workspace/', 'readme')
        expect(results[0]?.relativePath).toBe('readme.md')
    })

    it('keeps absolute paths outside the workspace root', () => {
        const results = searchFiles(['/other/readme.md'], '/workspace', 'readme')
        expect(results[0]?.relativePath).toBe('/other/readme.md')
    })

    it('defaults unknown document kinds to markdown', () => {
        const results = searchFiles(['/workspace/readme'], '/workspace', 'readme')
        expect(results[0]?.documentKind).toBe('markdown')
    })
})

describe('searchOpenTabs', () => {
    it('excludes example tabs', () => {
        const results = searchOpenTabs(
            [
                { id: 'example:demo', path: 'example:demo', name: 'demo.mmd', isDirty: false },
                { id: '/workspace/a.md', path: '/workspace/a.md', name: 'a.md', isDirty: true },
            ],
            '',
            (id) => id.startsWith('example:')
        )

        expect(results).toHaveLength(1)
        expect(results[0]?.path).toBe('/workspace/a.md')
    })

    it('filters tabs by query', () => {
        const results = searchOpenTabs(
            [
                { id: '/workspace/a.md', path: '/workspace/a.md', name: 'a.md', isDirty: false },
                { id: '/workspace/b.md', path: '/workspace/b.md', name: 'b.md', isDirty: false },
            ],
            'b.md',
            () => false
        )

        expect(results).toHaveLength(1)
        expect(results[0]?.path).toBe('/workspace/b.md')
    })
})

describe('searchRecentFiles', () => {
    it('skips paths that are already open', () => {
        const results = searchRecentFiles(['/workspace/a.md', '/workspace/b.md'], '/workspace', '', new Set(['/workspace/a.md']))
        expect(results.map((item) => item.path)).toEqual(['/workspace/b.md'])
    })

    it('filters recent files by query using windows-style paths', () => {
        const results = searchRecentFiles(['C:\\workspace\\notes.md'], 'C:\\workspace', 'notes', new Set())
        expect(results).toHaveLength(1)
        expect(results[0]?.kind).toBe('recent')
        expect(results[0]?.value).toBe('recent:C:\\workspace\\notes.md')
    })
})
