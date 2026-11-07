import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MarkdownPreview } from './markdown-preview'
import { extractMermaidBlockSources } from './mermaid-block-sources'

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

function preview(source: string) {
    return render(<MarkdownPreview source={source} tabId="doc.md" {...callbacks} />)
}

describe('MarkdownPreview', () => {
    it('parses the document again only when its text changes', () => {
        const { rerender } = preview('# One')
        const parses = markdownParses.count

        rerender(<MarkdownPreview source="# One" tabId="doc.md" {...callbacks} />)
        expect(markdownParses.count).toBe(parses)

        rerender(<MarkdownPreview source="# Two" tabId="doc.md" {...callbacks} />)
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
            const label = container.querySelector('h2#user-content-footnote-label')
            expect(label).toHaveClass('sr-only')
            expect(container.querySelector('li#user-content-fn-1')).not.toBeNull()
            expect(container.querySelector('a[data-footnote-backref]')).toHaveAttribute('aria-label', 'Back to reference 1')
        })
    })

    describe('raw HTML (B29)', () => {
        it('hides comments instead of showing them as text', () => {
            const { container } = preview('## Comments (HTML, hidden in output)\n\n<!-- a hidden note -->\n\nVisible <!-- inline note --> text')
            expect(container).not.toHaveTextContent('hidden note')
            expect(container).not.toHaveTextContent('inline note')
            expect(container).not.toHaveTextContent('<!--')
            expect(container).toHaveTextContent('Visible text')
        })

        it('draws safe tags as elements: a line break in a table cell, kbd, sub, sup, details', () => {
            const { container } = preview(
                [
                    '| Key | Notes |',
                    '| --- | --- |',
                    '| <kbd>Ctrl</kbd>+<kbd>S</kbd> | first<br>second |',
                    '',
                    'H<sub>2</sub>O and x<sup>2</sup> and <mark>marked</mark>',
                    '',
                    '<details>',
                    '<summary>More</summary>',
                    '',
                    'Inside the details.',
                    '',
                    '</details>',
                ].join('\n')
            )
            const cell = container.querySelectorAll('td')[1]!
            expect(cell.querySelector('br')).not.toBeNull()
            expect(cell).not.toHaveTextContent('<br>')
            expect(container.querySelectorAll('kbd')).toHaveLength(2)
            expect(container.querySelector('sub')).toHaveTextContent('2')
            expect(container.querySelector('sup')).toHaveTextContent('2')
            expect(container.querySelector('mark')).toHaveTextContent('marked')
            expect(container.querySelector('details summary')).toHaveTextContent('More')
            expect(container.querySelector('details p')).toHaveTextContent('Inside the details.')
        })

        it('removes scripts, styles, frames and event handlers', () => {
            const { container } = preview(
                [
                    '<script>alert(1)</script>',
                    '',
                    '<style>body { display: none }</style>',
                    '',
                    '<iframe src="https://example.com"></iframe>',
                    '',
                    'Text <img src="pic.png" onerror="alert(2)" alt="pic"> <a href="javascript:alert(3)" onclick="alert(4)">link</a>',
                ].join('\n')
            )
            expect(container.querySelector('script, style, iframe')).toBeNull()
            expect(container).not.toHaveTextContent('alert')
            expect(container).not.toHaveTextContent('display: none')
            const img = container.querySelector('img')!
            expect(img).toHaveAttribute('alt', 'pic')
            expect(img).not.toHaveAttribute('onerror')
            const link = screen.getByText('link').closest('a')!
            expect(link).not.toHaveAttribute('onclick')
            expect(link.getAttribute('href') ?? '').not.toMatch(/javascript/i)
        })

        it('keeps the document from taking over the app’s ids, document methods, shortcuts and Tab order', () => {
            const { container } = preview('<img name="createElement" id="export-title" src="pic.png" alt="x" accesskey="s" tabindex="1">')
            const img = container.querySelector('img')!
            expect(img).toHaveAttribute('name', 'user-content-createElement')
            expect(img).toHaveAttribute('id', 'user-content-export-title')
            expect(img).not.toHaveAttribute('accesskey')
            expect(img).not.toHaveAttribute('tabindex')
            expect(typeof document.createElement).toBe('function')
        })

        it('numbers a diagram written as raw HTML the same way the viewer finds it', () => {
            const source = '<pre><code class="language-mermaid">graph LR\n  A --> B</code></pre>\n\n```mermaid\nflowchart TD\n```'
            preview(source)
            expect(screen.getAllByRole('button', { name: /^Expand diagram/ })).toHaveLength(2)
            expect(extractMermaidBlockSources(source)).toEqual(['graph LR\n  A --> B', 'flowchart TD'])
        })
    })

    describe('empty fenced blocks', () => {
        it.each([
            ['with a language', '```js\n```'],
            ['without a language', '```\n```'],
        ])('shows one %s as an empty code block, as export does', (_, source) => {
            const { container } = preview(`Before\n\n${source}\n\nAfter`)
            const code = container.querySelector('[data-mode] pre > code')
            expect(code).not.toBeNull()
            expect(code?.textContent).toBe('')
            expect(container.querySelector('p code')).toBeNull()
        })

        it('still shows an empty Mermaid block as a diagram block, and inline code inline', () => {
            const { container } = preview('```mermaid\n```\n\nSay `hi`.')
            expect(container).toHaveTextContent('Empty Mermaid block')
            expect(container.querySelector('[data-mode]')).toBeNull()
            expect(container.querySelector('p code')).toHaveTextContent('hi')
        })
    })

    it('numbers diagrams from 0 in order, even when React renders each block twice', () => {
        const onExpandBlock = vi.fn()
        const source = [
            '```mermaid',
            'flowchart TD',
            '```',
            '',
            'Text[^1]',
            '',
            '[^1]: ```mermaid',
            '    pie',
            '    ```',
            '',
            '```mermaid',
            'flowchart LR',
            '```',
        ].join('\n')
        render(
            <StrictMode>
                <MarkdownPreview source={source} tabId="doc.md" {...callbacks} onExpandBlock={onExpandBlock} />
            </StrictMode>
        )

        const buttons = screen.getAllByRole('button', { name: /^Expand diagram/ })
        expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Expand diagram 1', 'Expand diagram 2', 'Expand diagram 3'])
        buttons.forEach((button) => fireEvent.click(button))
        // The order MarkdownDocumentViewer finds the blocks in again; the footnote's diagram comes last.
        const sources = extractMermaidBlockSources(source)
        expect(sources).toEqual(['flowchart TD', 'flowchart LR', 'pie'])
        expect(onExpandBlock.mock.calls).toEqual(sources.map((blockSource, ordinal) => [expect.any(String), ordinal, blockSource]))
        // Each block has its own id, which doesn't come from its position.
        const ids = onExpandBlock.mock.calls.map(([blockId]) => blockId as string)
        expect(new Set(ids).size).toBe(3)
        expect(ids.every((id) => id.startsWith('doc.md:'))).toBe(true)
    })

    it('leaves YAML front matter out, as export does', () => {
        const { container } = preview('---\r\ntitle: Quarterly report\r\nauthor: Jamie\r\n---\r\n\r\n# Body')
        expect(container.querySelector('hr')).toBeNull()
        expect(container.querySelector('h2')).toBeNull()
        expect(container).not.toHaveTextContent('title:')
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Body')
    })
})
