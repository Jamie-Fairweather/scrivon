import { describe, expect, it } from 'vitest'
import { collectFileNames, collectFilePaths, findNodeByPath, uniqueFileName, uniqueUntitledName, validateFileName } from './paths'
import type { FileNode } from './types'

const sampleTree: FileNode[] = [
    {
        kind: 'directory',
        name: 'docs',
        path: '/ws/docs',
        children: [
            { kind: 'file', name: 'readme.md', path: '/ws/docs/readme.md' },
            { kind: 'file', name: 'diagram.mmd', path: '/ws/docs/diagram.mmd' },
        ],
    },
    { kind: 'file', name: 'root.mmd', path: '/ws/root.mmd' },
]

describe('validateFileName', () => {
    it('rejects empty names', () => {
        expect(validateFileName('')).toBe('Name cannot be empty')
        expect(validateFileName('   ')).toBe('Name cannot be empty')
    })

    it('rejects invalid characters', () => {
        expect(validateFileName('bad<file>.mmd')).toBe('Name contains invalid characters')
        expect(validateFileName('file|name.mmd')).toBe('Name contains invalid characters')
    })

    it('rejects dot names and path separators', () => {
        expect(validateFileName('.')).toBe('Invalid name')
        expect(validateFileName('..')).toBe('Invalid name')
        expect(validateFileName('folder/file.mmd')).toBe('Name cannot contain path separators')
        expect(validateFileName('folder\\file.mmd')).toBe('Name cannot contain path separators')
    })

    it('accepts valid names', () => {
        expect(validateFileName('diagram.mmd')).toBeNull()
        expect(validateFileName('  notes.md  ')).toBeNull()
    })
})

describe('uniqueFileName', () => {
    it('returns the base name when unused', () => {
        expect(uniqueFileName('doc.mmd', new Set(['other.mmd']))).toBe('doc.mmd')
    })

    it('appends copy suffixes', () => {
        const existing = new Set(['doc.mmd', 'doc copy.mmd'])
        expect(uniqueFileName('doc.mmd', existing)).toBe('doc copy 2.mmd')
    })

    it('handles names without extension', () => {
        const existing = new Set(['README'])
        expect(uniqueFileName('README', existing)).toBe('README copy')
    })
})

describe('uniqueUntitledName', () => {
    it('returns untitled.mmd when free', () => {
        expect(uniqueUntitledName(new Set())).toBe('untitled.mmd')
    })

    it('increments untitled-N when taken', () => {
        const existing = new Set(['untitled.mmd', 'untitled-2.mmd'])
        expect(uniqueUntitledName(existing)).toBe('untitled-3.mmd')
    })
})

describe('collectFilePaths', () => {
    it('collects all file paths in the tree', () => {
        expect(collectFilePaths(sampleTree)).toEqual(new Set(['/ws/docs/readme.md', '/ws/docs/diagram.mmd', '/ws/root.mmd']))
    })
})

describe('collectFileNames', () => {
    it('collects all node names including directories', () => {
        expect(collectFileNames(sampleTree)).toEqual(new Set(['docs', 'readme.md', 'diagram.mmd', 'root.mmd']))
    })
})

describe('findNodeByPath', () => {
    it('finds files and directories by path', () => {
        expect(findNodeByPath(sampleTree, '/ws/root.mmd')?.name).toBe('root.mmd')
        expect(findNodeByPath(sampleTree, '/ws/docs')?.kind).toBe('directory')
    })

    it('returns null when path is missing', () => {
        expect(findNodeByPath(sampleTree, '/ws/missing.mmd')).toBeNull()
    })

    it('finds deeply nested files', () => {
        const nested: FileNode[] = [
            {
                kind: 'directory',
                name: 'projects',
                path: '/ws/projects',
                children: [{ kind: 'file', name: 'deep.mmd', path: '/ws/projects/deep.mmd' }],
            },
        ]
        expect(findNodeByPath(nested, '/ws/projects/deep.mmd')?.name).toBe('deep.mmd')
    })
})
