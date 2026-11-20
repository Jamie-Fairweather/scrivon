import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { lastMermaidBlockSources } from './markdown-block-ordinals'
import { MarkdownPreview } from './markdown-preview'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ svgForDisplay: null, dimensions: null, error: null, isPending: false }),
}))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: 'scrivon-dark', isLight: false }),
}))

vi.mock('@/lib/markdown/shiki-highlighter', () => ({
    previewCodeTheme: () => 'github-dark',
    highlightFencedCodeNow: () => null,
    highlightFencedCode: () => new Promise<string>(() => {}),
}))

/** How many times react-markdown has parsed and rendered a document. */
const markdownParses = vi.hoisted(() => ({ count: 0 }))

vi.mock('react-markdown', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-markdown')>()
    const Markdown = actual.default
    return {
        ...actual,
        default: function CountingMarkdown(props: Parameters<typeof Markdown>[0]) {
            markdownParses.count++
            return Markdown(props)
        },
    }
})

const noop = () => {}
const callbacks = { onExpandBlock: noop, onLinkClick: noop, loadRemoteImages: false, onRemoteImageBlocked: () => noop }

function slides(source: string, slide = 0) {
    return render(<MarkdownPreview source={source} tabId="doc.md" documentKey="doc.md:present" variant="slides" slide={slide} {...callbacks} />)
}

/** Each slide's text, in order. */
function slideTexts(container: HTMLElement): string[] {
    return [...container.querySelectorAll('article > section[data-slide]')].map((section) => section.textContent?.trim() ?? '')
}

describe('MarkdownPreview as slides', () => {
    it('starts a new slide at each top-level thematic break, and drops the break', () => {
        const { container } = slides('# One\n\n---\n\n# Two\n\n***\n\nThree')

        expect(slideTexts(container)).toEqual(['One', 'Two', 'Three'])
        expect(container.querySelector('hr')).toBeNull()
    })

    it('starts a new slide at a top-level raw HTML <hr> too', () => {
        const { container } = slides('One\n\n<hr>\n\nTwo\n\n<hr />\n\nThree')

        expect(slideTexts(container)).toEqual(['One', 'Two', 'Three'])
    })

    it('is one slide when the document has no breaks', () => {
        const { container } = slides('# Title\n\nSome text\n\n- a list')

        expect(slideTexts(container)).toHaveLength(1)
    })

    it('leaves front matter out rather than taking its fences as breaks', () => {
        const { container } = slides('---\ntitle: Talk\n---\n\n# One\n\n---\n\n# Two')

        expect(slideTexts(container)).toEqual(['One', 'Two'])
    })

    it('takes a --- straight under a line of text as making it a heading, not a break', () => {
        const { container } = slides('Heading\n---\n\nText')

        expect(slideTexts(container)).toHaveLength(1)
        expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument()
    })

    it('keeps a break inside a list or a quote where it is', () => {
        const { container } = slides('- one\n\n  ---\n\n  two\n\n> quoted\n>\n> ---\n>\n> more')

        expect(slideTexts(container)).toHaveLength(1)
        expect(container.querySelectorAll('li hr, blockquote hr')).toHaveLength(2)
    })

    it('drops empty slides, so breaks at the start, the end or two in a row add none', () => {
        const { container } = slides('***\n\nOne\n\n---\n\n---\n\n<!-- nothing -->\n\n---\n\nTwo\n\n---\n')

        expect(slideTexts(container)).toEqual(['One', 'Two'])
    })

    it('lists the footnotes at the end of the last slide, numbered as in the preview', () => {
        const { container } = slides('One[^a]\n\n---\n\nTwo[^b]\n\n---\n\nThree\n\n[^a]: First note.\n[^b]: Second note.\n')

        const sections = container.querySelectorAll('article > section[data-slide]')
        expect(sections).toHaveLength(3)
        const footnotes = container.querySelector('section[data-footnotes]')
        expect(footnotes?.parentElement).toBe(sections[2])
        expect([...footnotes!.querySelectorAll('li')].map((item) => item.textContent?.replace('↩', '').trim())).toEqual([
            'First note.',
            'Second note.',
        ])
        expect(sections[0]!.querySelector('sup a')?.textContent).toBe('1')
        expect(sections[1]!.querySelector('sup a')?.textContent).toBe('2')
    })

    it('shows only the current slide, labelled with its place for screen readers', () => {
        const { container } = slides('One\n\n---\n\nTwo\n\n---\n\nThree', 1)

        const sections = [...container.querySelectorAll<HTMLElement>('article > section[data-slide]')]
        expect(sections.map((section) => section.hidden)).toEqual([true, false, true])
        expect(sections[1]).toHaveAttribute('aria-label', 'Slide 2 of 3')
        expect(sections[1]).toHaveAttribute('aria-roledescription', 'slide')
    })

    it('gives each slide the document’s language', () => {
        const { container } = slides('---\nlang: fr\n---\n\nUn\n\n---\n\nDeux')

        for (const section of container.querySelectorAll('article > section[data-slide]')) expect(section).toHaveAttribute('lang', 'fr')
    })

    it('changes slide without parsing the document again', () => {
        const source = 'One\n\n---\n\nTwo'
        const { container, rerender } = slides(source, 0)
        const parses = markdownParses.count

        rerender(<MarkdownPreview source={source} tabId="doc.md" documentKey="doc.md:present" variant="slides" slide={1} {...callbacks} />)

        expect(markdownParses.count).toBe(parses)
        expect([...container.querySelectorAll<HTMLElement>('section[data-slide]')].map((section) => section.hidden)).toEqual([true, false])
    })

    it('shows diagrams without an Expand button, under their own document key', () => {
        slides('```mermaid\nflowchart TD\n```\n\n---\n\n```mermaid\ngraph LR\n```', 0)

        expect(screen.queryByRole('button', { name: /Expand diagram/ })).not.toBeInTheDocument()
        expect(lastMermaidBlockSources('doc.md:present')).toEqual(['flowchart TD', 'graph LR'])
        expect(lastMermaidBlockSources('doc.md')).toBeUndefined()
    })

    it('leaves the preview of the same document as it was: one article, no slides', () => {
        const { container } = render(<MarkdownPreview source={'One\n\n---\n\nTwo'} tabId="preview.md" {...callbacks} />)

        expect(container.querySelector('section[data-slide]')).toBeNull()
        expect(container.querySelector('article hr')).not.toBeNull()
    })
})
