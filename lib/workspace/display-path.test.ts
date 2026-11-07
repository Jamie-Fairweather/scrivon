import { describe, expect, it } from 'vitest'
import { displayPath } from './display-path'

const LRM = '\u200E'

describe('displayPath', () => {
    it('puts a left-to-right mark at the start, after each separator and at the end of a path with Hebrew folders', () => {
        expect(displayPath('C:\\Users\\Dana\\מסמכים\\פרויקט')).toBe(`${LRM}C:\\${LRM}Users\\${LRM}Dana\\${LRM}מסמכים\\${LRM}פרויקט${LRM}`)
    })

    it('handles forward slashes and Arabic names the same way', () => {
        expect(displayPath('docs/مستندات/مشروع.md')).toBe(`${LRM}docs/${LRM}مستندات/${LRM}مشروع.md${LRM}`)
    })

    it('keeps the folders in order once the marks are taken out again', () => {
        const path = 'D:\\ספרים\\עבודה\\notes.md'
        expect(displayPath(path).replaceAll(LRM, '')).toBe(path)
    })

    it('leaves paths with no right-to-left letters as they are', () => {
        for (const path of ['C:\\Users\\jamie\\notes', '/home/jamie/docs/readme.md', 'D:\\', 'Ünïcödé\\日本語\\😀', '']) {
            expect(displayPath(path)).toBe(path)
        }
    })
})
