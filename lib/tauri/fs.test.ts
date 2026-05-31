import { describe, expect, it } from 'vitest'
import { compareFileNodes, getBaseName, getParentPath, joinPath } from './fs'
import type { FileNode } from '@/lib/workspace/types'

function node(name: string, kind: FileNode['kind']): FileNode {
    return kind === 'directory' ? { kind, name, path: `/ws/${name}`, children: [] } : { kind, name, path: `/ws/${name}` }
}

describe('compareFileNodes', () => {
    it('sorts directories before files', () => {
        expect(compareFileNodes(node('docs', 'directory'), node('a.mmd', 'file'))).toBeLessThan(0)
        expect(compareFileNodes(node('a.mmd', 'file'), node('docs', 'directory'))).toBeGreaterThan(0)
    })

    it('sorts same-kind nodes by name', () => {
        expect(compareFileNodes(node('b.mmd', 'file'), node('a.mmd', 'file'))).toBeGreaterThan(0)
    })
})

describe('joinPath', () => {
    it('uses forward slashes for POSIX paths', () => {
        expect(joinPath('/home/user/project', 'diagram.mmd')).toBe('/home/user/project/diagram.mmd')
    })

    it('uses backslashes for Windows paths', () => {
        expect(joinPath('C:\\Users\\jamie\\project', 'diagram.mmd')).toBe('C:\\Users\\jamie\\project\\diagram.mmd')
    })

    it('strips trailing separators from the parent', () => {
        expect(joinPath('/home/user/project/', 'diagram.mmd')).toBe('/home/user/project/diagram.mmd')
    })
})

describe('getBaseName', () => {
    it('returns the final path segment', () => {
        expect(getBaseName('/home/user/diagram.mmd')).toBe('diagram.mmd')
        expect(getBaseName('C:\\Users\\jamie\\diagram.mmd')).toBe('diagram.mmd')
    })
})

describe('getParentPath', () => {
    it('returns the parent directory', () => {
        expect(getParentPath('/home/user/diagram.mmd')).toBe('/home/user')
        expect(getParentPath('C:\\Users\\jamie\\diagram.mmd')).toBe('C:\\Users\\jamie')
    })
})
