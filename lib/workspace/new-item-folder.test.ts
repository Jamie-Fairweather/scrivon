import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { newItemFolder } from './new-item-folder'

const ROOT = 'C:\\ws'
const tree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: 'C:\\ws\\docs',
        children: [
            { kind: 'directory', name: 'old', path: 'C:\\ws\\docs\\old', children: [] },
            { kind: 'file', name: 'notes.md', path: 'C:\\ws\\docs\\notes.md' },
        ],
    },
    { kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' },
]

describe('newItemFolder', () => {
    it("uses the open file's folder", () => {
        expect(newItemFolder({ root: ROOT, tree, activePath: 'C:\\ws\\docs\\notes.md' })).toBe('C:\\ws\\docs')
        expect(newItemFolder({ root: ROOT, tree, activePath: 'C:\\ws\\flow.mmd' })).toBe('C:\\ws')
    })

    it('uses the selected explorer row before the open file: a folder itself, or the folder a file is in', () => {
        const activePath = 'C:\\ws\\flow.mmd'
        expect(newItemFolder({ root: ROOT, tree, selectedPath: 'C:\\ws\\docs\\old', activePath })).toBe('C:\\ws\\docs\\old')
        expect(newItemFolder({ root: ROOT, tree, selectedPath: 'C:\\ws\\docs\\notes.md', activePath })).toBe('C:\\ws\\docs')
    })

    it('uses the workspace root when nothing is open or selected', () => {
        expect(newItemFolder({ root: ROOT, tree })).toBe(ROOT)
        expect(newItemFolder({ root: ROOT, tree, selectedPath: null, activePath: null })).toBe(ROOT)
    })

    it("uses the workspace root for a path that isn't in the folder: an example tab, or a file since deleted", () => {
        expect(newItemFolder({ root: ROOT, tree, activePath: 'example:simple-flow' })).toBe(ROOT)
        expect(newItemFolder({ root: ROOT, tree, activePath: 'C:\\ws\\docs\\gone.md' })).toBe(ROOT)
        expect(newItemFolder({ root: ROOT, tree, activePath: 'D:\\elsewhere\\notes.md' })).toBe(ROOT)
    })

    it('matches paths whatever their letter case or slashes', () => {
        expect(newItemFolder({ root: ROOT, tree, activePath: 'c:/ws/DOCS/notes.md' })).toBe('C:\\ws\\docs')
    })
})
