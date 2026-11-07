import type { Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { previewHtmlPlugins, previewRemarkRehypeOptions } from '@/lib/markdown/html-sanitize-schema'

/** How many times rehype-raw has parsed a tree again. */
const rawPasses = vi.hoisted(() => ({ count: 0 }))

vi.mock('rehype-raw', async (importOriginal) => {
    const actual = (await importOriginal<typeof import('rehype-raw')>()).default
    return {
        default: (...args: Parameters<typeof actual>) => {
            const transform = actual(...args)
            return (...run: Parameters<typeof transform>) => {
                rawPasses.count++
                return transform(...run)
            }
        },
    }
})

function previewHtml(markdown: string): string {
    const processor = unified().use(remarkParse).use(remarkRehype, previewRemarkRehypeOptions).use(previewHtmlPlugins)
    return toHtml(processor.runSync(processor.parse(markdown)) as HastRoot)
}

describe('previewHtmlPlugins', () => {
    beforeEach(() => {
        rawPasses.count = 0
    })

    it('parses the tree again only for a document with raw HTML, as that more than doubles the work (review)', () => {
        expect(previewHtml('# Plain\n\nNo *HTML* here, just `code` and [a link](https://example.com).')).toContain('<em>HTML</em>')
        expect(rawPasses.count).toBe(0)

        expect(previewHtml('Line<br>break <!-- note -->')).toBe('<p>Line<br>break </p>')
        expect(rawPasses.count).toBe(1)
    })

    it('still cleans a document with no raw HTML', () => {
        expect(previewHtml('[x](javascript:alert(1))')).toBe('<p><a>x</a></p>')
        expect(rawPasses.count).toBe(0)
    })

    it('keeps phone links, which the preview hands to the system like web and email links (N26)', () => {
        expect(previewHtml('[call](tel:+442012345678) <a href="tel:+15550100">desk</a>')).toBe(
            '<p><a href="tel:+442012345678">call</a> <a href="tel:+15550100">desk</a></p>'
        )
    })
})
