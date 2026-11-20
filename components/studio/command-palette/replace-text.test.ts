import { describe, expect, it } from 'vitest'
import {
    applyReplacements,
    canMatchEmptyText,
    findReplacements,
    replacementEdits,
    replacementSignature,
} from '@/components/studio/command-palette/replace-text'
import {
    compileTextQuery,
    PLAIN_SEARCH_OPTIONS,
    REGEX_MAX_LINE_LENGTH,
    type TextMatcher,
    type WorkspaceSearchOptions,
} from '@/components/studio/command-palette/text-matcher'
import { applyTextEdits } from '@/lib/workspace/text-edits'

function matcher(query: string, options: Partial<WorkspaceSearchOptions> = {}): TextMatcher {
    const compiled = compileTextQuery(query, { ...PLAIN_SEARCH_OPTIONS, ...options })
    if (!compiled.ok) throw new Error(compiled.error)
    return compiled.matcher
}

/** The text with every match of `query` replaced, as Replace All would leave it. */
function replaceAll(text: string, query: string, replacement: string, options: Partial<WorkspaceSearchOptions> = {}): string {
    return applyReplacements(text, findReplacements(text, matcher(query, options), replacement).replacements)
}

const regex = { useRegex: true }

describe('findReplacements, plain text', () => {
    it('puts the replacement in literally, so $1 and $& stay as typed', () => {
        expect(replaceAll('a cat, a Cat', 'cat', '$1 $& $$')).toBe('a $1 $& $$, a $1 $& $$')
    })

    it('finds what the search finds: case folded unless Match Case is on, and only whole words with Match Whole Word', () => {
        expect(replaceAll('Cat cat catalog', 'cat', 'dog')).toBe('dog dog dogalog')
        expect(replaceAll('Cat cat catalog', 'cat', 'dog', { matchCase: true })).toBe('Cat dog dogalog')
        expect(replaceAll('Cat cat catalog', 'cat', 'dog', { wholeWord: true })).toBe('dog dog catalog')
    })

    it('says where each match is, what it was and what it becomes', () => {
        const { replacements } = findReplacements('one\ntwo one', matcher('one'), '1')
        expect(replacements).toEqual([
            { lineIndex: 0, start: 0, length: 3, oldText: 'one', newText: '1' },
            { lineIndex: 1, start: 4, length: 3, oldText: 'one', newText: '1' },
        ])
    })

    it('stops at the limit', () => {
        expect(findReplacements('a a a a', matcher('a'), 'b', 2).replacements).toHaveLength(2)
    })

    it('replaces an accented word stored decomposed, keeping the rest of the line as it is', () => {
        const decomposed = 'café au lait'
        expect(replaceAll(decomposed, 'café', 'tea')).toBe('tea au lait')
    })
})

describe('findReplacements, regular expressions', () => {
    it('fills in $1, $<name>, $& and $$', () => {
        expect(replaceAll('John Smith', '(\\w+) (\\w+)', '$2, $1', regex)).toBe('Smith, John')
        expect(replaceAll('2026-11-20', '(?<y>\\d+)-(?<m>\\d+)-(?<d>\\d+)', '$<d>/$<m>/$<y>', regex)).toBe('20/11/2026')
        expect(replaceAll('cost 5', '\\d', '[$&] $$', regex)).toBe('cost [5] $')
    })

    it("fills in $` and $' from the line around the match", () => {
        expect(replaceAll('ab-cd', '-', "[$`|$']", regex)).toBe('ab[ab|cd]cd')
    })

    it('leaves $ followed by anything else, or a group that does not exist, as typed', () => {
        expect(replaceAll('ab', '(a)', '$2 $0 $x $<n>', regex)).toBe('$2 $0 $x $<n>b')
        // Two digits when there are that many groups, one when there are not.
        expect(replaceAll('ab', '(a)', '$10', regex)).toBe('a0b')
    })

    it('gives a group that took no part, or a missing named group, as nothing', () => {
        expect(replaceAll('b', '(a)?b', '[$1]', regex)).toBe('[]')
        expect(replaceAll('b', '(?<x>a)?b', '[$<x>$<nope>]', regex)).toBe('[]')
    })

    it('reads groups from the file as it is, not as it was folded for matching', () => {
        const decomposed = 'Café!'
        expect(replaceAll(decomposed, '(caf.)!', '<$1>', regex)).toBe('<Café>')
    })

    it('never replaces an empty match, so ^ and x* cannot loop or add text twice', () => {
        expect(replaceAll('abc\ndef', '^', '> ', regex)).toBe('abc\ndef')
        expect(replaceAll('axxb', 'x*', '-', regex)).toBe('a-b')
        expect(replaceAll('', '.*', 'x', regex)).toBe('')
    })

    it('replaces a character that normalises to two code points once, never twice', () => {
        // U+095B (a precomposed Devanagari letter) is U+091C U+093C once normalised: two matches of [ऀ-ॿ] there,
        // which both map back to the one character in the file.
        const text = 'aज़b'
        const { replacements } = findReplacements(text, matcher('[ऀ-ॿ]', regex), 'X')
        expect(replacements).toEqual([{ lineIndex: 0, start: 1, length: 1, oldText: 'ज़', newText: 'X' }])
        expect(applyReplacements(text, replacements)).toBe('aXb')
        // A base letter with two marks, stored decomposed, is one character for '.' (it was 'YYYY').
        expect(replaceAll('é̂ x', '.', 'Y', regex)).toBe('YYY')
        // Editor edits for it never overlap, which Monaco would refuse.
        expect(applyTextEdits(text, replacementEdits(text, replacements))).toBe('aXb')
    })

    it('never gives two matches for one folded character in plain text either', () => {
        // An 'e' with three acute accents, stored decomposed, is 'é' and two accents once composed: two matches of
        // the accent, which both map back to the one character in the file.
        const text = 'xé́́y'
        const { replacements } = findReplacements(text, matcher('́'), '_')
        expect(replacements).toEqual([{ lineIndex: 0, start: 1, length: 4, oldText: 'é́́', newText: '_' }])
        expect(applyReplacements(text, replacements)).toBe('x_y')
    })

    it('knows a pattern that can match empty text, so the palette can say why it replaces nothing', () => {
        expect(canMatchEmptyText(matcher('^', regex))).toBe(true)
        expect(canMatchEmptyText(matcher('x*', regex))).toBe(true)
        expect(canMatchEmptyText(matcher('$', regex))).toBe(true)
        expect(canMatchEmptyText(matcher('^x', regex))).toBe(false)
        expect(canMatchEmptyText(matcher('x+', regex))).toBe(false)
        // Plain text '^' is the character itself.
        expect(canMatchEmptyText(matcher('^'))).toBe(false)
    })

    it('leaves lines longer than the regex limit alone, and counts them', () => {
        const long = 'a'.repeat(REGEX_MAX_LINE_LENGTH + 1)
        const result = findReplacements(`a\n${long}\na`, matcher('a', regex), 'b')
        expect(result.longLinesSkipped).toBe(1)
        expect(applyReplacements(`a\n${long}\na`, result.replacements)).toBe(`b\n${long}\nb`)
    })
})

describe('findReplacements, line endings', () => {
    it('matches $ before the \\r of a CRLF file and keeps every \\r\\n', () => {
        expect(replaceAll('one\r\ntwo\r\n', '$', '!', regex)).toBe('one\r\ntwo\r\n')
        expect(replaceAll('one\r\ntwo\r\n', '(\\w+)$', '$1!', regex)).toBe('one!\r\ntwo!\r\n')
        expect(replaceAll('a b\r\nb a\r\n', '\\s+', '_', regex)).toBe('a_b\r\nb_a\r\n')
    })

    it('never removes a lone \\r inside a line, which the editor counts as a line break', () => {
        expect(replaceAll('a\rb', 'a\\sb', 'x', regex)).toBe('a\rb')
    })

    it('never adds a line break', () => {
        expect(findReplacements('a', matcher('a'), 'b\nc').replacements).toEqual([])
        expect(findReplacements('a', matcher('a'), 'b\r').replacements).toEqual([])
    })
})

describe('replacementEdits', () => {
    it('gives editor edits that leave a tab with the same text as applyReplacements', () => {
        const text = 'one\r\ntwo one\r\nthree\rone'
        const { replacements } = findReplacements(text, matcher('one'), 'ONE!')
        const edits = replacementEdits(text, replacements)
        expect(edits).toHaveLength(3)
        expect(applyTextEdits(text, edits)).toBe(applyReplacements(text, replacements))
        expect(applyTextEdits(text, edits)).toBe('ONE!\r\ntwo ONE!\r\nthree\rONE!')
    })
})

describe('replacementSignature', () => {
    it('changes when a match moves or its result changes, and not otherwise', () => {
        const sign = (text: string, replacement = 'x') =>
            replacementSignature(findReplacements(text, matcher('(a)', regex), replacement).replacements)
        expect(sign('a b a')).toBe(sign('a b a'))
        expect(sign('a b a')).not.toBe(sign('a  b a'))
        expect(sign('a b a')).not.toBe(sign('a b a', '$1$1'))
    })
})
