import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from './markdown-preview'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ svgForDisplay: null, dimensions: null, error: null, isPending: false }),
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

function preview(source: string) {
    return render(<MarkdownPreview source={source} tabId="doc.md" onExpandBlock={noop} onLinkClick={noop} />)
}

describe('MarkdownPreview', () => {
    it('parses the document again only when its text changes', () => {
        const { rerender } = preview('# One')
        const parses = markdownParses.count

        rerender(<MarkdownPreview source="# One" tabId="doc.md" onExpandBlock={noop} onLinkClick={noop} />)
        expect(markdownParses.count).toBe(parses)

        rerender(<MarkdownPreview source="# Two" tabId="doc.md" onExpandBlock={noop} onLinkClick={noop} />)
        expect(markdownParses.count).toBe(parses + 1)
    })

    describe('keeps what the Markdown says about each element', () => {
        it('numbers a list that resumes at 3 from 3', () => {
            const { container } = preview('3. three\n4. four')
            expect(container.querySelector('ol')).toHaveAttribute('start', '3')
        })

        it('shows a task item’s checkbox in place of its bullet', () => {
            const { container } = preview('- [ ] buy milk\n- [x] buy bread\n- no checkbox')
            const list = container.querySelector('ul')!
            expect(list).toHaveClass('contains-task-list')

            const [milk, bread, plain] = Array.from(list.querySelectorAll('li'))
            expect(milk).toHaveClass('task-list-item', 'list-none')
            expect(bread).toHaveClass('task-list-item', 'list-none')
            expect(plain).not.toHaveClass('list-none')
            expect(milk!.querySelector('input[type="checkbox"]')).not.toBeChecked()
            expect(bread!.querySelector('input[type="checkbox"]')).toBeChecked()
        })

        it('keeps a link’s title as its tooltip', () => {
            preview('[docs](https://example.com "Read the docs")')
            expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('title', 'Read the docs')
        })

        it('keeps footnote ids and the hidden footnotes heading', () => {
            const { container } = preview('Text[^1]\n\n[^1]: The note.')
            const label = container.querySelector('h2#footnote-label')
            expect(label).toHaveClass('sr-only')
            expect(container.querySelector('li#user-content-fn-1')).not.toBeNull()
            expect(container.querySelector('a[data-footnote-backref]')).toHaveAttribute('aria-label', 'Back to reference 1')
        })
    })

    it('leaves YAML front matter out, as export does', () => {
        const { container } = preview('---\r\ntitle: Quarterly report\r\nauthor: Jamie\r\n---\r\n\r\n# Body')
        expect(container.querySelector('hr')).toBeNull()
        expect(container.querySelector('h2')).toBeNull()
        expect(container).not.toHaveTextContent('title:')
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Body')
    })
})
