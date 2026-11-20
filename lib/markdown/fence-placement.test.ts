import { describe, expect, it } from 'vitest'
import { placeFencedBlock } from '@/lib/markdown/fence-placement'

const BLOCK = ['```mermaid', 'flowchart TD', '```']

/** The file with BLOCK placed for a caret on `caretLine`, or null when it can't go there. */
function withBlock(lines: string[], caretLine: number): string[] | null {
    const placement = placeFencedBlock((index) => lines[index] ?? '', lines.length, caretLine)
    if (!placement) return null
    const { line, replaceLine, breaksBefore, breaksAfter } = placement
    const before = lines.slice(0, replaceLine ? line : line + 1)
    const after = lines.slice(line + 1)
    const inserted = [...BLOCK]
    // Line breaks before the block that follow a line kept whole only end that line.
    const blanksBefore = replaceLine ? breaksBefore : breaksBefore - 1
    return [...before, ...Array<string>(blanksBefore).fill(''), ...inserted, ...Array<string>(breaksAfter).fill(''), ...after]
}

describe('placeFencedBlock', () => {
    it('goes after the line when the caret is mid-line, with a blank line either side', () => {
        expect(withBlock(['Intro text here', 'Next paragraph'], 0)).toEqual(['Intro text here', '', ...BLOCK, '', 'Next paragraph'])
    })

    it('takes the place of a blank caret line, adding no second blank line', () => {
        expect(withBlock(['Intro', '', '', 'Next'], 1)).toEqual(['Intro', '', ...BLOCK, '', 'Next'])
        expect(withBlock(['Intro', '', 'Next'], 1)).toEqual(['Intro', '', ...BLOCK, '', 'Next'])
    })

    it('keeps the blank line already after the caret line', () => {
        expect(withBlock(['Intro', '', 'Next'], 0)).toEqual(['Intro', '', ...BLOCK, '', 'Next'])
    })

    it('adds no blank line at the start or the end of the file', () => {
        expect(withBlock([''], 0)).toEqual(BLOCK)
        expect(withBlock(['', 'Next'], 0)).toEqual([...BLOCK, '', 'Next'])
        expect(withBlock(['Intro', 'Last line'], 1)).toEqual(['Intro', 'Last line', '', ...BLOCK])
        expect(withBlock(['Intro', ''], 1)).toEqual(['Intro', '', ...BLOCK])
    })

    it('counts a line of spaces as blank', () => {
        expect(withBlock(['Intro', '   ', 'Next'], 1)).toEqual(['Intro', '', ...BLOCK, '', 'Next'])
    })

    it('is null inside a ``` or ~~~ code block, on its opening fence, and on its last line', () => {
        const file = ['Intro', '```js', 'code', '', '```', 'After', '~~~', 'more']
        expect(withBlock(file, 1)).toBeNull()
        expect(withBlock(file, 2)).toBeNull()
        expect(withBlock(file, 3)).toBeNull()
        expect(withBlock(file, 7)).toBeNull()
    })

    it('goes after the fence that closes a code block', () => {
        expect(withBlock(['```', 'code', '```', 'After'], 2)).toEqual(['```', 'code', '```', '', ...BLOCK, '', 'After'])
    })
})
