import type { Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import type { Root } from 'mdast'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { describe, expect, it } from 'vitest'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'
import { applyWikiLinks, parseWikiLinkText, wikiHeadingHref, wikiLinkText, type WikiLink } from '@/lib/markdown/wiki-links'

const processor = unified().use(remarkParse).use(markdownRemarkPlugins)

function run(markdown: string): Root {
    return processor.runSync(processor.parse(markdown), markdown) as Root
}

/** Each wiki link: what it names, what it shows, and what of the document its place and its text's place cover. */
function links(markdown: string) {
    const found: { target: string; heading: string | null; label: string | null; text: string; written: string; shownAt: string }[] = []
    visit(run(markdown), 'wikiLink', (node: WikiLink) => {
        const child = node.children[0]!
        found.push({
            target: node.target,
            heading: node.heading,
            label: node.label,
            text: 'value' in child ? child.value : '',
            written: markdown.slice(node.position!.start.offset, node.position!.end.offset),
            shownAt: markdown.slice(child.position!.start.offset, child.position!.end.offset),
        })
    })
    return found
}

function html(markdown: string): string {
    const toHast = unified().use(remarkRehype)
    return toHtml(toHast.runSync(run(markdown)) as HastRoot)
}

describe('parseWikiLinkText', () => {
    it('reads the target, heading and label, without the spaces around them', () => {
        expect(parseWikiLinkText('Note')).toMatchObject({ target: 'Note', heading: null, label: null })
        expect(parseWikiLinkText(' Note | shown text ')).toMatchObject({ target: 'Note', heading: null, label: 'shown text' })
        expect(parseWikiLinkText('Note#Set up')).toMatchObject({ target: 'Note', heading: 'Set up', label: null })
        expect(parseWikiLinkText('#Set up|here')).toMatchObject({ target: '', heading: 'Set up', label: 'here' })
        expect(parseWikiLinkText('folder/Note')).toMatchObject({ target: 'folder/Note' })
    })

    it('names nothing for empty brackets or a lone #', () => {
        expect(parseWikiLinkText('  ')).toBeNull()
        expect(parseWikiLinkText('#')).toBeNull()
        expect(parseWikiLinkText('|label')).toBeNull()
    })

    it('shows the label, else the note (with its heading), else the heading', () => {
        expect(wikiLinkText({ target: 'Note', heading: null, label: 'here' })).toBe('here')
        expect(wikiLinkText({ target: 'Note', heading: null, label: null })).toBe('Note')
        expect(wikiLinkText({ target: 'Note', heading: 'Setup', label: null })).toBe('Note › Setup')
        expect(wikiLinkText({ target: '', heading: 'Setup', label: null })).toBe('Setup')
    })
})

describe('wiki links in the tree', () => {
    it('reads each form, keeping its place and its shown text’s place', () => {
        expect(links('See [[Note]], [[Note|the note]], [[Note#Set up]], [[folder/Note]] and [[#Set up]].')).toEqual([
            { target: 'Note', heading: null, label: null, text: 'Note', written: '[[Note]]', shownAt: 'Note' },
            { target: 'Note', heading: null, label: 'the note', text: 'the note', written: '[[Note|the note]]', shownAt: 'the note' },
            { target: 'Note', heading: 'Set up', label: null, text: 'Note › Set up', written: '[[Note#Set up]]', shownAt: 'Note#Set up' },
            { target: 'folder/Note', heading: null, label: null, text: 'folder/Note', written: '[[folder/Note]]', shownAt: 'folder/Note' },
            { target: '', heading: 'Set up', label: null, text: 'Set up', written: '[[#Set up]]', shownAt: '#Set up' },
        ])
    })

    it('keeps places right on later lines, in quotes and lists, and after escapes and references', () => {
        const markdown = '> one &amp; two\n> and \\* [[Some note|label]] after\n\n- item\n  more [[B]]'
        expect(links(markdown).map(({ written, shownAt }) => [written, shownAt])).toEqual([
            ['[[Some note|label]]', 'label'],
            ['[[B]]', 'B'],
        ])
        const tree = run(markdown)
        const lines: number[] = []
        visit(tree, 'wikiLink', (node: WikiLink) => {
            lines.push(node.position!.start.line)
        })
        expect(lines).toEqual([2, 5])
    })

    it('reads an escaped pipe in a table cell as the label’s start', () => {
        expect(links('| A |\n| - |\n| [[Note\\|label]] |')).toEqual([
            { target: 'Note', heading: null, label: 'label', text: 'label', written: '[[Note\\|label]]', shownAt: 'label' },
        ])
    })

    it('reads [[a]] as a wiki link when the document defines [a]', () => {
        const markdown = 'Go to [[a]] now.\n\n[a]: https://example.com'
        expect(links(markdown)).toEqual([{ target: 'a', heading: null, label: null, text: 'a', written: '[[a]]', shownAt: 'a' }])
        expect(html(markdown)).toBe('<p>Go to <a class="wiki-link" data-wiki-target="a">a</a> now.</p>')
    })

    it('leaves code, unclosed brackets, nested brackets, escaped brackets, embeds and link text as they are', () => {
        const markdown = [
            '`[[inline]]` and [[unclosed and [[a [b] c]]',
            '',
            '```',
            '[[fenced]]',
            '```',
            '',
            '    [[indented]]',
            '',
            '\\[[escaped]] ![[embed]] [see [[inside]]](https://example.com)',
        ].join('\n')
        expect(links(markdown)).toEqual([])
    })

    it('writes a wiki link to a note as a link without an address, and one to a heading as a #link to its id', () => {
        expect(html('[[My Note#Set Up|go]] [[#Set Up]]')).toBe(
            '<p><a class="wiki-link" data-wiki-target="My Note" data-wiki-heading="Set Up">go</a> ' +
                '<a class="wiki-link" href="#set-up" data-wiki-heading="Set Up">Set Up</a></p>'
        )
        expect(wikiHeadingHref('Foo & Bar')).toBe('#foo--bar')
    })

    it('still makes links when the source is not given, only without a place', () => {
        const tree = processor.parse('[[Note]]') as Root
        applyWikiLinks(tree, '')
        const found: WikiLink[] = []
        visit(tree, 'wikiLink', (node: WikiLink) => {
            found.push(node)
        })
        expect(found).toHaveLength(1)
        expect(found[0]!.position).toBeUndefined()
    })
})
