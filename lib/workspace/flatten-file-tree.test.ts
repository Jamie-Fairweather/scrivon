import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import {
    flattenSupportedFilePaths,
    focusTargetAfterChange,
    treeKeyAction,
    typeAheadMatch,
    visibleTreeRows,
    type VisibleTreeRow,
} from '@/lib/workspace/flatten-file-tree'

describe('flattenSupportedFilePaths', () => {
    it('returns supported document paths only', () => {
        const tree: FileNode[] = [
            { kind: 'file', name: 'readme.md', path: '/root/readme.md' },
            { kind: 'file', name: 'diagram.mmd', path: '/root/diagram.mmd' },
            { kind: 'file', name: 'notes.txt', path: '/root/notes.txt' },
            {
                kind: 'directory',
                name: 'docs',
                path: '/root/docs',
                children: [{ kind: 'file', name: 'guide.mermaid', path: '/root/docs/guide.mermaid' }],
            },
        ]

        expect(flattenSupportedFilePaths(tree).sort()).toEqual(['/root/diagram.mmd', '/root/docs/guide.mermaid', '/root/readme.md'])
    })
})

const tree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: '/ws/docs',
        children: [
            {
                kind: 'directory',
                name: 'deep',
                path: '/ws/docs/deep',
                children: [{ kind: 'file', name: 'a.md', path: '/ws/docs/deep/a.md' }],
            },
            { kind: 'file', name: 'b.md', path: '/ws/docs/b.md' },
        ],
    },
    { kind: 'directory', name: 'empty', path: '/ws/empty', children: [] },
    { kind: 'file', name: 'top.mmd', path: '/ws/top.mmd' },
]

const paths = (rows: VisibleTreeRow[]) => rows.map((row) => row.node.path)

describe('visibleTreeRows', () => {
    it('lists open folders with their entries, and leaves out what is inside closed ones', () => {
        const rows = visibleTreeRows(tree, (path) => path !== '/ws/docs/deep')

        expect(paths(rows)).toEqual(['/ws/docs', '/ws/docs/deep', '/ws/docs/b.md', '/ws/empty', '/ws/top.mmd'])
        expect(rows[1]).toMatchObject({ level: 2, parentPath: '/ws/docs', expanded: false, position: 1, siblingCount: 2 })
        expect(rows[4]).toMatchObject({ level: 1, parentPath: null, expanded: undefined, position: 3, siblingCount: 3 })
    })

    it('passes each folder its level, so callers can open the first levels by default', () => {
        const rows = visibleTreeRows(tree, (_path, level) => level <= 1)

        expect(paths(rows)).toEqual(['/ws/docs', '/ws/docs/deep', '/ws/docs/b.md', '/ws/empty', '/ws/top.mmd'])
    })
})

describe('treeKeyAction', () => {
    const allOpen = visibleTreeRows(tree, () => true)
    const deepClosed = visibleTreeRows(tree, (path) => path !== '/ws/docs/deep')

    it('moves up and down, and jumps to the first and last rows', () => {
        expect(treeKeyAction(allOpen, '/ws/docs', 'ArrowDown')).toEqual({ type: 'focus', path: '/ws/docs/deep' })
        expect(treeKeyAction(allOpen, '/ws/docs/b.md', 'ArrowUp')).toEqual({ type: 'focus', path: '/ws/docs/deep/a.md' })
        expect(treeKeyAction(allOpen, '/ws/docs/b.md', 'Home')).toEqual({ type: 'focus', path: '/ws/docs' })
        expect(treeKeyAction(allOpen, '/ws/docs', 'End')).toEqual({ type: 'focus', path: '/ws/top.mmd' })
        expect(treeKeyAction(allOpen, '/ws/top.mmd', 'ArrowDown')).toBeNull()
        expect(treeKeyAction(allOpen, '/ws/docs', 'ArrowUp')).toBeNull()
    })

    it('opens a closed folder with Right, then steps into it', () => {
        expect(treeKeyAction(deepClosed, '/ws/docs/deep', 'ArrowRight')).toEqual({ type: 'expand', path: '/ws/docs/deep' })
        expect(treeKeyAction(allOpen, '/ws/docs/deep', 'ArrowRight')).toEqual({ type: 'focus', path: '/ws/docs/deep/a.md' })
        expect(treeKeyAction(allOpen, '/ws/empty', 'ArrowRight')).toBeNull()
        expect(treeKeyAction(allOpen, '/ws/top.mmd', 'ArrowRight')).toBeNull()
    })

    it('closes an open folder with Left, otherwise steps out to the folder above', () => {
        expect(treeKeyAction(allOpen, '/ws/docs/deep', 'ArrowLeft')).toEqual({ type: 'collapse', path: '/ws/docs/deep' })
        expect(treeKeyAction(deepClosed, '/ws/docs/deep', 'ArrowLeft')).toEqual({ type: 'focus', path: '/ws/docs' })
        expect(treeKeyAction(allOpen, '/ws/docs/deep/a.md', 'ArrowLeft')).toEqual({ type: 'focus', path: '/ws/docs/deep' })
        expect(treeKeyAction(allOpen, '/ws/top.mmd', 'ArrowLeft')).toBeNull()
    })

    it('opens with Enter or Space, and ignores other keys and unknown rows', () => {
        expect(treeKeyAction(allOpen, '/ws/top.mmd', 'Enter')).toEqual({ type: 'activate', path: '/ws/top.mmd' })
        expect(treeKeyAction(allOpen, '/ws/docs', ' ')).toEqual({ type: 'activate', path: '/ws/docs' })
        expect(treeKeyAction(allOpen, '/ws/top.mmd', 'a')).toBeNull()
        expect(treeKeyAction(allOpen, '/ws/missing.md', 'ArrowDown')).toBeNull()
    })
})

describe('focusTargetAfterChange', () => {
    const rows = visibleTreeRows(tree, () => true)

    it('picks the first of the given paths still in the tree', () => {
        // Renamed: the new path. Rename refused: the old one.
        expect(focusTargetAfterChange(rows, ['/ws/docs/b.md', '/ws/docs/old.md'], 0)).toBe('/ws/docs/b.md')
        expect(focusTargetAfterChange(rows, ['/ws/docs/new.md', '/ws/docs/b.md'], 0)).toBe('/ws/docs/b.md')
    })

    it('matches a Windows path written with the other slash or letter case', () => {
        const windowsRows = visibleTreeRows(
            [
                { kind: 'file', name: 'a.md', path: 'C:\\ws\\a.md' },
                { kind: 'file', name: 'Notes.md', path: 'C:\\ws\\Notes.md' },
            ],
            () => true
        )
        expect(focusTargetAfterChange(windowsRows, ['c:/ws/notes.md'], 0)).toBe('C:\\ws\\Notes.md')
    })

    it('falls back to the row now where the entry was, or the last row', () => {
        // '/ws/docs/deep' (index 1) and what was in it are gone; the row that followed has moved up into its place.
        const afterDelete = rows.filter((row) => !row.node.path.startsWith('/ws/docs/deep'))
        expect(focusTargetAfterChange(afterDelete, ['/ws/docs/deep'], 1)).toBe('/ws/docs/b.md')
        expect(focusTargetAfterChange(afterDelete, ['/ws/gone.md'], 99)).toBe('/ws/top.mmd')
        expect(focusTargetAfterChange(afterDelete, ['/ws/gone.md'], -1)).toBe('/ws/docs')
    })

    it('has nothing to focus in an empty tree', () => {
        expect(focusTargetAfterChange([], ['/ws/top.mmd'], 0)).toBeNull()
    })
})

describe('typeAheadMatch', () => {
    // docs, deep, a.md, b.md, empty, top.mmd
    const rows = visibleTreeRows(tree, () => true)

    it('moves to the next row starting with a letter, ignoring case, and wraps round', () => {
        expect(typeAheadMatch(rows, '/ws/docs', 'b')).toBe('/ws/docs/b.md')
        expect(typeAheadMatch(rows, '/ws/docs/b.md', 'D')).toBe('/ws/docs')
    })

    it('steps through the rows starting with a letter typed again and again', () => {
        expect(typeAheadMatch(rows, '/ws/docs', 'd')).toBe('/ws/docs/deep')
        expect(typeAheadMatch(rows, '/ws/docs/deep', 'dd')).toBe('/ws/docs')
    })

    it('stays on the focused row while a longer word still matches it', () => {
        expect(typeAheadMatch(rows, '/ws/docs/deep', 'de')).toBe('/ws/docs/deep')
        expect(typeAheadMatch(rows, '/ws/docs/deep', 'do')).toBe('/ws/docs')
        expect(typeAheadMatch(rows, '/ws/docs', 'top.')).toBe('/ws/top.mmd')
    })

    it('finds nothing when no name matches', () => {
        expect(typeAheadMatch(rows, '/ws/docs', 'z')).toBeNull()
        expect(typeAheadMatch(rows, '/ws/docs', '')).toBeNull()
        expect(typeAheadMatch([], '/ws/docs', 'd')).toBeNull()
    })
})
