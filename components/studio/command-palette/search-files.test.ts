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

    it('finds a file when the folder is typed before the file name', () => {
        const paths = ['/workspace/docs/readme.md', '/workspace/notes.md', '/workspace/api/auth-flow.md']
        expect(searchFiles(paths, root, 'docs readme').map((item) => item.path)).toEqual(['/workspace/docs/readme.md'])
        expect(searchFiles(paths, root, 'api auth').map((item) => item.path)).toEqual(['/workspace/api/auth-flow.md'])
    })

    it('uses backslash-relative paths on Windows-style roots', () => {
        const results = searchFiles(['C:\\workspace\\readme.md'], 'C:\\workspace', 'readme')
        expect(results[0]?.relativePath).toBe('readme.md')
    })

    it('strips the root from Windows tree paths that mix separators', () => {
        const results = searchFiles(['C:\\Users\\jamie\\docs/sub/notes.md'], 'C:\\Users\\jamie\\docs', 'notes')
        expect(results[0]?.relativePath).toBe('sub/notes.md')
    })

    it('ignores drive letter case when stripping the root', () => {
        const results = searchFiles(['c:\\Root/a.md'], 'C:\\root\\', 'a')
        expect(results[0]?.relativePath).toBe('a.md')
    })

    it('does not match queries against the workspace root folder names', () => {
        const paths = ['C:\\Users\\jamie\\Documents\\Diagrams/flow.mmd', 'C:\\Users\\jamie\\Documents\\Diagrams/sub/notes.md']
        expect(searchFiles(paths, 'C:\\Users\\jamie\\Documents\\Diagrams', 'jamie')).toEqual([])
        expect(searchFiles(paths, 'C:\\Users\\jamie\\Documents\\Diagrams', 'users')).toEqual([])
    })

    it('keeps paths in a sibling folder that shares the root as a prefix', () => {
        const results = searchFiles(['/workspace2/readme.md'], '/workspace', 'readme')
        expect(results[0]?.relativePath).toBe('/workspace2/readme.md')
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
            '/workspace',
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
            '/workspace',
            'b.md',
            () => false
        )

        expect(results).toHaveLength(1)
        expect(results[0]?.path).toBe('/workspace/b.md')
    })

    it('does not match tabs on letters in the workspace root path', () => {
        const root = 'C:\\Users\\jamie\\Documents'
        const tabs = [
            { id: `${root}/a.mmd`, path: `${root}/a.mmd`, name: 'a.mmd', isDirty: false },
            { id: `${root}/b.mmd`, path: `${root}/b.mmd`, name: 'b.mmd', isDirty: false },
        ]

        expect(searchOpenTabs(tabs, root, 'sum', () => false)).toEqual([])
        expect(searchOpenTabs(tabs, root, 'jamie', () => false)).toEqual([])
        expect(searchOpenTabs(tabs, root, 'b.mmd', () => false).map((item) => item.name)).toEqual(['b.mmd'])
    })

    it('matches tabs on their folder inside the workspace', () => {
        const tabs = [
            { id: '/workspace/api/flow.mmd', path: '/workspace/api/flow.mmd', name: 'flow.mmd', isDirty: false },
            { id: '/workspace/flow.mmd', path: '/workspace/flow.mmd', name: 'flow.mmd', isDirty: false },
        ]

        expect(searchOpenTabs(tabs, '/workspace', 'api flow', () => false).map((item) => item.path)).toEqual(['/workspace/api/flow.mmd'])
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
