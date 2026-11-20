import { describe, expect, it } from 'vitest'
import { addressParts, addressPathLength, documentLinks, readDocumentLinks, type DocumentLink } from '@/lib/markdown/document-links'

/** The text each link's address span covers. */
function addresses(source: string): (string | null)[] {
    return documentLinks(source).links.map((link) => (link.address ? source.slice(link.address.start, link.address.end) : null))
}

function only(source: string): DocumentLink {
    const { links } = documentLinks(source)
    expect(links).toHaveLength(1)
    return links[0]!
}

describe('documentLinks', () => {
    it('finds inline links, images, reference links and definitions, in order, with their positions', () => {
        const source = [
            'See [Setup](docs/setup.md) and ![chart](assets/chart.png).',
            '',
            'Read [the guide][guide].',
            '',
            '[guide]: docs/guide.md',
        ].join('\n')
        const { links } = documentLinks(source)
        expect(links.map(({ kind, url }) => [kind, url])).toEqual([
            ['link', 'docs/setup.md'],
            ['image', 'assets/chart.png'],
            ['reference', 'docs/guide.md'],
            ['definition', 'docs/guide.md'],
        ])
        expect(links[0]!.position).toEqual({ start: { line: 1, column: 5, offset: 4 }, end: { line: 1, column: 27, offset: 26 } })
        expect(links[2]).toMatchObject({ address: null, identifier: 'guide' })
        expect(links[3]!.position.start).toEqual({ line: 5, column: 1, offset: source.indexOf('[guide]:') })
        expect(addresses(source)).toEqual(['docs/setup.md', 'assets/chart.png', null, 'docs/guide.md'])
    })

    it('marks a definition only images use as an image', () => {
        const { links } = documentLinks('![logo][logo]\n\n[logo]: img/logo.png\n')
        expect(links.find((link) => link.kind === 'definition')).toMatchObject({ image: true })
        expect(links.find((link) => link.kind === 'reference')).toMatchObject({ image: true })
        expect(documentLinks('[a][x] ![b][x]\n\n[x]: x.md\n').links.find((link) => link.kind === 'definition')?.image).toBeUndefined()
    })

    it('gives a reference the first definition of its label, as the preview links it', () => {
        const { links } = documentLinks('[a]: x.md\n[A]: y.md\n\n[a]')
        expect(links.find((link) => link.kind === 'reference')).toMatchObject({ url: 'x.md', identifier: 'a' })
    })

    it('gives the exact address span inside angle brackets, escapes, nested parentheses and before a title', () => {
        expect(addresses('[a](<my file.md>)')).toEqual(['my file.md'])
        expect(only('[a](<my file.md>)')).toMatchObject({ url: 'my file.md', angleBrackets: true })
        expect(addresses('[a](a\\)b.md)')).toEqual(['a\\)b.md'])
        expect(only('[a](a\\)b.md)').url).toBe('a)b.md')
        expect(addresses('[a](a(1).md)')).toEqual(['a(1).md'])
        expect(addresses('[a](docs/a.md "Title")')).toEqual(['docs/a.md'])
        expect(addresses("[a](docs/a.md 'Title')")).toEqual(['docs/a.md'])
        expect(addresses('[a](docs/a.md (Title))')).toEqual(['docs/a.md'])
        expect(addresses('[a](  spaced.md  )')).toEqual(['spaced.md'])
        expect(addresses('[a](<b c.md> "t")')).toEqual(['b c.md'])
        expect(addresses('![a [b] `]` c](x.png)')).toEqual(['x.png'])
        expect(addresses('[a *b* `](no)` c](real.md)')).toEqual(['real.md'])
        expect(addresses('[a](my%20file.md#part)')).toEqual(['my%20file.md#part'])
        expect(addresses('[a](a&amp;b.md)')).toEqual(['a&amp;b.md'])
        expect(addresses('[e]()')).toEqual([''])
    })

    it('finds a definition address on the next line, with a title', () => {
        const source = "[ref]:\n   docs/a(1).md 'Title'\n\n[ref]\n"
        expect(addresses(source)).toEqual(['docs/a(1).md', null])
        expect(addresses('[ref]: <my file.md> "t"\n\n[ref]')).toEqual(['my file.md', null])
    })

    it('skips links in code blocks, inline code and maths, and autolinks', () => {
        const source = [
            '```',
            '[a](in-fence.md)',
            '```',
            '',
            '`[b](inline.md)` $[c](math.md)$',
            '',
            '$$',
            '[d](block-math.md)',
            '$$',
            '',
            '<https://x.y> www.x.y [e](e.md)',
        ].join('\n')
        expect(documentLinks(source).links.map((link) => link.url)).toEqual(['e.md'])
    })

    it('counts positions from the top of the file when there is front matter', () => {
        const source = ['---', 'title: Notes', '---', '', 'Go [there](there.md).'].join('\r\n')
        const link = only(source)
        expect(link.position.start).toEqual({ line: 5, column: 4, offset: source.indexOf('[there]') })
        expect(source.slice(link.address!.start, link.address!.end)).toBe('there.md')
    })

    it('collects the anchors: headings with the preview ids, footnotes and raw HTML ids and names', () => {
        const source = [
            '# Install',
            '',
            '## Foo & Bar',
            '',
            'Text[^note] and again[^note].',
            '',
            '[^note]: A note.',
            '',
            '<div id="custom">x</div> <a name="old-anchor"></a> <span name="not-this"></span>',
            '',
            '## Install',
        ].join('\n')
        expect(documentLinks(source).anchors).toEqual([
            'install',
            'foo--bar',
            'install-1',
            'fn-note',
            'fnref-note',
            'fnref-note-2',
            'custom',
            'old-anchor',
            'footnote-label',
        ])
    })

    it('reads nothing from text the parser cannot take', () => {
        expect(readDocumentLinks('')).toEqual({ links: [], anchors: [] })
    })
})

describe('addressPathLength', () => {
    it('ends the path before the query or fragment, escaped or not, as the preview splits the parsed url', () => {
        expect(addressPathLength('docs/a.md#part')).toBe(9)
        expect(addressPathLength('docs/a.md?x=1#part')).toBe(9)
        // `\#` is `#` once the parser has read it, and the preview takes it as the start of the fragment.
        expect(addressPathLength('a\\#b.md')).toBe(1)
        expect(addressPathLength('a\\?b.md')).toBe(1)
        // An escaped backslash doesn't escape the `#` after it.
        expect(addressPathLength('a\\\\#b')).toBe(3)
        expect(addressPathLength('#only')).toBe(0)
    })
})

describe('addressParts', () => {
    it('splits the written address where the parsed url splits', () => {
        expect(addressParts('docs/a.md#part', 'docs/a.md#part')).toEqual({ pathEnd: 9, fragmentStart: 10 })
        expect(addressParts('docs/a.md?x=1#part', 'docs/a.md?x=1#part')).toEqual({ pathEnd: 9, fragmentStart: 14 })
        expect(addressParts('docs/a.md', 'docs/a.md')).toEqual({ pathEnd: 9, fragmentStart: null })
        expect(addressParts('\\#x.md', '#x.md')).toEqual({ pathEnd: 0, fragmentStart: 2 })
        expect(addressParts('nope\\#sec.md', 'nope#sec.md')).toEqual({ pathEnd: 4, fragmentStart: 6 })
        expect(addressParts('a\\(1\\).md', 'a(1).md')).toEqual({ pathEnd: 9, fragmentStart: null })
    })

    it('gives nothing when the written parts do not read back as the url’s', () => {
        // `&#35;` is a `#` to the parser, but the written `#` is inside the reference.
        expect(addressParts('a&#35;b.md', 'a#b.md')).toBeNull()
        expect(addressParts('a&#65;b.md', 'aAb.md')).toBeNull()
    })
})
