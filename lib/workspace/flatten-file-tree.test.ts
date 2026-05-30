import { describe, expect, it } from 'vitest'
import type { FileNode } from '@/lib/workspace/types'
import { flattenSupportedFilePaths } from '@/lib/workspace/flatten-file-tree'

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
