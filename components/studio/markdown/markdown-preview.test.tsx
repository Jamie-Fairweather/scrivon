import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MARKDOWN_SHOWCASE } from '@/lib/examples/markdown-showcase'
import { buildExportDocument } from '@/lib/markdown/export-document'
import { isTauri } from '@/lib/tauri/platform'
import { forgetWorkspaceImages } from '@/lib/workspace/workspace-images'
import { lastMermaidBlockSources } from './markdown-block-ordinals'
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

/** A tiny inline picture, which shows without the app reading a file. */
const GIF = 'data:image/gif;base64,R0lGOD'

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

    it('sizes its text by the Preview text size setting (the preview-text scale)', () => {
        const { container } = preview('Some text')

        expect(container.querySelector('article')).toHaveClass('preview-text')
    })

    describe('keeps what the Markdown says about each element', () => {
        it('numbers a list that resumes at 3 from 3', () => {
            const { container } = preview('3. three\n4. four')
            expect(container.querySelector('ol')).toHaveAttribute('start', '3')
        })

        /**
         * The bullet a list would get from its classes and those of the lists around it, read the way Tailwind
         * writes them (`[sel_&]:list-[circle]` is `sel .that-class { list-style-type: circle }`) and matched
         * against the rendered page, since the test page has no stylesheet. The rule with more steps wins.
         */
        function bulletOf(list: HTMLElement, container: HTMLElement): string {
            let best = { type: 'disc', steps: -1 }
            for (const owner of container.querySelectorAll<HTMLElement>('ul, ol')) {
                for (const name of owner.classList) {
                    const rule = /^\[(.+)\]:list-\[(\w+)\]$/.exec(name)
                    if (!rule) continue
                    const selector = rule[1]!.replaceAll('_', ' ').replaceAll('&', `.${CSS.escape(name)}`)
                    const steps = selector.split(' ').length
                    if (list.matches(selector) && steps > best.steps) best = { type: rule[2]!, steps }
                }
            }
            return best.type
        }

        it('shows disc, circle and square bullets for lists inside lists, as the PDF and Word do (B91)', () => {
            const { container } = preview('- one\n  - two\n    - three\n      - four')
            const lists = Array.from(container.querySelectorAll('ul'))
            expect(lists).toHaveLength(4)
            expect(lists.map((list) => bulletOf(list, container))).toEqual(['disc', 'circle', 'square', 'square'])
        })

        it('counts numbered lists as levels too, as the PDF and Word do (review)', () => {
            const { container } = preview('1. step\n   - detail\n     1. sub-step\n        - note')
            const lists = Array.from(container.querySelectorAll('ul'))
            expect(lists).toHaveLength(2)
            // A bullet list inside a numbered one is the second level, and one inside three lists is the third.
            expect(lists.map((list) => bulletOf(list, container))).toEqual(['circle', 'square'])
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

        it('prefixes heading ids as GitHub does, so they never clash with the app’s own ids (B05 review)', () => {
            const { container } = preview('# Export title\n\n## PDF profile')
            expect(Array.from(container.querySelectorAll('h1, h2')).map((heading) => heading.id)).toEqual([
                'user-content-export-title',
                'user-content-pdf-profile',
            ])
        })

        it('keeps footnote ids and the hidden footnotes heading', () => {
            const { container } = preview('Text[^1]\n\n[^1]: The note.')
            const label = container.querySelector('h2#user-content-footnote-label')
            expect(label).toHaveClass('sr-only')
            expect(container.querySelector('li#user-content-fn-1')).not.toBeNull()
            expect(container.querySelector('a[data-footnote-backref]')).toHaveAttribute('aria-label', 'Back to reference 1')
        })
    })

    it('lets Arabic and Hebrew text blocks take their own direction (B97)', () => {
        const { container } = preview(
            [
                '# مقدمة',
                '',
                'مرحبا بالعالم.',
                '',
                '- שלום',
                '',
                '> ציטוט',
                '',
                '| עמודה |',
                '| --- |',
                '| ערך |',
                '',
                '<p dir="ltr">Set by the document</p>',
            ].join('\n')
        )
        expect(container.querySelector('h1')).toHaveAttribute('dir', 'auto')
        expect(screen.getByText('مرحبا بالعالم.')).toHaveAttribute('dir', 'auto')
        expect(container.querySelector('li')).toHaveAttribute('dir', 'rtl')
        const quote = container.querySelector('blockquote')!
        expect(quote).toHaveAttribute('dir', 'rtl')
        // The bar is on the start side, so it moves to the right of a right-to-left quote.
        expect(quote).toHaveClass('border-s-2')
        expect(quote).not.toHaveClass('border-l-2')
        expect(container.querySelector('th')).toHaveAttribute('dir', 'auto')
        expect(container.querySelector('td')).toHaveAttribute('dir', 'auto')
        expect(screen.getByText('Set by the document')).toHaveAttribute('dir', 'ltr')
    })

    it('turns a quote or list item right to left from its first letter, and indents each item from its own side', () => {
        const { container } = preview(['> Plain quote', '', '- שלום', '', '- second item', '', '1. مرحبا'].join('\n'))
        // dir="auto" can't see into the item's own paragraph, so the first letter decides.
        expect(screen.getByText('שלום')).toHaveAttribute('dir', 'auto')
        const [hebrew, latin, arabic] = Array.from(container.querySelectorAll('li'))
        expect(hebrew).toHaveAttribute('dir', 'rtl')
        expect(latin).toHaveAttribute('dir', 'auto')
        expect(arabic).toHaveAttribute('dir', 'rtl')
        expect(container.querySelector('blockquote')).toHaveAttribute('dir', 'auto')
        // The indent follows each item's direction; the list has none of its own.
        expect(hebrew).toHaveClass('ms-5')
        expect(container.querySelector('ul')).not.toHaveClass('ps-5')
        expect(container.querySelector('ol')).not.toHaveClass('ps-5')
    })

    it('keeps code and diagrams left to right inside a right-to-left list item, as the PDF does (N31)', () => {
        const { container } = preview(
            [
                '1. הרץ את הפקודה:',
                '   ```bash',
                '   echo "hi";',
                '   ```',
                '',
                '- שלום',
                '',
                '  ```mermaid',
                '  graph TD; A-->B;',
                '  ```',
                '',
                '- עוד',
                '',
                '  <pre>ls -la;</pre>',
            ].join('\n')
        )
        const [command, diagram, raw] = Array.from(container.querySelectorAll('li'))
        expect(command).toHaveAttribute('dir', 'rtl')
        // The block's frame, with its Copy button.
        expect(command!.querySelector('div.overflow-x-auto')?.parentElement).toHaveAttribute('dir', 'ltr')
        expect(diagram).toHaveAttribute('dir', 'rtl')
        expect(diagram!.querySelector('[data-mermaid-block-id]')).toHaveAttribute('dir', 'ltr')
        expect(raw!.querySelector('pre')).toHaveAttribute('dir', 'ltr')
        // A direction the document's own HTML gives still wins.
        expect(preview('<pre dir="rtl">שורה</pre>').container.querySelector('pre')).toHaveAttribute('dir', 'rtl')
    })

    it('tags the document with its language, as the PDF is, so kanji take Japanese glyph shapes (B104)', () => {
        const { container, rerender } = preview('# 会議の議事録\n\n今日は新しい機能について話し合いました。')
        expect(container.querySelector('article')).toHaveAttribute('lang', 'ja')

        rerender(<MarkdownPreview source={'---\nlang: zh-Hant\n---\n# 會議記錄'} tabId="doc.md" {...callbacks} />)
        expect(container.querySelector('article')).toHaveAttribute('lang', 'zh-Hant')

        rerender(<MarkdownPreview source="# Notes" tabId="doc.md" {...callbacks} />)
        expect(container.querySelector('article')).toHaveAttribute('lang', 'en')
    })

    describe('language', () => {
        const JAPANESE = '# 会議の議事録\n\n今日は新しい機能について話し合いました。次回までに資料を準備します。'
        const langOf = (source: string) => preview(source).container.querySelector('article')?.getAttribute('lang')

        it('uses the front matter’s lang: first, as export does', () => {
            expect(langOf(`---\nlang: zh-TW\n---\n${JAPANESE}`)).toBe('zh-TW')
            expect(langOf('---\nlang: ja\n---\nPlain English words.')).toBe('ja')
            // Not a language tag, so it is guessed.
            expect(langOf(`---\nlang: not a tag\n---\n${JAPANESE}`)).toBe('ja')
        })

        it('leaves code out of the guess, closed or not', () => {
            const code = '// 日本語のコメントです。これはコードの中です。\nconst x = 1'
            expect(langOf(`\`\`\`js\n${code}\n\`\`\``)).toBe('en')
            expect(langOf(`Intro.\n\n~~~~\n${code}\n~~~~~\n\nOutro.`)).toBe('en')
            expect(langOf(`Intro.\n\n\`\`\`\n${code}`)).toBe('en')
            // A shorter or different fence doesn't close the block, so the Japanese after it is still code.
            expect(langOf(`\`\`\`\`\n${code}\n\`\`\`\n~~~\n${code}\n\`\`\`\``)).toBe('en')
            // The prose around a closed block still counts.
            expect(langOf(`\`\`\`\nlet english = words + more + words\n\`\`\`\n\n${JAPANESE}`)).toBe('ja')
        })

        it('leaves image addresses, alt text, inline code and math out of the guess, as export does (#182)', () => {
            const note = '# 会議メモ\n\n今日の会議の内容をまとめます。画面を貼ります。'
            const images = [1, 2, 3, 4, 5].map((n) => `![image-20261114-09050${n}](assets/image-20261114-09050${n}.png)`).join('\n\n')
            expect(langOf(`${note}\n\n${images}`)).toBe('ja')
            expect(langOf(`${note}\n\n$$\n\\frac{d}{dt}\\frac{\\partial L}{\\partial \\dot{q}} - \\frac{\\partial L}{\\partial q} = 0\n$$`)).toBe(
                'ja'
            )
            expect(langOf(`${note} \`const value = someFunctionName(argument)\` と $E = mc^2 + someLongVariable$`)).toBe('ja')
            expect(langOf(`# 会议记录\n\n今天讨论了新的功能。\n\n${images}`)).toMatch(/^zh/)
        })

        it('tags the preview as export tags the PDF and Word file (#182)', () => {
            const image = '![image-20261114-090501](assets/image-20261114-090501.png)'
            const source = `# 会議メモ\n\n今日の内容です。\n\n${image}\n\n${image}\n\n$$\nE = mc^2\n$$`
            expect(buildExportDocument(source).lang).toBe('ja')
            expect(langOf(source)).toBe('ja')
        })
    })

    it('tags Scrivon’s own words in a blocked web image as English, but not the document’s alt text (review)', () => {
        const { container } = preview('# 会議の議事録\n\n今日は話し合いました。![](https://example.com/a.png) ![猫の写真](https://example.com/b.png)')
        expect(container.querySelector('article')).toHaveAttribute('lang', 'ja')
        expect(screen.getByRole('img', { name: 'Blocked web image: Image' })).toHaveAttribute('lang', 'en')
        expect(screen.getByRole('img', { name: 'Blocked web image: 猫の写真' })).not.toHaveAttribute('lang')
    })

    it('shows bold next to Japanese punctuation as bold, as export does (B76)', () => {
        const { container } = preview('**「重要」**です。これは**テスト。**です。')
        expect(Array.from(container.querySelectorAll('strong')).map((node) => node.textContent)).toEqual(['「重要」', 'テスト。'])
        expect(container).not.toHaveTextContent('**')
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
                    `Text <img src="${GIF}" onerror="alert(2)" alt="pic"> <a href="javascript:alert(3)" onclick="alert(4)">link</a>`,
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

        it('drops a <picture>’s <source>, so its srcset can’t load a web image beside a local <img> (review)', () => {
            const { container } = preview(
                [
                    '<picture><source srcset="https://tracker.example/p.png"><img src="data:image/png;base64,AAAA" alt="Local"></picture>',
                    '',
                    '<picture><source srcset="https://tracker.example/q.gif"><img src="data:image/gif;base64,R0lGOD" alt="Inline"></picture>',
                ].join('\n')
            )
            expect(container.querySelector('source')).toBeNull()
            expect(container.innerHTML).not.toContain('tracker.example')
            const images = Array.from(container.querySelectorAll('picture > img'))
            expect(images.map((img) => img.getAttribute('src'))).toEqual(['data:image/png;base64,AAAA', 'data:image/gif;base64,R0lGOD'])
        })

        it('shows inline data: images, as the PDF does, and still blanks other data: URLs (N21)', () => {
            preview(
                [
                    '![chart](data:image/png;base64,AAAA)',
                    '',
                    '<img src="data:image/gif;base64,R0lGOD" alt="raw">',
                    '',
                    '[page](data:text/html;base64,PHNjcmlwdD4=)',
                ].join('\n')
            )
            expect(screen.getByRole('img', { name: 'chart' })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
            expect(screen.getByRole('img', { name: 'raw' })).toHaveAttribute('src', 'data:image/gif;base64,R0lGOD')
            expect(screen.getByText('page').closest('a')?.getAttribute('href') ?? '').toBe('')
        })

        it('sizes an image by its height attribute when it has no width, as GitHub does (N25)', () => {
            preview(
                [
                    `<p align="center"><img src="${GIF}" height="80" alt="logo"></p>`,
                    '',
                    `<img src="${GIF}" height="64px" alt="px"> <img src="${GIF}" height="50%" alt="percent">`,
                    `<img src="${GIF}" width="100" height="80" alt="both"> <img src="${GIF}" height="tall" alt="odd"> <img src="${GIF}" alt="plain">`,
                    '',
                    `![markdown](${GIF})`,
                ].join('\n')
            )
            const logo = screen.getByRole('img', { name: 'logo' })
            expect(logo.style.height).toBe('80px')
            expect(logo.style.width).toBe('auto')
            expect(logo).toHaveClass('object-contain')
            expect(screen.getByRole('img', { name: 'px' }).style.height).toBe('64px')
            expect(screen.getByRole('img', { name: 'percent' }).style.height).toBe('50%')
            for (const name of ['both', 'odd', 'plain', 'markdown']) {
                const img = screen.getByRole('img', { name })
                expect({ name, height: img.style.height, contain: img.classList.contains('object-contain') }).toEqual({
                    name,
                    height: '',
                    contain: false,
                })
            }
            // One with a width is sized by its attributes, and keeps its shape (h-auto) on a narrower page.
            expect(screen.getByRole('img', { name: 'both' })).toHaveAttribute('width', '100')
            expect(screen.getByRole('img', { name: 'both' })).toHaveClass('h-auto', 'max-w-full')
        })

        it('keeps the document from taking over the app’s ids, document methods, shortcuts and Tab order', () => {
            const { container } = preview(`<img name="createElement" id="export-title" src="${GIF}" alt="x" accesskey="s" tabindex="1">`)
            const img = container.querySelector('img')!
            expect(img).toHaveAttribute('name', 'user-content-createElement')
            expect(img).toHaveAttribute('id', 'user-content-export-title')
            expect(img).not.toHaveAttribute('accesskey')
            expect(img).not.toHaveAttribute('tabindex')
            expect(typeof document.createElement).toBe('function')
        })

        it('keeps a raw table cell’s colspan, rowspan and dir, and a Markdown column’s alignment (review)', () => {
            const { container } = preview(
                [
                    '<table><tr><th colspan="2" scope="colgroup">Both</th></tr>',
                    '<tr><td rowspan="2" dir="rtl">שלום</td><td>a</td></tr><tr><td>b</td></tr></table>',
                    '',
                    '| Left | Middle | Right |',
                    '| :--- | :-: | --: |',
                    '| 1 | 2 | 3 |',
                ].join('\n')
            )
            const [both] = Array.from(container.querySelectorAll('th'))
            expect(both).toHaveAttribute('colspan', '2')
            expect(both).toHaveAttribute('scope', 'colgroup')
            const [merged] = Array.from(container.querySelectorAll('td'))
            expect(merged).toHaveAttribute('rowspan', '2')
            expect(merged).toHaveAttribute('dir', 'rtl')
            expect(merged).toHaveClass('px-3', 'py-2')
            const aligned = Array.from(container.querySelectorAll('td')).slice(-3)
            expect(aligned.map((cell) => cell.style.textAlign)).toEqual(['left', 'center', 'right'])
            expect(aligned[0]).toHaveAttribute('dir', 'auto')
        })

        it('keeps a raw <pre> of plain text as a block, with its spaces and line breaks (review)', () => {
            const { container } = preview('<pre>+--+\n|  | <b>box</b>\n+--+</pre>\n\nAfter.')
            const pre = container.querySelector('pre')!
            expect(pre).not.toBeNull()
            expect(pre.textContent).toBe('+--+\n|  | box\n+--+')
            expect(pre).toHaveClass('whitespace-pre', 'font-mono')
            expect(pre.querySelector('b')).toHaveTextContent('box')
        })

        it('shows the words of tags inside a raw <pre><code> block, not [object Object] (review)', () => {
            const { container } = preview('<pre><code>git <b>commit</b> -m "x"</code></pre>')
            expect(container).toHaveTextContent('git commit -m "x"')
            expect(container).not.toHaveTextContent('[object Object]')
        })

        it('numbers a diagram written as raw HTML the same way the viewer finds it', () => {
            const source = '<pre><code class="language-mermaid">graph LR\n  A --> B</code></pre>\n\n```mermaid\nflowchart TD\n```'
            preview(source)
            expect(screen.getAllByRole('button', { name: /^Expand diagram/ })).toHaveLength(2)
            expect(extractMermaidBlockSources(source)).toEqual(['graph LR\n  A --> B', 'flowchart TD'])
            expect(lastMermaidBlockSources('doc.md')).toEqual(['graph LR\n  A --> B', 'flowchart TD'])
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
        const sources = lastMermaidBlockSources('doc.md') ?? []
        expect(sources).toEqual(['flowchart TD', 'flowchart LR', 'pie'])
        expect(extractMermaidBlockSources(source)).toEqual(sources)
        expect(onExpandBlock.mock.calls).toEqual(sources.map((blockSource, ordinal) => [expect.any(String), ordinal, blockSource]))
        // Each block has its own id, which doesn't come from its position.
        const ids = onExpandBlock.mock.calls.map(([blockId]) => blockId as string)
        expect(new Set(ids).size).toBe(3)
        expect(ids.every((id) => id.startsWith('doc.md:'))).toBe(true)
    })

    describe('images from the open folder (F02)', () => {
        const ROOT = 'C:\\notes'
        const DOC = 'C:\\notes\\guides\\setup.md'

        function inFolder(source: string) {
            return render(<MarkdownPreview source={source} tabId={DOC} documentPath={DOC} workspaceRoot={ROOT} {...callbacks} />)
        }

        /** Waits for the image to show this picture (it is an empty `<img>` while the file is read). */
        async function shows(name: string, src: string) {
            await waitFor(() => expect(screen.getByRole('img', { name })).toHaveAttribute('src', src))
        }

        beforeEach(() => {
            vi.mocked(isTauri).mockReturnValue(true)
            vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
                if (command !== 'read_workspace_image') return undefined
                const { path } = args as { path: string }
                if (path.includes('missing')) throw 'Image not found.'
                return `data:image/png;base64,${path.split('\\').pop()}`
            })
        })

        afterEach(() => {
            vi.mocked(isTauri).mockReturnValue(false)
            vi.mocked(invoke).mockReset()
        })

        it('shows images next to the document, above it and by full path, fitted to the page width', async () => {
            inFolder(['![Here](diagram.png)', '', '![Above](../img/up.png)', '', '<img src="C:\\notes\\full.png" alt="Full" width="900">'].join('\n'))

            await shows('Here', 'data:image/png;base64,diagram.png')
            await shows('Above', 'data:image/png;base64,up.png')
            await shows('Full', 'data:image/png;base64,full.png')
            const full = screen.getByRole('img', { name: 'Full' })
            expect(full).toHaveAttribute('width', '900')
            expect(full).toHaveClass('max-w-full', 'h-auto')
            expect(invoke).toHaveBeenCalledWith('read_workspace_image', { root: ROOT, path: 'C:\\notes\\img\\up.png' })
        })

        it('names the path of an image that can’t be shown, and why', async () => {
            inFolder('![Gone](img/missing%20one.png) and ![Out](../../secret.png)')

            const missing = await screen.findByRole('img', { name: 'Image not shown: Gone (img/missing one.png). Image not found.' })
            expect(missing).toHaveTextContent('img/missing one.png')
            expect(missing).toHaveAttribute('title', 'C:\\notes\\guides\\img\\missing one.png\nImage not found.')
            const outside = screen.getByRole('img', {
                name: 'Image not shown: Out (../../secret.png). Only images inside the open folder are shown.',
            })
            expect(outside).toHaveAttribute('title', 'Only images inside the open folder are shown.')
            // Never asked for.
            expect(invoke).toHaveBeenCalledTimes(1)
        })

        it('says the writer’s alt text in the document’s language, and only Scrivon’s words in English', async () => {
            render(
                <MarkdownPreview
                    source={'---\nlang: ja\n---\n![猫の写真](missing-cat.png) <img src="missing-dog.png">'}
                    tabId={DOC}
                    documentPath={DOC}
                    workspaceRoot={ROOT}
                    {...callbacks}
                />
            )

            const withAlt = await screen.findByRole('img', { name: 'Image not shown: 猫の写真 (missing-cat.png). Image not found.' })
            expect(withAlt).not.toHaveAttribute('lang')
            expect(within(withAlt).getByText('Image not found.')).toHaveAttribute('lang', 'en')
            expect(await screen.findByRole('img', { name: 'Image not shown: missing-dog.png. Image not found.' })).toHaveAttribute('lang', 'en')
        })

        it('shows a new picture when the file changes on disk', async () => {
            inFolder('![Live](live.png)')
            await shows('Live', 'data:image/png;base64,live.png')

            let finishRead: (url: string) => void = () => {}
            vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => (finishRead = resolve)))
            act(() => forgetWorkspaceImages(['C:\\notes\\guides\\live.png']))
            // The old picture stays while the new one is read, so it doesn't flicker.
            expect(screen.getByRole('img', { name: 'Live' })).toHaveAttribute('src', 'data:image/png;base64,live.png')
            await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
            act(() => finishRead('data:image/png;base64,EDITED'))

            await shows('Live', 'data:image/png;base64,EDITED')
        })

        it('shows an image it has read before straight away', async () => {
            const { unmount } = inFolder('![Again](again.png)')
            await shows('Again', 'data:image/png;base64,again.png')
            unmount()

            inFolder('![Again](again.png)')
            expect(screen.getByRole('img', { name: 'Again' })).toHaveAttribute('src', 'data:image/png;base64,again.png')
        })

        it('asks to save a document that isn’t on disk before it shows its images', () => {
            preview('![Draft](draft.png)')
            expect(
                screen.getByRole('img', { name: 'Image not shown: Draft (draft.png). Save the document in the open folder to show its images.' })
            ).toBeInTheDocument()
        })

        it('names an image with no address by its alt text, and keeps an address it can’t decode as written', async () => {
            inFolder('![Logo](javascript:alert(1)) ![]() <img src="missing-100%.png">')

            expect(screen.getByRole('img', { name: 'Image not shown: Logo. The image has no address.' })).toBeInTheDocument()
            expect(screen.getByRole('img', { name: 'Image not shown: Image. The image has no address.' })).toBeInTheDocument()
            expect(await screen.findByRole('img', { name: 'Image not shown: missing-100%.png. Image not found.' })).toBeInTheDocument()
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

describe('MarkdownPreview: GitHub alerts, math and quotes', () => {
    it('shows an alert as a note with its title instead of the marker', () => {
        preview('> [!WARNING]\n> Back up first.')
        const note = screen.getByRole('note')
        expect(note).toHaveTextContent(/^Warning\s*Back up first\.$/)
        expect(note).toHaveClass('markdown-alert-warning')
        expect(note.querySelector('svg')).not.toBeNull()
    })

    it('puts the bar of a right-to-left alert on the right', () => {
        preview('> [!NOTE]\n> שלום')
        expect(screen.getByRole('note')).toHaveAttribute('dir', 'rtl')
    })

    it('shows inline and block math as MathML', () => {
        const { container } = preview('Inline $E = mc^2$ here.\n\n$$\n\\frac{1}{3}\n$$')
        const maths = container.querySelectorAll('math')
        expect(maths).toHaveLength(2)
        expect(maths[0]!.querySelector('msup')).not.toBeNull()
        expect(maths[1]!.namespaceURI).toBe('http://www.w3.org/1998/Math/MathML')
        expect(maths[1]!.getAttribute('display')).toBe('block')
        expect(container).not.toHaveTextContent('$')
    })

    it('leaves prices as text', () => {
        const { container } = preview('It costs $5 and $10.')
        expect(container.querySelector('math')).toBeNull()
        expect(container).toHaveTextContent('It costs $5 and $10.')
    })

    it('keeps bold and links between two prices', () => {
        const { container } = preview('Plans: $5 for **Basic**, $10 for [Pro](https://example.com).')
        expect(container.querySelector('strong')).toHaveTextContent('Basic')
        expect(screen.getByRole('link', { name: 'Pro' })).toBeInTheDocument()
        expect(container).toHaveTextContent('Plans: $5 for Basic, $10 for Pro.')
    })

    it('gives block math the text size and space below of a paragraph', () => {
        const { container } = preview('$$\nx^2\n$$\n\nNext.')
        // Block math isn't in a paragraph, so the article styles it. happy-dom can't compute Tailwind styles.
        expect(container.querySelector('math[display="block"]')!.closest('p')).toBeNull()
        expect(container.querySelector('article')).toHaveClass('[&_math[display=block]]:mb-3', '[&_math[display=block]]:text-sm')
    })

    it('shows the bundled showcase’s math and alerts', () => {
        const { container } = preview(MARKDOWN_SHOWCASE.source)
        expect(container.querySelectorAll('math')).toHaveLength(2)
        expect(screen.getAllByRole('note').map((note) => note.querySelector('p')?.textContent)).toEqual([
            'Note',
            'Tip',
            'Important',
            'Warning',
            'Caution',
        ])
        expect(container).not.toHaveTextContent('[!NOTE]')
    })

    it('greys all of a quote, not just the quote itself', () => {
        const { container } = preview('> Quoted words')
        // The paragraph's own colour would win over the quote's, so the quote makes its paragraphs and lists use its own.
        expect(container.querySelector('blockquote')).toHaveClass('text-muted-foreground', '[&_:is(p,ul,ol,td)]:text-inherit')
    })
})
