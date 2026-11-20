import { describe, expect, it } from 'vitest'
import { insideCodeBlock } from '@/lib/markdown/code-blocks'

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
})
