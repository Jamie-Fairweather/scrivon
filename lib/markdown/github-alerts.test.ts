import type { Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'

function html(markdown: string): string {
    const processor = unified().use(remarkParse).use(markdownRemarkPlugins).use(remarkRehype)
    return toHtml(processor.runSync(processor.parse(markdown)) as HastRoot).replace(/\n/g, '')
}

describe('GitHub alerts', () => {
    it('turns a quote that starts with [!NOTE] into a note with its title', () => {
        expect(html('> [!NOTE]\n> Useful information.')).toBe(
            '<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title">Note</p><p>Useful information.</p></div>'
        )
    })

    it.each([
        ['[!TIP]', 'tip', 'Tip'],
        ['[!important]', 'important', 'Important'],
        ['[!Warning]', 'warning', 'Warning'],
        ['[!CAUTION]', 'caution', 'Caution'],
    ])('reads %s in any case', (marker, kind, title) => {
        expect(html(`> ${marker}\n> Text.`)).toBe(
            `<div class="markdown-alert markdown-alert-${kind}"><p class="markdown-alert-title">${title}</p><p>Text.</p></div>`
        )
    })

    it('drops the line break after a marker that ends in two spaces', () => {
        expect(html('> [!NOTE]  \n> Text.')).toContain('<p class="markdown-alert-title">Note</p><p>Text.</p>')
    })

    it('keeps the blocks after a marker that is a paragraph of its own', () => {
        expect(html('> [!WARNING]\n>\n> - one\n> - two')).toBe(
            '<div class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title">Warning</p><ul><li>one</li><li>two</li></ul></div>'
        )
    })

    it('leaves a plain quote alone', () => {
        expect(html('> Just a quote.')).toBe('<blockquote><p>Just a quote.</p></blockquote>')
    })

    it.each([
        ['text after the marker on its line', '> [!NOTE] Same line.'],
        ['formatting after the marker on its line', '> [!NOTE]*Same line.*'],
        ['an unknown kind', '> [!DANGER]\n> Text.'],
        ['a marker that is not first', '> Text.\n> [!NOTE]'],
        ['a quote in a list', '- > [!NOTE]\n  > Text.'],
        ['a quote in a quote', '> > [!NOTE]\n> > Text.'],
    ])('is not an alert with %s', (_, markdown) => {
        expect(html(markdown)).not.toContain('markdown-alert')
    })
})
