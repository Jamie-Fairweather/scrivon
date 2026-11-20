import type { Element, ElementContent, Root } from 'hast'
import { describe, expect, it } from 'vitest'
import { markdownPreviewBody, markdownPreviewDocument, splitArticleIntoSlides } from './markdown-preview-body'

describe('markdownPreviewDocument', () => {
    it('leaves the front matter out of the body and keeps its lang', () => {
        expect(markdownPreviewDocument('---\nlang: ja\ntitle: Notes\n---\n# 本文')).toEqual({ body: '# 本文', lang: 'ja' })
    })

    it('has no lang when the front matter has none', () => {
        expect(markdownPreviewDocument('---\ntitle: Notes\n---\n# Body').lang).toBeUndefined()
        expect(markdownPreviewDocument('# Body')).toEqual({ body: '# Body' })
    })
})

describe('markdownPreviewBody', () => {
    it('is the body the preview shows', () => {
        const source = '---\nlang: ja\n---\n# Body'
        expect(markdownPreviewBody(source)).toBe(markdownPreviewDocument(source).body)
        expect(markdownPreviewBody('---\ntitle: Notes\n---\n# Body')).toBe('# Body')
    })
})

describe('splitArticleIntoSlides', () => {
    const element = (tagName: string, children: ElementContent[] = [], properties: Element['properties'] = {}): Element => ({
        type: 'element',
        tagName,
        properties,
        children,
    })
    const text = (value: string): ElementContent => ({ type: 'text', value })

    function split(children: ElementContent[], properties: Element['properties'] = { lang: 'he', dir: 'rtl' }): Element[] {
        const tree: Root = { type: 'root', children: [element('article', children, properties)] }
        splitArticleIntoSlides(tree)
        return (tree.children[0] as Element).children as Element[]
    }

    it('carries the article’s language and direction over to each slide, and numbers them', () => {
        const sections = split([element('p', [text('א')]), text('\n'), element('hr'), text('\n'), element('p', [text('ב')])])

        expect(sections.map((section) => section.properties)).toEqual([
            { lang: 'he', dir: 'rtl', dataSlide: 0, dataSlides: 2 },
            { lang: 'he', dir: 'rtl', dataSlide: 1, dataSlides: 2 },
        ])
    })

    it('adds no language or direction the article doesn’t have', () => {
        const [section] = split([element('p', [text('One')])], {})

        expect(section!.properties).toEqual({ dataSlide: 0, dataSlides: 1 })
    })

    it('makes no slides from a document of only breaks and spaces', () => {
        expect(split([element('hr'), text('\n'), element('hr')])).toEqual([])
    })

    it('still shows footnotes that have no slide of their own to go on', () => {
        const footnotes = element('section', [element('ol')], { dataFootnotes: true })

        const sections = split([element('hr'), footnotes])

        expect(sections).toHaveLength(1)
        expect(sections[0]!.children).toEqual([footnotes])
    })

    it('leaves a tree with no article alone', () => {
        const tree: Root = { type: 'root', children: [element('p')] }
        splitArticleIntoSlides(tree)
        expect(tree.children).toEqual([element('p')])
    })
})
