import { describe, expect, it } from 'vitest'
import { insideCodeBlock, insideIndentedCode, isCodeFence } from '@/lib/markdown/code-blocks'

/** Whether the last line of `lines` is inside a code block. */
function lastLineInside(...lines: string[]): boolean {
    return insideCodeBlock((index) => lines[index] ?? '', lines.length - 1)
}

describe('insideCodeBlock', () => {
    it('is false with no fence above the line', () => {
        expect(lastLineInside('text', '| a | b |')).toBe(false)
        expect(lastLineInside('only line')).toBe(false)
    })

    it('finds ``` and ~~~ code blocks, and the line after one closes', () => {
        expect(lastLineInside('```', 'code')).toBe(true)
        expect(lastLineInside('~~~', 'code')).toBe(true)
        expect(lastLineInside('```js', 'code', '```', 'text')).toBe(false)
        expect(lastLineInside('~~~', 'code', '~~~', 'text')).toBe(false)
    })

    it('counts the fence line itself as outside, as nothing above it opens a block', () => {
        expect(lastLineInside('text', '```')).toBe(false)
    })

    it('finds indented fences, as in a list item', () => {
        expect(lastLineInside('- item', '  ```', '  code')).toBe(true)
        expect(lastLineInside('- item', '  ```', '  code', '  ```', '  text')).toBe(false)
    })

    it('is closed by a longer fence of the same kind, but not by a shorter one', () => {
        expect(lastLineInside('```', 'code', '`````', 'text')).toBe(false)
        expect(lastLineInside('````', 'code', '```', 'still code')).toBe(true)
    })

    it('is not closed by a fence of the other kind', () => {
        expect(lastLineInside('```', '~~~', 'still code')).toBe(true)
        expect(lastLineInside('~~~', '```', 'still code')).toBe(true)
    })

    it('is not closed by a fence with text after it', () => {
        expect(lastLineInside('```', '``` js', 'still code')).toBe(true)
    })

    it('runs to the end of the file when the fence is never closed', () => {
        expect(lastLineInside('```', 'a', 'b', 'c', 'd')).toBe(true)
    })

    it('treats ``` with another backtick after it as inline code, not a fence', () => {
        expect(lastLineInside('```inline` code', 'text')).toBe(false)
    })

    it('finds code blocks in a block quote, closed by a quoted fence', () => {
        expect(lastLineInside('> ```', '> code')).toBe(true)
        expect(lastLineInside('>```', '>code')).toBe(true)
        expect(lastLineInside('> ```', '> code', '> ```', '> text')).toBe(false)
        expect(lastLineInside('> > ~~~', '> > code', '> > ~~~', 'text')).toBe(false)
        expect(lastLineInside('Intro', '> ```js', '>', '> code')).toBe(true)
    })

    it('ends a quoted code block where its block quote ends', () => {
        expect(lastLineInside('> ```', '> code', '', 'text')).toBe(false)
        expect(lastLineInside('> > ```', '> > code', '> ```', '> text')).toBe(true)
        expect(lastLineInside('> > ```', '> > code', '> not code', 'text')).toBe(false)
    })

    it('leaves quote markers inside an unquoted code block as code', () => {
        // A Markdown example in a code block: its quoted fences don't close the block.
        expect(lastLineInside('```md', '> ```', '> code', '> ```', 'still code')).toBe(true)
    })
})

describe('isCodeFence', () => {
    it('knows a line that opens or closes a fenced code block', () => {
        expect(isCodeFence('```')).toBe(true)
        expect(isCodeFence('  ~~~ js')).toBe(true)
        expect(isCodeFence('```js | x')).toBe(true)
        expect(isCodeFence('```inline` code')).toBe(false)
        expect(isCodeFence('`` x')).toBe(false)
        expect(isCodeFence('text')).toBe(false)
    })
})

describe('insideIndentedCode', () => {
    /** Whether the last line of `lines` is in an indented code block. */
    const lastLineIndented = (...lines: string[]) => insideIndentedCode((index) => lines[index], lines.length - 1)

    it('is false for a line indented less than 4 columns', () => {
        expect(lastLineIndented('para', '', '   text')).toBe(false)
    })

    it('finds code indented 4 or more past the margin, after a blank line or at the start of the file', () => {
        expect(lastLineIndented('para', '', '    code')).toBe(true)
        expect(lastLineIndented('    code')).toBe(true)
        expect(lastLineIndented('para', '', '\tcode')).toBe(true)
        expect(lastLineIndented('  para', '', '    code')).toBe(true)
        expect(lastLineIndented('para', '', '    code', '    more code')).toBe(true)
    })

    it('is false for a paragraph’s continuation line, which has no blank line before it', () => {
        expect(lastLineIndented('para', '    more text')).toBe(false)
    })

    it('counts the indent from the text of the list item the line is in', () => {
        expect(lastLineIndented('- item', '', '    text')).toBe(false)
        expect(lastLineIndented('1. item', '', '   more', '', '    text')).toBe(false)
        expect(lastLineIndented('- a', '  - b', '', '      text')).toBe(false)
        expect(lastLineIndented('- item', '', '      code')).toBe(true)
        expect(lastLineIndented('- item', '', '  text', '', '      code')).toBe(true)
    })

    it('stops looking at a line back at the margin that isn’t a list item', () => {
        expect(lastLineIndented('- item', '', 'para', '', '    code')).toBe(true)
    })
})
