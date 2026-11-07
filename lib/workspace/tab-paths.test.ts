import { describe, expect, it } from 'vitest'
import { remapTabsAfterRename, tabsToCloseOnDelete } from './tab-paths'
import type { DocumentTab } from './types'

function tab(id: string, path: string, name = id): DocumentTab {
    return {
        id,
        path,
        name,
        content: '',
        isDirty: false,
        isSaving: false,
    }
}

describe('remapTabsAfterRename', () => {
    it('updates the renamed file tab', () => {
        const tabs = [tab('/ws/old.mmd', '/ws/old.mmd', 'old.mmd')]
        const result = remapTabsAfterRename(tabs, '/ws/old.mmd', '/ws/new.mmd', 'new.mmd')
        expect(result[0]).toMatchObject({ id: '/ws/new.mmd', path: '/ws/new.mmd', name: 'new.mmd' })
    })

    it('remaps nested paths under a renamed directory', () => {
        const tabs = [
            tab('/ws/docs/readme.md', '/ws/docs/readme.md', 'readme.md'),
            tab('/ws/docs/nested/diagram.mmd', '/ws/docs/nested/diagram.mmd', 'diagram.mmd'),
            tab('/ws/other.mmd', '/ws/other.mmd', 'other.mmd'),
        ]
        const result = remapTabsAfterRename(tabs, '/ws/docs', '/ws/archive', 'archive')
        expect(result[0]).toMatchObject({ id: '/ws/archive/readme.md', path: '/ws/archive/readme.md' })
        expect(result[1]).toMatchObject({ id: '/ws/archive/nested/diagram.mmd', path: '/ws/archive/nested/diagram.mmd' })
        expect(result[2]).toMatchObject({ id: '/ws/other.mmd', path: '/ws/other.mmd' })
    })

    it('handles Windows-style path separators', () => {
        const tabs = [tab('C:\\ws\\docs\\readme.md', 'C:\\ws\\docs\\readme.md', 'readme.md')]
        const result = remapTabsAfterRename(tabs, 'C:\\ws\\docs', 'C:\\ws\\archive', 'archive')
        expect(result[0]).toMatchObject({ id: 'C:\\ws\\archive\\readme.md', path: 'C:\\ws\\archive\\readme.md' })
    })

    it('remaps a Windows tab even when the rename uses other separators or case', () => {
        const tabs = [tab('C:\\ws\\flow.mmd', 'C:\\ws\\flow.mmd', 'flow.mmd'), tab('C:\\ws\\docs\\a.md', 'C:\\ws\\docs\\a.md', 'a.md')]
        const renamedFile = remapTabsAfterRename(tabs, 'C:\\ws/Flow.mmd', 'C:\\ws\\b.mmd', 'b.mmd')
        expect(renamedFile[0]).toMatchObject({ id: 'C:\\ws\\b.mmd', path: 'C:\\ws\\b.mmd', name: 'b.mmd' })

        const renamedFolder = remapTabsAfterRename(tabs, 'C:\\ws/docs', 'C:\\ws/archive', 'archive')
        expect(renamedFolder[1]).toMatchObject({ id: 'C:\\ws\\archive\\a.md', path: 'C:\\ws\\archive\\a.md' })
    })
})

describe('tabsToCloseOnDelete', () => {
    it('closes the deleted file tab', () => {
        const tabs = [tab('/ws/a.mmd', '/ws/a.mmd'), tab('/ws/b.mmd', '/ws/b.mmd')]
        expect(tabsToCloseOnDelete(tabs, '/ws/a.mmd', false)).toEqual([tabs[0]])
    })

    it('closes tabs under a deleted directory', () => {
        const tabs = [
            tab('/ws/docs/readme.md', '/ws/docs/readme.md'),
            tab('/ws/docs/nested/diagram.mmd', '/ws/docs/nested/diagram.mmd'),
            tab('/ws/other.mmd', '/ws/other.mmd'),
        ]
        const closing = tabsToCloseOnDelete(tabs, '/ws/docs', true)
        expect(closing.map((t) => t.path)).toEqual(['/ws/docs/readme.md', '/ws/docs/nested/diagram.mmd'])
    })

    it('closes Windows tabs when the deleted path uses other separators', () => {
        const tabs = [
            tab('C:\\ws\\flow.mmd', 'C:\\ws\\flow.mmd'),
            tab('C:\\ws\\docs\\a.md', 'C:\\ws\\docs\\a.md'),
            tab('C:\\ws\\docs2\\b.md', 'C:\\ws\\docs2\\b.md'),
        ]
        expect(tabsToCloseOnDelete(tabs, 'C:\\ws/flow.mmd', false)).toEqual([tabs[0]])
        expect(tabsToCloseOnDelete(tabs, 'C:\\ws/docs', true)).toEqual([tabs[1]])
    })
})
