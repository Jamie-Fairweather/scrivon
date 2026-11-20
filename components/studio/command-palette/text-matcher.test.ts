import { describe, expect, it } from 'vitest'
import {
    compileTextQuery,
    matchLine,
    matchText,
    PLAIN_SEARCH_OPTIONS,
    REGEX_MAX_LINE_LENGTH,
    type CompileTextQueryOptions,
    type TextMatcher,
    type WordSegmenter,
    type WorkspaceSearchOptions,
} from '@/components/studio/command-palette/text-matcher'

function matcher(query: string, options: Partial<WorkspaceSearchOptions> = {}, compileOptions?: CompileTextQueryOptions): TextMatcher {
    const compiled = compileTextQuery(query, { ...PLAIN_SEARCH_OPTIONS, ...options }, compileOptions)
    if (!compiled.ok) throw new Error(compiled.error)
    return compiled.matcher
}

/** The matched text of each match, read from the original line by its span. */
function found(line: string, query: string, options: Partial<WorkspaceSearchOptions> = {}, compileOptions?: CompileTextQueryOptions): string[] {
    return matchLine(line, matcher(query, options, compileOptions)).map(({ start, length }) => line.slice(start, start + length))
}

/** A segmenter that splits on the given words, as a dictionary would, for cases that depend on dictionary data. */
function dictionarySegmenter(words: string[]): WordSegmenter {
    return {
        segment(input: string) {
            const segments: Array<{ segment: string; index: number }> = []
            let index = 0
            while (index < input.length) {
                const word = words.find((w) => input.startsWith(w, index)) ?? input[index]!
                segments.push({ segment: word, index })
                index += word.length
            }
            return segments
        },
    }
}

describe('plain search', () => {
    it('ignores case and composes accents, as before', () => {
        expect(found('README and readme', 'Readme')).toEqual(['README', 'readme'])
        expect(found('x café y', 'café')).toEqual(['café'])
    })

    it('finds Turkish İ and a final sigma as before', () => {
        expect(found('İzmir', 'izmir')).toEqual(['İzmir'])
        expect(found('ΟΔΟΣ', 'οδος')).toEqual(['ΟΔΟΣ'])
    })

    it('finds nothing for an empty query', () => {
        expect(found('abc', '')).toEqual([])
    })
})

describe('Match Case', () => {
    it('only finds the case typed', () => {
        expect(found('readme Readme README', 'Readme', { matchCase: true })).toEqual(['Readme'])
    })

    it('still matches composed and decomposed accents', () => {
        expect(found('x Café y', 'Café', { matchCase: true })).toEqual(['Café'])
        expect(found('x Café y', 'Café', { matchCase: true })).toEqual(['Café'])
        expect(found('x café y', 'Café', { matchCase: true })).toEqual([])
    })

    it('maps columns back to the decomposed original', () => {
        const line = 'éé Café'
        expect(matchLine(line, matcher('Café', { matchCase: true }))).toEqual([{ start: 5, length: 4 }])
    })
})

describe('Match Whole Word', () => {
    it('finds whole words only', () => {
        expect(found('the cat.', 'cat', { wholeWord: true })).toEqual(['cat'])
        expect(found('cat-flap', 'cat', { wholeWord: true })).toEqual(['cat'])
        expect(found('cats', 'cat', { wholeWord: true })).toEqual([])
        expect(found('concatenate', 'cat', { wholeWord: true })).toEqual([])
    })

    it('treats accented letters, Cyrillic and Greek as parts of words', () => {
        expect(found('cafés', 'café', { wholeWord: true })).toEqual([])
        expect(found('cafés', 'café', { wholeWord: true })).toEqual([])
        expect(found('un café.', 'café', { wholeWord: true })).toEqual(['café'])
        expect(found('кошка кот', 'кот', { wholeWord: true })).toEqual(['кот'])
        expect(found('котёнок', 'кот', { wholeWord: true })).toEqual([])
        expect(found('λόγος λόγοι', 'λόγος', { wholeWord: true })).toEqual(['λόγος'])
    })

    it('goes on from the next character after a match that is not a whole word', () => {
        expect(found('aaa aa', 'aa', { wholeWord: true })).toEqual(['aa'])
        expect(matchLine('aaa aa', matcher('aa', { wholeWord: true }))).toEqual([{ start: 4, length: 2 }])
        // The whole word starts inside the failed match, so jumping past that match would miss it.
        expect(matchLine('ba a a', matcher('a a', { wholeWord: true }))).toEqual([{ start: 3, length: 3 }])
    })

    it('finds a Japanese word with no spaces around it where the script changes', () => {
        // Han then Hiragana: a boundary that needs no dictionary data.
        expect(found('猫が好き', '猫', { wholeWord: true })).toEqual(['猫'])
    })

    it('uses the segmenter given for Chinese and Japanese words', () => {
        const segmenter = dictionarySegmenter(['我们', '喜欢', '猫'])
        expect(found('我们喜欢猫', '喜欢', { wholeWord: true }, { segmenter })).toEqual(['喜欢'])
        expect(found('我们喜欢猫', '们喜', { wholeWord: true }, { segmenter })).toEqual([])
    })

    it('ignores case with Match Case off', () => {
        expect(found('The CAT sat', 'cat', { wholeWord: true })).toEqual(['CAT'])
    })

    describe('without Intl.Segmenter', () => {
        const fallback = { segmenter: null }

        it('counts letters, marks, numbers and underscores as word characters', () => {
            expect(found('the cat.', 'cat', { wholeWord: true }, fallback)).toEqual(['cat'])
            expect(found('cat-flap', 'cat', { wholeWord: true }, fallback)).toEqual(['cat'])
            expect(found('cats cat_x cat2', 'cat', { wholeWord: true }, fallback)).toEqual([])
            expect(found('cafés', 'café', { wholeWord: true }, fallback)).toEqual([])
            expect(found('кот, кошка', 'кот', { wholeWord: true }, fallback)).toEqual(['кот'])
        })

        it('counts each Han, Hiragana or Katakana character as a word', () => {
            expect(found('我们喜欢猫', '猫', { wholeWord: true }, fallback)).toEqual(['猫'])
            expect(found('ネコが好き', 'ネコ', { wholeWord: true }, fallback)).toEqual(['ネコ'])
        })

        it('keeps Korean words whole, as Korean puts spaces between words', () => {
            expect(found('고양이가 좋아', '고양이', { wholeWord: true }, fallback)).toEqual([])
            expect(found('고양이 좋아', '고양이', { wholeWord: true }, fallback)).toEqual(['고양이'])
        })

        it('never puts a boundary inside an emoji', () => {
            expect(found('a\u{1F600}b', '\u{1F600}', { wholeWord: true }, fallback)).toEqual(['\u{1F600}'])
        })
    })
})

describe('Use Regular Expression', () => {
    it('compiles with the u flag, plus i when Match Case is off', () => {
        expect(matcher('a', { useRegex: true }).regex?.flags).toBe('giu')
        expect(matcher('a', { useRegex: true, matchCase: true }).regex?.flags).toBe('gu')
    })

    it('supports Unicode properties, lookbehind and ^ and $ on each line', () => {
        expect(found('hello World Ünd', '\\p{Lu}\\p{Ll}+', { useRegex: true, matchCase: true })).toEqual(['World', 'Ünd'])
        expect(found('price $5 and €7', '(?<=\\$)\\d', { useRegex: true })).toEqual(['5'])
        expect(found('foo bar foo', '^foo', { useRegex: true })).toEqual(['foo'])
        expect(matchLine('foo bar foo', matcher('foo$', { useRegex: true }))).toEqual([{ start: 8, length: 3 }])
    })

    it('matches $ before the \\r of a CRLF line', () => {
        expect(found('foo\r', 'foo$', { useRegex: true })).toEqual(['foo'])
        expect(matchText('a foo\r\nfoo\r\n', matcher('foo$', { useRegex: true })).matches).toEqual([
            { lineIndex: 0, start: 2, length: 3 },
            { lineIndex: 1, start: 0, length: 3 },
        ])
    })

    it('finds decomposed text with a composed pattern', () => {
        expect(found('x café y', 'café', { useRegex: true })).toEqual(['café'])
        expect(matchLine('x café y', matcher('café', { useRegex: true }))).toEqual([{ start: 2, length: 5 }])
    })

    it("uses JavaScript's own case folding, so i doesn't find Turkish İ", () => {
        expect(found('İzmir', 'izmir', { useRegex: true })).toEqual([])
        // The plain search does.
        expect(found('İzmir', 'izmir')).toEqual(['İzmir'])
    })

    it('never reports empty matches, and always ends', () => {
        expect(matchLine('abc', matcher('^', { useRegex: true }))).toEqual([])
        expect(matchLine('abc', matcher('x*', { useRegex: true }))).toEqual([])
        expect(found('axxb', 'x*', { useRegex: true })).toEqual(['xx'])
        expect(matchLine('\u{1F600}\u{1F600}', matcher('(?:)', { useRegex: true }))).toEqual([])
        expect(matchLine('', matcher('$', { useRegex: true }))).toEqual([])
    })

    it('keeps spaces in the pattern', () => {
        expect(found('a  b', ' +', { useRegex: true })).toEqual(['  '])
        expect(found('x  ', ' +$', { useRegex: true })).toEqual(['  '])
        expect(found('foo bar', 'foo[ ]', { useRegex: true })).toEqual(['foo '])
    })

    it("reads an escaped space as the u flag does: an invalid escape, not a cut-off '\\' at the end", () => {
        // With the u flag only syntax characters may be escaped, so 'foo\ ' is invalid however it is read.
        // Kept untrimmed, the message is about the escape rather than a lone backslash.
        expect(compileTextQuery('foo\\ ', { ...PLAIN_SEARCH_OPTIONS, useRegex: true })).toEqual({
            ok: false,
            error: 'Invalid regular expression: Invalid escape',
        })
    })

    it('checks word boundaries on each regex match with Match Whole Word', () => {
        expect(found('cat cats concatenate', 'cat\\w*', { useRegex: true, wholeWord: true })).toEqual(['cat', 'cats'])
        expect(found('cats cat', 'cat', { useRegex: true, wholeWord: true })).toEqual(['cat'])
        expect(found('aaa aa', 'aa', { useRegex: true, wholeWord: true })).toEqual(['aa'])
        expect(matchLine('ba a a', matcher('a a', { useRegex: true, wholeWord: true }))).toEqual([{ start: 3, length: 3 }])
    })

    it('gives the error for an invalid pattern, without the /pattern/flags part', () => {
        expect(compileTextQuery('(', { ...PLAIN_SEARCH_OPTIONS, useRegex: true })).toEqual({
            ok: false,
            error: 'Invalid regular expression: Unterminated group',
        })
        // Escaping something that isn't regex syntax is an error with the u flag.
        expect(compileTextQuery('a\\-b', { ...PLAIN_SEARCH_OPTIONS, useRegex: true }).ok).toBe(false)
    })

    it('reads an invalid pattern as text when regex is off', () => {
        expect(found('f(x', '(')).toEqual(['('])
    })

    it('can share one matcher across lines and calls', () => {
        const m = matcher('o', { useRegex: true })
        expect(matchLine('foo', m)).toHaveLength(2)
        expect(matchLine('o', m)).toHaveLength(1)
    })
})

describe('matchText', () => {
    it('stops at the limit', () => {
        expect(matchText('aaa\naaa', matcher('a'), 4).matches).toHaveLength(4)
    })

    it('has no limit when none is given', () => {
        expect(matchText('a'.repeat(5000), matcher('a')).matches).toHaveLength(5000)
    })

    it('skips and counts long lines in regex mode only', () => {
        const long = 'a'.repeat(REGEX_MAX_LINE_LENGTH + 1)
        const text = `a\n${long}\n${'a'.repeat(REGEX_MAX_LINE_LENGTH)}`
        const regex = matchText(text, matcher('a+', { useRegex: true }))
        expect(regex.longLinesSkipped).toBe(1)
        expect(regex.matches.map((m) => m.lineIndex)).toEqual([0, 2])

        const plain = matchText(text, matcher('aaaa'), 1_000_000)
        expect(plain.longLinesSkipped).toBe(0)
        expect(plain.matches.some((m) => m.lineIndex === 1)).toBe(true)
    })
})
