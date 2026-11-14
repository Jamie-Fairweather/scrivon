import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { foldersHolding, moveRefusal, moveTargets } from './move-entry'

describe('foldersHolding', () => {
    it('lists the folders between the open folder and an entry, outermost first', () => {
        expect(foldersHolding('C:\\ws\\docs\\old\\notes.md', 'C:\\ws')).toEqual(['C:\\ws\\docs', 'C:\\ws\\docs\\old'])
        expect(foldersHolding('C:\\ws\\notes.md', 'C:\\ws')).toEqual([])
        expect(foldersHolding('D:\\elsewhere\\notes.md', 'C:\\ws')).toEqual([])
    })
})

describe('moveRefusal', () => {
    it('lets a file or folder move into another folder', () => {
        expect(moveRefusal('C:\\ws\\notes.md', false, 'C:\\ws\\docs')).toBeNull()
        expect(moveRefusal('C:\\ws\\docs', true, 'C:\\ws\\archive')).toBeNull()
        expect(moveRefusal('C:\\ws\\docs\\notes.md', false, 'C:\\ws')).toBeNull()
    })

    it('refuses a folder moving into itself or a folder inside it, in any letter case', () => {
        expect(moveRefusal('C:\\ws\\docs', true, 'C:\\ws\\docs')).toBe('into-itself')
        expect(moveRefusal('C:\\ws\\docs', true, 'C:\\ws\\Docs\\old')).toBe('into-itself')
        expect(moveRefusal('C:\\ws\\docs', true, 'c:/ws/docs/old/older')).toBe('into-itself')
    })

    it('says when the entry is already in that folder', () => {
        expect(moveRefusal('C:\\ws\\docs\\notes.md', false, 'C:\\ws\\DOCS')).toBe('same-folder')
        expect(moveRefusal('C:\\ws\\docs', true, 'C:\\ws')).toBe('same-folder')
    })

    it('does not mistake a folder with a longer name for one inside it', () => {
        expect(moveRefusal('C:\\ws\\docs', true, 'C:\\ws\\docs-old')).toBeNull()
    })
})

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
    { kind: 'directory', name: 'shared', path: 'C:\\ws\\shared', children: [], unreadable: true, linksOutside: true },
    { kind: 'directory', name: 'locked', path: 'C:\\ws\\locked', children: [], unreadable: true },
    { kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' },
]

describe('moveTargets', () => {
    it('lists the top of the folder and every folder in it, with where each one is', () => {
        const targets = moveTargets(tree, 'C:\\ws', { kind: 'file', name: 'flow.mmd', path: 'C:\\ws\\flow.mmd' })

        expect(targets.map((t) => [t.path, t.label])).toEqual([
            ['C:\\ws', 'ws'],
            ['C:\\ws\\docs', 'docs'],
            ['C:\\ws\\docs\\old', 'docs/old'],
        ])
    })

    it('marks the folder the entry is in now', () => {
        const targets = moveTargets(tree, 'C:\\ws', { kind: 'file', name: 'notes.md', path: 'C:\\ws\\docs\\notes.md' })

        expect(targets.find((t) => t.path === 'C:\\ws\\docs')).toMatchObject({ current: true })
        expect(targets.filter((t) => t.current)).toHaveLength(1)
    })

    it('leaves out a moving folder and the folders inside it', () => {
        const targets = moveTargets(tree, 'C:\\ws', tree[0]!)

        expect(targets.map((t) => t.path)).toEqual(['C:\\ws'])
        expect(targets[0]).toMatchObject({ current: true })
    })
})
