import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

const noop = () => {}

function preview(source: string) {
    return render(
        <MarkdownPreview
            source={source}
            tabId="doc.md"
            onExpandBlock={noop}
            onLinkClick={noop}
            loadRemoteImages={false}
            onRemoteImageBlocked={() => noop}
        />
    )
}

/** The source line on the nearest block around the element that has `text`. */
function lineOf(container: HTMLElement, selector: string, text?: string): number | null {
    const element = [...container.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || el.textContent?.includes(text))
    const block = element?.closest<HTMLElement>('[data-source-line]')
    return block ? Number(block.dataset.sourceLine) : null
}

describe('MarkdownPreview source lines', () => {
    it('marks headings, paragraphs, list items and quotes with the line they start on', () => {
        const { container } = preview('# Title\n\nFirst paragraph\nruns on.\n\n- one\n- two\n\n> quoted\n\n---\n')
        expect(lineOf(container, 'h1')).toBe(1)
        expect(lineOf(container, 'p', 'First')).toBe(3)
        expect(lineOf(container, 'li', 'one')).toBe(6)
        expect(lineOf(container, 'li', 'two')).toBe(7)
        expect(lineOf(container, 'blockquote')).toBe(9)
        expect(lineOf(container, 'hr')).toBe(11)
    })

    it('counts the front matter lines the preview leaves out', () => {
        const { container } = preview('---\ntitle: Notes\nauthor: Me\n---\n# Title\n\nText')
        expect(lineOf(container, 'h1')).toBe(5)
        expect(lineOf(container, 'p', 'Text')).toBe(7)
    })

    it('counts Windows line endings as one line each', () => {
        const { container } = preview('---\r\ntitle: Notes\r\n---\r\n# Title\r\n\r\nText')
        expect(lineOf(container, 'h1')).toBe(4)
        expect(lineOf(container, 'p', 'Text')).toBe(6)
    })

    it('marks code blocks and diagrams, which draw their own frames', () => {
        const { container } = preview('Intro\n\n```js\nlet a = 1\n```\n\n```mermaid\ngraph TD\n  A --> B\n```\n')
        expect(lineOf(container, 'code', 'let a')).toBe(3)
        expect(lineOf(container, '[data-mermaid-block-id]')).toBe(7)
    })

    it('marks display equations, $$ and ```math, so double-click can jump to them (#182)', () => {
        const { container } = preview('Before\n\n$$\nE = mc^2\n$$\n\nMiddle\n\n```math\na^2 + b^2 = c^2\n```\n\nAfter $x$ inline\n')
        const equations = container.querySelectorAll<HTMLElement>('math[display="block"]')
        expect(equations).toHaveLength(2)
        expect(equations[0]!.closest('[data-source-line]')).toHaveAttribute('data-source-line', '3')
        expect(equations[1]!.closest('[data-source-line]')).toHaveAttribute('data-source-line', '9')
        expect(lineOf(container, 'p', 'After')).toBe(13)
    })

    it('gives an alert’s text the line it starts on, not the [!NOTE] line (#182)', () => {
        const { container } = preview(
            '---\ntitle: T\n---\n# Title\n\n> [!NOTE]\n> Alert line one\n> line two\n\n> [!TIP]  \n> After two spaces\n\n> [!WARNING]\n> **Bold** first\n'
        )
        expect(lineOf(container, '[role="note"]', 'Alert line one')).toBe(6)
        expect(lineOf(container, 'p', 'Alert line one')).toBe(7)
        expect(lineOf(container, 'p', 'After two spaces')).toBe(11)
        expect(lineOf(container, 'p', 'Bold first')).toBe(14)
    })

    it('marks each table row', () => {
        const { container } = preview('| A | B |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |\n')
        expect(lineOf(container, 'table')).toBe(1)
        expect(lineOf(container, 'td', '1')).toBe(3)
        expect(lineOf(container, 'td', '3')).toBe(4)
    })

    it('marks blocks after raw HTML, and the raw HTML blocks too', () => {
        const { container } = preview('<div align="center">\n\nCentred\n\n</div>\n\n## After\n')
        expect(container.querySelector('div[align]')).toHaveAttribute('data-source-line', '1')
        expect(lineOf(container, 'p', 'Centred')).toBe(3)
        expect(lineOf(container, 'h2')).toBe(7)
    })
})
