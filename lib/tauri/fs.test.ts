import { describe, expect, it } from 'vitest'
import { compareFileNodes, getBaseName, getParentPath, isPathInside, joinPath, normalizePath, pathInside, samePath } from './fs'
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

describe('Windows path handling', () => {
    const root = 'C:\\Users\\jamie\\proj'

    it('normalizes mixed separators to one form', () => {
        expect(normalizePath('C:\\Users\\jamie\\proj/sub/a.mmd')).toBe('C:\\Users\\jamie\\proj\\sub\\a.mmd')
        expect(normalizePath('C:/Users/jamie/proj/')).toBe('C:\\Users\\jamie\\proj')
        expect(normalizePath('C:\\')).toBe('C:\\')
        expect(normalizePath('C:/')).toBe('C:\\')
        expect(normalizePath('\\\\server\\share/notes\\')).toBe('\\\\server\\share\\notes')
        expect(normalizePath('/home/user//project/')).toBe('/home/user/project')
        expect(normalizePath('/')).toBe('/')
    })

    it('joins tree-style and explorer-style paths to the same string', () => {
        expect(joinPath(root, 'flow.mmd')).toBe('C:\\Users\\jamie\\proj\\flow.mmd')
        expect(joinPath(`${root}/sub`, 'a.mmd')).toBe('C:\\Users\\jamie\\proj\\sub\\a.mmd')
        expect(joinPath('C:\\', 'a.mmd')).toBe('C:\\a.mmd')
        expect(joinPath('/', 'a.mmd')).toBe('/a.mmd')
    })

    it('returns the parent with the same separators', () => {
        expect(getParentPath(`${root}/sub/a.mmd`)).toBe('C:\\Users\\jamie\\proj\\sub')
        expect(getParentPath('C:\\a.mmd')).toBe('C:\\')
        expect(getParentPath('/a.mmd')).toBe('/')
        expect(getParentPath('a.mmd')).toBe('')
    })

    it('compares paths ignoring separators, and case on Windows', () => {
        expect(samePath(`${root}/flow.mmd`, `${root}\\flow.mmd`)).toBe(true)
        expect(samePath('C:\\Users\\Jamie\\Proj\\Flow.mmd', `${root}\\flow.mmd`)).toBe(true)
        expect(samePath('/ws/Flow.mmd', '/ws/flow.mmd')).toBe(false)
        expect(samePath('/ws/a.mmd', '/ws/a.mmd/')).toBe(true)
    })

    it('finds paths inside a folder whatever the separators', () => {
        expect(pathInside(`${root}/sub/a.mmd`, `${root}\\sub`)).toBe('a.mmd')
        expect(pathInside(`${root}\\SUB\\deep\\a.mmd`, `${root}/sub`)).toBe('deep\\a.mmd')
        expect(pathInside(`${root}\\subway\\a.mmd`, `${root}\\sub`)).toBeNull()
        expect(pathInside(`${root}\\sub`, `${root}\\sub`)).toBeNull()
        expect(pathInside('C:\\a.mmd', 'C:\\')).toBe('a.mmd')
        expect(pathInside('/ws/docs/a.md', '/ws/docs')).toBe('a.md')
        expect(isPathInside('/ws/docs2/a.md', '/ws/docs')).toBe(false)
    })
})
