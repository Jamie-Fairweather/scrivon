import { describe, expect, it } from 'vitest'
import { countCharacters, countWords, lineEndingsOf } from './text-stats'

describe('countWords', () => {
    it('counts words split by spaces and line breaks', () => {
        expect(countWords('')).toBe(0)
        expect(countWords('   \n\t ')).toBe(0)
        expect(countWords('one')).toBe(1)
        expect(countWords('one two\nthree\r\n  four')).toBe(4)
    })

    it('keeps words with apostrophes, hyphens and Markdown marks around them whole', () => {
        expect(countWords("don't stop well-known")).toBe(3)
        expect(countWords('**bold** _soft_ `code` [link](https://example.com)')).toBe(4)
    })

    it('skips marks that are not words, such as headings, bullets and rules', () => {
        expect(countWords('# Title\n\n- item\n\n---\n\n> quote')).toBe(3)
    })

    it('counts numbers and accented letters as words', () => {
        expect(countWords('Café 42 naïve')).toBe(3)
    })

    it('counts each Chinese or Japanese character as a word, as word processors do', () => {
        expect(countWords('日本語の文章')).toBe(6)
        expect(countWords('Scrivonで書く')).toBe(4)
        // Korean puts spaces between words.
        expect(countWords('안녕하세요 세계')).toBe(2)
    })
})

describe('countCharacters', () => {
    it('counts every character, spaces included, but not line breaks', () => {
        expect(countCharacters('')).toBe(0)
        expect(countCharacters('a b')).toBe(3)
        expect(countCharacters('ab\ncd')).toBe(4)
        expect(countCharacters('ab\r\ncd\r')).toBe(4)
    })

    it('counts an emoji or other character outside the basic range once', () => {
        expect(countCharacters('a😀b')).toBe(3)
        expect(countCharacters('𠀋')).toBe(1)
    })
})

describe('lineEndingsOf', () => {
    it('names the line ending the text uses', () => {
        expect(lineEndingsOf('a\r\nb\r\n')).toBe('CRLF')
        expect(lineEndingsOf('a\nb\n')).toBe('LF')
    })

    it('says when the text mixes them', () => {
        expect(lineEndingsOf('a\r\nb\nc')).toBe('mixed')
        expect(lineEndingsOf('a\rb\nc')).toBe('mixed')
    })

    it('has no answer for text without a line break', () => {
        expect(lineEndingsOf('')).toBeNull()
        expect(lineEndingsOf('one line')).toBeNull()
    })
})
