import { describe, expect, it } from 'vitest'
import { closedFoldersAbove, isFolderOpen, openFolderPaths } from '@/lib/workspace/folder-toggles'
import type { FileNode } from '@/lib/workspace/types'

const dir = (path: string, children: FileNode[] = []): FileNode => ({ kind: 'directory', name: path.split('\\').at(-1)!, path, children })
const file = (path: string): FileNode => ({ kind: 'file', name: path.split('\\').at(-1)!, path })

// C:\ws
//   docs            (level 1, open by default)
//     guide         (level 2, open by default)
//       deep        (level 3, closed by default)
//         a.md
//   notes           (level 1)
//     b.md
//   top.md
const tree: FileNode[] = [
    dir('C:\\ws\\docs', [dir('C:\\ws\\docs\\guide', [dir('C:\\ws\\docs\\guide\\deep', [file('C:\\ws\\docs\\guide\\deep\\a.md')])])]),
    dir('C:\\ws\\notes', [file('C:\\ws\\notes\\b.md')]),
    file('C:\\ws\\top.md'),
]

describe('isFolderOpen', () => {
    it('opens the first two levels and closes the rest, unless the user chose otherwise', () => {
        const none = new Map<string, boolean>()
        expect(isFolderOpen(none, 'C:\\ws\\docs', 1)).toBe(true)
        expect(isFolderOpen(none, 'C:\\ws\\docs\\guide', 2)).toBe(true)
        expect(isFolderOpen(none, 'C:\\ws\\docs\\guide\\deep', 3)).toBe(false)

        const toggles = new Map([
            ['C:\\ws\\docs', false],
            ['C:\\ws\\docs\\guide\\deep', true],
        ])
        expect(isFolderOpen(toggles, 'C:\\ws\\docs', 1)).toBe(false)
        expect(isFolderOpen(toggles, 'C:/ws/docs/guide/deep/', 3)).toBe(true)
    })
})

describe('closedFoldersAbove', () => {
    it('lists the closed folders that hold a file, outermost first', () => {
        const toggles = new Map([['C:\\ws\\docs', false]])
        expect(closedFoldersAbove(tree, toggles, 'C:\\ws\\docs\\guide\\deep\\a.md')).toEqual(['C:\\ws\\docs', 'C:\\ws\\docs\\guide\\deep'])
    })

    it('is empty when the file already shows', () => {
        expect(closedFoldersAbove(tree, new Map(), 'C:\\ws\\notes\\b.md')).toEqual([])
        expect(closedFoldersAbove(tree, new Map(), 'C:\\ws\\top.md')).toEqual([])
    })

    it('finds the file whatever its letter case or separators', () => {
        expect(closedFoldersAbove(tree, new Map(), 'c:/WS/docs/Guide/DEEP/a.md')).toEqual(['C:\\ws\\docs\\guide\\deep'])
    })

    it('is null for a file the tree does not have (yet)', () => {
        expect(closedFoldersAbove(tree, new Map(), 'C:\\ws\\docs\\new.md')).toBeNull()
        expect(closedFoldersAbove(tree, new Map(), 'C:\\other\\c.md')).toBeNull()
        expect(closedFoldersAbove(tree, new Map(), 'example:flowchart')).toBeNull()
    })

    it('is null for a folder, which is not a file to show', () => {
        expect(closedFoldersAbove(tree, new Map(), 'C:\\ws\\docs\\guide')).toBeNull()
    })
})

describe('openFolderPaths', () => {
    it('lists every open folder, also ones inside closed folders, for Collapse All', () => {
        const toggles = new Map([
            ['C:\\ws\\docs', false],
            ['C:\\ws\\docs\\guide\\deep', true],
        ])
        expect(openFolderPaths(tree, toggles)).toEqual(['C:\\ws\\docs\\guide', 'C:\\ws\\docs\\guide\\deep', 'C:\\ws\\notes'])
    })

    it('is empty when every folder is closed', () => {
        const toggles = new Map([
            ['C:\\ws\\docs', false],
            ['C:\\ws\\docs\\guide', false],
            ['C:\\ws\\notes', false],
        ])
        expect(openFolderPaths(tree, toggles)).toEqual([])
    })
})
