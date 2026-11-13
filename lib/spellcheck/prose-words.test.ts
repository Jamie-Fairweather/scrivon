import { describe, expect, it } from 'vitest'
import { createProseWordFinder, findProseWords } from './prose-words'

/** The words found, as text, so a test reads like the document. */
function words(markdown: string): string[] {
    return findProseWords(markdown).map((found) => found.word)
}

describe('findProseWords', () => {
    it('finds the words of ordinary prose, with where each one starts in the text', () => {
        const text = '# A tilte\n\nSome txet here.'
        expect(findProseWords(text)).toEqual([
            { word: 'tilte', offset: 4 },
            { word: 'Some', offset: 11 },
            { word: 'txet', offset: 16 },
            { word: 'here', offset: 21 },
        ])
    })

    it('skips code blocks, Mermaid diagrams, inline code and indented code', () => {
        const text = [
            'Before `inlne cde` after.',
            '',
            '```js',
            'const valeu = 1',
            '```',
            '',
            '```mermaid',
            'flowchart LR',
            '  Strat --> Ende',
            '```',
            '',
            '    indnted code',
            '',
            'End.',
        ].join('\n')
        expect(words(text)).toEqual(['Before', 'after', 'End'])
    })

    it('checks link text, but not the address, autolinks, bare web addresses or emails', () => {
        const text = 'See [the linkk](https://exmple.com/pathh) and <https://autolnk.com>, www.barre.com or me@mial.com. ![An imgae](pic.png)'
        expect(words(text)).toEqual(['See', 'the', 'linkk', 'and', 'or'])
    })

    it('skips front matter and raw HTML, but checks the text between HTML tags', () => {
        const text = '---\ntitel: My Documnt\n---\n\nHello <span clas="x">wrold</span>.\n\n<!-- a commnt -->\n'
        expect(words(text)).toEqual(['Hello', 'wrold'])
    })

    it('keeps offsets right after front matter and escaped characters', () => {
        const text = '---\ntitle: x\n---\nOne \\*twoo\\* thre &amp; four'
        const found = findProseWords(text)
        for (const { word, offset } of found) expect(text.slice(offset, offset + word.length)).toBe(word)
        expect(found.map((f) => f.word)).toEqual(['One', 'twoo', 'thre', 'four'])
    })

    it('keeps apostrophes inside words, and skips file names, paths, code names and words joined to numbers', () => {
        const text = "Don't stop, it’s the 3rd h2 in readme.md, see C:\\Users\\me or snake_case, e.g. this.\r\nNext line"
        expect(words(text)).toEqual(["Don't", 'stop', 'it’s', 'the', 'in', 'see', 'or', 'this', 'Next', 'line'])
        const found = findProseWords(text)
        expect(found.at(-1)).toEqual({ word: 'line', offset: text.length - 4 })
    })

    it('keeps out code and comments with blank lines inside, and keeps in the rest of a list item', () => {
        const text = [
            'Intro',
            '',
            '- itme',
            '',
            '  ```',
            '  fenced codde',
            '',
            '  more codde',
            '  ```',
            '',
            '10. numbred',
            '',
            '    contnued text',
            '',
            '<!--',
            'commnt',
            '',
            'still commnt',
            '-->',
            '',
            '<pre>',
            '',
            'preformated',
            '</pre>',
            '',
            '~~~',
            'tilde',
            '',
            'fnce',
            '~~~',
            '',
            'Outro',
        ].join('\n')
        expect(words(text)).toEqual(['Intro', 'itme', 'numbred', 'contnued', 'text', 'Outro'])
    })

    it('skips the labels of reference links and footnotes, wherever they are defined', () => {
        const text = 'A [linkk][refname] and a note[^nte].\n\nMore [shortcut] text.\n\n[refname]: https://example.com\n\n[^nte]: The nnote.'
        expect(words(text)).toEqual(['linkk', 'and', 'note', 'More', 'shortcut', 'text', 'The', 'nnote'])
    })

    it('reads a long run of [^ without slowing down', () => {
        const start = performance.now()
        expect(words(`A note[^nte] and ${'[^'.repeat(40_000)}`)).toEqual(['note', 'and'])
        // About a third of a second; nine before the footnote label was capped.
        expect(performance.now() - start).toBeLessThan(3000)
    })

    it('finds the same words when one part of a long document changes', () => {
        const find = createProseWordFinder()
        const before = 'First paragrph.\n\nSecond paragrph.\n\nThird paragrph.'
        const after = 'First paragrph.\n\nSecond paragraph changd.\n\nThird paragrph.'
        expect(find(before)).toEqual(findProseWords(before))
        expect(find(after)).toEqual(findProseWords(after))
        expect(find(after).at(-1)).toEqual({ word: 'paragrph', offset: after.length - 9 })
    })

    it('checks headings, lists, quotes, tables and emphasis', () => {
        const text = '## Hedding\n\n- itme one\n\n> quoet\n\n| Colum |\n| --- |\n| cel |\n\n**bld** and _itlic_'
        expect(words(text)).toEqual(['Hedding', 'itme', 'one', 'quoet', 'Colum', 'cel', 'bld', 'and', 'itlic'])
    })
})
