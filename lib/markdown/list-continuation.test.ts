import { describe, expect, it } from 'vitest'
import { listEnter } from '@/lib/markdown/list-continuation'

/** The document with | as the caret, after pressing Enter; or null when Enter is left to the editor. */
function enter(marked: string): string | null {
    const lines = marked.split('\n')
    const lineIndex = lines.findIndex((line) => line.includes('|'))
    const column = lines[lineIndex]!.indexOf('|')
    lines[lineIndex] = lines[lineIndex]!.replace('|', '')

    const edit = listEnter((index) => lines[index]!, lineIndex, column)
    if (!edit) return null
    const line = lines[lineIndex]!
    lines[lineIndex] = `${line.slice(0, edit.from)}${edit.text}|${line.slice(edit.to)}`
    return lines.join('\n')
}

describe('listEnter', () => {
    it('continues a bullet list with the same bullet and indent', () => {
        expect(enter('- one|')).toBe('- one\n- |')
        expect(enter('* one|')).toBe('* one\n* |')
        expect(enter('  + nested|')).toBe('  + nested\n  + |')
    })

    it('counts on in a numbered list, keeping its dot or bracket', () => {
        expect(enter('1. one|')).toBe('1. one\n2. |')
        expect(enter('9) nine|')).toBe('9) nine\n10) |')
    })

    it('starts a new unticked task after a task', () => {
        expect(enter('- [x] done|')).toBe('- [x] done\n- [ ] |')
        expect(enter('1. [ ] first|')).toBe('1. [ ] first\n2. [ ] |')
    })

    it('moves the text after the caret to the new item', () => {
        expect(enter('- one|two')).toBe('- one\n- |two')
    })

    it('ends the list on an empty item', () => {
        expect(enter('- one\n- |')).toBe('- one\n|')
        expect(enter('3. |')).toBe('|')
        expect(enter('- [ ] |')).toBe('|')
        expect(enter('  - [ ]|')).toBe('|')
    })

    it('leaves Enter alone away from a list item', () => {
        expect(enter('plain text|')).toBeNull()
        expect(enter('*emphasis*|')).toBeNull()
        expect(enter('- - -|')).toBeNull()
        expect(enter('-|')).toBeNull()
    })

    it('leaves Enter alone with the caret before the text of the item', () => {
        expect(enter('|- one')).toBeNull()
        expect(enter('-| one')).toBeNull()
    })

    it('leaves Enter alone inside a fenced code block', () => {
        expect(enter('```\n- not a list|\n```')).toBeNull()
        expect(enter('~~~~\n```\n- still code|')).toBeNull()
        expect(enter('```js\ncode\n```\n- a list again|')).toBe('```js\ncode\n```\n- a list again\n- |')
    })
})
