import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from './markdown-preview'

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ svgForDisplay: null, dimensions: null, error: null, isPending: false }),
}))

function preview(source: string) {
    return render(<MarkdownPreview source={source} tabId="doc.md" onExpandBlock={() => {}} onLinkClick={() => {}} />)
}

describe('MarkdownPreview', () => {
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
})
