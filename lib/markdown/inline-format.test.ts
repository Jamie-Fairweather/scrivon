import { describe, expect, it } from 'vitest'
import { toggleInlineStyle, toggleLink, type FormatResult, type TextRange } from '@/lib/markdown/inline-format'

/**
 * Text with the selections marked: «…» is a selection, | a bare caret. Runs the change and gives the
 * text back the same way, so each case reads as before → after.
 */
function run(marked: string, change: (text: string, selections: TextRange[]) => FormatResult): string {
    const selections: TextRange[] = []
    let text = ''
    let start = -1
    for (const char of marked) {
        if (char === '«') start = text.length
        else if (char === '»') selections.push({ start, end: text.length })
        else if (char === '|') selections.push({ start: text.length, end: text.length })
        else text += char
    }

    const { edits, selections: after } = change(text, selections)
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end)
    }
    for (const range of [...after].sort((a, b) => b.start - a.start)) {
        text =
            range.start === range.end
                ? `${text.slice(0, range.start)}|${text.slice(range.start)}`
                : `${text.slice(0, range.start)}«${text.slice(range.start, range.end)}»${text.slice(range.end)}`
    }
    return text
}

const bold = (marked: string) => run(marked, (text, selections) => toggleInlineStyle(text, selections, 'bold'))
const italic = (marked: string) => run(marked, (text, selections) => toggleInlineStyle(text, selections, 'italic'))
const code = (marked: string) => run(marked, (text, selections) => toggleInlineStyle(text, selections, 'code'))
const link = (marked: string) => run(marked, toggleLink)

describe('toggleInlineStyle: bold', () => {
    it('wraps the selection and keeps it selected', () => {
        expect(bold('make «this» bold')).toBe('make **«this»** bold')
    })

    it('takes it off again, with the markers outside or inside the selection', () => {
        expect(bold('make **«this»** bold')).toBe('make «this» bold')
        expect(bold('make «**this**» bold')).toBe('make «this» bold')
        expect(bold('make «__this__» bold')).toBe('make «this» bold')
    })

    it('leaves italic markers alone', () => {
        expect(bold('*«this»*')).toBe('***«this»***')
        expect(bold('***«this»***')).toBe('*«this»*')
    })

    it('leaves spaces at the ends of the selection outside the markers', () => {
        expect(bold('make« this »bold')).toBe('make **«this»** bold')
    })

    it('works on the word around the caret, and keeps the caret in place', () => {
        expect(bold('make th|is bold')).toBe('make **th|is** bold')
        expect(bold('make **th|is** bold')).toBe('make th|is bold')
        expect(bold('make this| bold')).toBe('make **this|** bold')
    })

    it('puts the caret between new markers away from a word, and takes empty markers away again', () => {
        expect(bold('make | bold')).toBe('make **|** bold')
        expect(bold('make **|** bold')).toBe('make | bold')
    })

    it('formats every selection', () => {
        expect(bold('«one» and «two»')).toBe('**«one»** and **«two»**')
        expect(bold('**«one»** and «two»')).toBe('«one» and **«two»**')
    })

    it('formats a word only once when two carets are in it', () => {
        expect(bold('o|n|e')).toBe('**o|ne**')
    })
})

describe('toggleInlineStyle: italic', () => {
    it('wraps the selection with one star and takes it off again', () => {
        expect(italic('an «idea»')).toBe('an *«idea»*')
        expect(italic('an *«idea»*')).toBe('an «idea»')
        expect(italic('an «_idea_»')).toBe('an «idea»')
        expect(italic('an _«idea»_')).toBe('an «idea»')
    })

    it('adds to bold text, and takes only its own star off bold italic text', () => {
        expect(italic('**«idea»**')).toBe('***«idea»***')
        expect(italic('***«idea»***')).toBe('**«idea»**')
    })

    it('does not mistake a list bullet for a marker', () => {
        expect(italic('* «item»')).toBe('* *«item»*')
    })
})

describe('toggleInlineStyle: code', () => {
    it('wraps the selection in backticks and takes them off again', () => {
        expect(code('run «npm test» now')).toBe('run `«npm test»` now')
        expect(code('run `«npm test»` now')).toBe('run «npm test» now')
        expect(code('run «`npm test`» now')).toBe('run «npm test» now')
    })

    it('uses more backticks when the code has some in it', () => {
        expect(code('«a`b»')).toBe('``«a`b»``')
        expect(code('«`a»')).toBe('`` «`a» ``')
        expect(code('`` «`a» ``')).toBe('«`a»')
    })

    it('puts the caret between new backticks away from a word', () => {
        expect(code('see | here')).toBe('see `|` here')
    })
})

describe('toggleLink', () => {
    it('makes the selection the text of a link and puts the caret where the address goes', () => {
        expect(link('see «the docs» here')).toBe('see [the docs](|) here')
    })

    it('makes a selected web address the address, with the caret in the text', () => {
        expect(link('see «https://example.com» here')).toBe('see [|](https://example.com) here')
    })

    it('uses the word around the caret, or adds an empty link away from a word', () => {
        expect(link('see do|cs')).toBe('see [docs](|)')
        expect(link('see | here')).toBe('see [|]() here')
    })

    it('takes a link off when the selection or caret is in it, keeping its text', () => {
        expect(link('see [the «docs»](https://x.dev) here')).toBe('see «the docs» here')
        expect(link('see [the docs](https://x|.dev) here')).toBe('see «the docs» here')
    })

    it('leaves images alone', () => {
        expect(link('![a «cat»](cat.png)')).toBe('![a [cat](|)](cat.png)')
    })
})
