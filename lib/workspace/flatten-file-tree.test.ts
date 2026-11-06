import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { flattenSupportedFilePaths, treeKeyAction, visibleTreeRows, type VisibleTreeRow } from '@/lib/workspace/flatten-file-tree'

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
