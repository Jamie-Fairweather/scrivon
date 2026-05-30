import { describe, expect, it } from 'vitest'
import { getBaseName, getParentPath, joinPath } from './fs'

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
