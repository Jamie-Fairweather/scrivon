import { describe, expect, it } from 'vitest'
import { getTabFolderHints } from './tab-labels'

function tab(path: string, name = path.split(/[/\\]/).pop()!) {
    return { id: path, path, name }
}

describe('getTabFolderHints', () => {
    it('adds nothing when every file name is different', () => {
        expect(getTabFolderHints([tab('/w/docs/a.md'), tab('/w/docs/b.md')]).size).toBe(0)
    })

    it('names the folder that tells two same-named files apart', () => {
        const hints = getTabFolderHints([tab('/w/docs/api/README.md'), tab('/w/docs/guide/README.md'), tab('/w/notes.md')])
        expect([...hints]).toEqual([
            ['/w/docs/api/README.md', 'api'],
            ['/w/docs/guide/README.md', 'guide'],
        ])
    })

    it('goes up more folders when the nearest ones match', () => {
        const hints = getTabFolderHints([tab('/w/a/x/README.md'), tab('/w/b/x/README.md'), tab('/w/b/y/README.md')])
        expect(hints.get('/w/a/x/README.md')).toBe('a/x')
        expect(hints.get('/w/b/x/README.md')).toBe('b/x')
        expect(hints.get('/w/b/y/README.md')).toBe('y')
    })

    it('handles Windows paths and ignores case', () => {
        const hints = getTabFolderHints([tab('C:\\w\\Api\\readme.md'), tab('C:/w/guide/README.md')])
        expect(hints.get('C:\\w\\Api\\readme.md')).toBe('Api')
        expect(hints.get('C:/w/guide/README.md')).toBe('guide')
    })

    it('shows the whole folder path when no ending is unique', () => {
        const hints = getTabFolderHints([tab('/w/Docs/README.md'), tab('/w/docs/README.md')])
        expect(hints.get('/w/Docs/README.md')).toBe('w/Docs')
        expect(hints.get('/w/docs/README.md')).toBe('w/docs')
    })

    it('leaves tabs without folders, like examples, alone', () => {
        const hints = getTabFolderHints([tab('example:flow', 'Flow.mmd'), tab('/w/Flow.mmd')])
        expect(hints.has('example:flow')).toBe(false)
        expect(hints.get('/w/Flow.mmd')).toBe('w')
    })
})
