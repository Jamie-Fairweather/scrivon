import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { notifyInfo } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'
import { MarkdownExpandProvider } from './markdown-expand-context'
import { MarkdownDocumentViewer } from './markdown-document-viewer'

const workspace = vi.hoisted(() => ({
    tabs: [] as DocumentTab[],
    openFile: vi.fn(async (path: string) => {
        void path
    }),
    workspaceRoot: 'C:\\notes' as string | null,
    tree: [] as FileNode[],
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useCanvasFit: () => ({ canvasFitRequestId: 0, requestCanvasFit: () => {} }),
    useDocumentTabs: () => ({ tabs: workspace.tabs, openFile: workspace.openFile }),
    useWorkspaceSession: () => ({ workspaceRoot: workspace.workspaceRoot, tree: workspace.tree }),
}))

vi.mock('@/components/studio/canvas/mermaid-canvas', () => ({
    MermaidCanvas: ({ source }: { source: string }) => <div data-testid="expanded-canvas">{source}</div>,
}))

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

vi.mock('@tauri-apps/plugin-opener', () => ({
    openUrl: vi.fn(async () => undefined),
    revealItemInDir: vi.fn(async () => undefined),
}))

vi.mock('@/lib/notify', () => ({
    notifyInfo: vi.fn(() => 'id'),
    notifyError: vi.fn(() => 'id'),
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

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

const DOC_A = 'C:\\notes/a.md'
const DOC_OTHER = 'C:\\notes/docs/other.md'

function fileTab(path: string, content = ''): DocumentTab {
    return { id: path, path, name: path.split(/[/\\]/).pop()!, content, isDirty: false, isSaving: false }
}

function fileNode(path: string): FileNode {
    return { kind: 'file', name: path.split(/[/\\]/).pop()!, path }
}

function viewer(tabId: string, source: string) {
    return (
        <MarkdownExpandProvider tabId={tabId}>
            <MarkdownDocumentViewer tabId={tabId} source={source} />
        </MarkdownExpandProvider>
    )
}

function viewport(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
}

describe('MarkdownDocumentViewer', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>

    beforeEach(() => {
        // happy-dom has no Web Animations API; Base UI's scroll area calls it after scrolling.
        if (!Element.prototype.getAnimations) Element.prototype.getAnimations = () => []
        workspace.tabs = [fileTab(DOC_A)]
        workspace.workspaceRoot = 'C:\\notes'
        workspace.tree = []
        scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
    })

    afterEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('shows the new tab’s document straight away when switching tabs', () => {
        const { container, rerender } = render(viewer('a.md', '# Alpha'))
        rerender(viewer('b.md', '# Beta'))
        expect(container.querySelector('h1')).toHaveTextContent('Beta')
    })

    it('parses the document once per edit, not again for the text it is about to replace', async () => {
        const { container, rerender } = render(viewer(DOC_A, '# One'))
        await nextFrame()
        const parses = markdownParses.count

        rerender(viewer(DOC_A, '# Two'))
        expect(markdownParses.count).toBe(parses)

        await nextFrame()
        expect(container.querySelector('h1')).toHaveTextContent('Two')
        expect(markdownParses.count).toBe(parses + 1)
    })

    it('waits for a pause in typing before updating the preview of a large document', async () => {
        vi.useFakeTimers()
        try {
            const filler = 'Lorem ipsum dolor sit amet.\n\n'.repeat(400)
            const { container, rerender } = render(viewer(DOC_A, `# One\n\n${filler}`))
            rerender(viewer(DOC_A, `# Two\n\n${filler}`))
            act(() => vi.advanceTimersByTime(100))
            expect(container.querySelector('h1')).toHaveTextContent('One')

            act(() => vi.advanceTimersByTime(100))
            expect(container.querySelector('h1')).toHaveTextContent('Two')
        } finally {
            vi.useRealTimers()
        }
    })

    it('remembers the preview scroll position for each tab', () => {
        const { container, rerender } = render(viewer('a.md', '# Alpha'))
        const scroller = viewport(container)
        scroller.scrollTop = 300
        fireEvent.scroll(scroller)

        rerender(viewer('b.md', '# Beta'))
        expect(viewport(container)).toBe(scroller)
        expect(scroller.scrollTop).toBe(0)

        rerender(viewer('a.md', '# Alpha'))
        expect(scroller.scrollTop).toBe(300)
    })

    describe('web images', () => {
        const withImages = [
            '![Tracker](https://tracker.example/pixel.png?id=1)',
            '',
            '[![Build badge](//badges.example/build.svg)](https://ci.example)',
            '',
            '![Local](./diagram.png)',
            '',
            // The webview reads this as https://sneaky.example/pixel.png.
            '![Sneaky](https:sneaky.example/pixel.png)',
        ].join('\n')

        it('blocks web images until asked, and keeps local ones', () => {
            const { container } = render(viewer(DOC_A, withImages))

            expect(container.querySelector('img[src^="https:"], img[src^="//"]')).toBeNull()
            expect(screen.getByRole('img', { name: 'Blocked web image: Tracker' })).toHaveAttribute('title', 'https://tracker.example/pixel.png?id=1')
            expect(screen.getByRole('link', { name: 'Blocked web image: Build badge' })).toHaveAttribute('href', 'https://ci.example')
            expect(screen.getByRole('img', { name: 'Blocked web image: Sneaky' })).toBeInTheDocument()
            expect(container.querySelectorAll('img')).toHaveLength(1)
            expect(container.querySelector('img[src="./diagram.png"]')).not.toBeNull()

            fireEvent.click(screen.getByRole('button', { name: 'Load images' }))

            expect(container.querySelector('img[src="https://tracker.example/pixel.png?id=1"]')).toHaveAttribute('referrerpolicy', 'no-referrer')
            expect(container.querySelector('img[src="//badges.example/build.svg"]')).not.toBeNull()
            expect(container.querySelector('img[src="https:sneaky.example/pixel.png"]')).toHaveAttribute('referrerpolicy', 'no-referrer')
            expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull()
        })

        it('keeps diagrams and code blocks as they are when web images load', () => {
            const { container } = render(viewer(DOC_A, `${withImages}\n\n\`\`\`mermaid\nflowchart TD\n\`\`\`\n\n\`\`\`js\nconst a = 1\n\`\`\``))
            const diagram = container.querySelector('[data-mermaid-block-id]')
            const code = container.querySelector('[data-mode]')
            expect(diagram).not.toBeNull()
            expect(code).not.toBeNull()
            const parses = markdownParses.count

            fireEvent.click(screen.getByRole('button', { name: 'Load images' }))
            expect(container.querySelector('img[src="https://tracker.example/pixel.png?id=1"]')).not.toBeNull()
            // The same elements, not new ones: nothing reloads, and the page keeps its height.
            expect(container.querySelector('[data-mermaid-block-id]')).toBe(diagram)
            expect(container.querySelector('[data-mode]')).toBe(code)
            expect(markdownParses.count).toBe(parses)
        })

        it('shows the notice only for documents that have blocked web images', () => {
            render(viewer(DOC_A, '![Local](./diagram.png)'))
            expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull()
        })

        it('remembers the choice for each document', () => {
            const { container, rerender } = render(viewer(DOC_A, withImages))
            fireEvent.click(screen.getByRole('button', { name: 'Load images' }))

            rerender(viewer(DOC_OTHER, withImages))
            expect(container.querySelector('img[src^="https:"]')).toBeNull()
            expect(screen.getByRole('button', { name: 'Load images' })).toBeInTheDocument()

            rerender(viewer(DOC_A, withImages))
            expect(container.querySelector('img[src^="https:"]')).not.toBeNull()
            expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull()
        })
    })

    describe('expanded diagram', () => {
        const twoDiagrams = [
            '# Diagrams',
            '',
            '[a link](#diagrams)',
            '',
            '```mermaid',
            'flowchart TD',
            '  A --> B',
            '```',
            '',
            '```mermaid',
            'flowchart LR',
            '  accTitle: Login flow',
            '  C --> D',
            '```',
        ].join('\n')

        it('gives every Expand button its own name', () => {
            render(viewer(DOC_A, twoDiagrams))
            expect(screen.getByRole('button', { name: 'Expand diagram 1' })).toBeInTheDocument()
            expect(screen.getByRole('button', { name: 'Expand diagram 2: Login flow' })).toBeInTheDocument()
        })

        it('moves focus in, hides the preview behind it, and closes on Escape with focus restored', () => {
            const { container } = render(viewer(DOC_A, twoDiagrams))
            const expand = screen.getByRole('button', { name: 'Expand diagram 2: Login flow' })
            expand.focus()
            fireEvent.click(expand)

            const back = screen.getByRole('button', { name: 'Back to document preview' })
            expect(screen.getByRole('region', { name: 'Expanded diagram' })).toBeInTheDocument()
            expect(back).toHaveFocus()
            expect(viewport(container).closest('[inert]')).not.toBeNull()

            fireEvent.keyDown(back, { key: 'Escape' })
            expect(screen.queryByRole('region', { name: 'Expanded diagram' })).toBeNull()
            expect(container.querySelector('[inert]')).toBeNull()
            expect(screen.getByRole('button', { name: 'Expand diagram 2: Login flow' })).toHaveFocus()
        })

        it('follows edits to the expanded block, and closes when it is deleted', async () => {
            const { rerender } = render(viewer(DOC_A, twoDiagrams))
            fireEvent.click(screen.getByRole('button', { name: 'Expand diagram 1' }))
            expect(screen.getByTestId('expanded-canvas').textContent).toBe('flowchart TD\n  A --> B')

            const edited = twoDiagrams.replace('A --> B', 'A --> Changed')
            rerender(viewer(DOC_A, edited))
            await waitFor(() => expect(screen.getByTestId('expanded-canvas').textContent).toBe('flowchart TD\n  A --> Changed'))

            const withNewBlockAbove = edited.replace('# Diagrams', '# Diagrams\n\n```mermaid\npie\n  "x": 1\n```')
            rerender(viewer(DOC_A, withNewBlockAbove))
            await waitFor(() => expect(screen.getAllByRole('button', { name: /^Expand diagram/ })).toHaveLength(3))
            expect(screen.getByTestId('expanded-canvas').textContent).toBe('flowchart TD\n  A --> Changed')

            rerender(viewer(DOC_A, withNewBlockAbove.replace('```mermaid\nflowchart TD\n  A --> Changed\n```', '')))
            await waitFor(() => expect(screen.queryByTestId('expanded-canvas')).toBeNull())
        })

        it('returns focus to the Expand button after Back', () => {
            render(viewer(DOC_A, twoDiagrams))
            const expand = screen.getByRole('button', { name: 'Expand diagram 1' })
            expand.focus()
            fireEvent.click(expand)
            const back = screen.getByRole('button', { name: 'Back to document preview' })
            back.focus()
            fireEvent.click(back)
            expect(expand).toHaveFocus()
        })
    })

    describe('links', () => {
        const source = [
            '# Install steps',
            '',
            'See [below](#install-steps), [setup](docs/other.md#part), [site](https://example.com),',
            '[chart](img/chart.png) and [spec](C:\\specs\\a.md).[^1]',
            '',
            '[^1]: A note.',
        ].join('\n')

        it('keeps heading and footnote ids and never uses target=_blank', () => {
            const { container } = render(viewer(DOC_A, source))
            expect(container.querySelector('h1')).toHaveAttribute('id', 'install-steps')
            expect(container.querySelector('#user-content-fn-1')).not.toBeNull()
            expect(container.querySelector('#footnote-label')).toHaveClass('sr-only')
            expect(container.querySelector('a[target]')).toBeNull()
        })

        it('opens absolute Windows path links inside the open folder, under the explorer’s path for the file', () => {
            workspace.tree = [{ kind: 'directory', name: 'docs', path: 'C:\\notes/docs', children: [fileNode('C:\\notes/docs/Other.md')] }]
            render(viewer(DOC_A, String.raw`[spec](C:\\NOTES\\docs\\other.md) and [new](C:\\notes\\docs\\sub\\new.md)`))
            fireEvent.click(screen.getByRole('link', { name: 'spec' }))
            expect(workspace.openFile).toHaveBeenLastCalledWith('C:\\notes/docs/Other.md')

            // Not listed (yet): the explorer's form of its path.
            fireEvent.click(screen.getByRole('link', { name: 'new' }))
            expect(workspace.openFile).toHaveBeenLastCalledWith('C:\\notes/docs/sub/new.md')
        })

        it('opens a relative link written in other letter case in the file’s own tab', () => {
            workspace.tree = [fileNode('C:\\notes/setup.md')]
            render(viewer(DOC_A, '[setup](Setup.MD)'))
            fireEvent.click(screen.getByRole('link', { name: 'setup' }))
            expect(workspace.openFile).toHaveBeenCalledWith('C:\\notes/setup.md')
        })

        it('explains a link to a document outside the open folder, and offers to show it', () => {
            render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'spec' }))
            expect(workspace.openFile).not.toHaveBeenCalled()
            expect(notifyInfo).toHaveBeenCalledWith('That file is outside the open folder', expect.objectContaining({ action: expect.anything() }))

            const [, options] = vi.mocked(notifyInfo).mock.calls[0]!
            options?.action?.onClick()
            expect(revealItemInDir).toHaveBeenCalledWith('C:\\specs\\a.md')
        })

        it('scrolls to #anchors and footnotes inside the preview', () => {
            const { container } = render(viewer(DOC_A, source))
            const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'below' }))
            expect(notPrevented).toBe(false)
            expect(scrollIntoView).toHaveBeenCalledTimes(1)
            expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('h1'))

            fireEvent.click(container.querySelector('a[data-footnote-ref]')!)
            expect(scrollIntoView.mock.contexts[1]).toBe(container.querySelector('#user-content-fn-1'))
            expect(openUrl).not.toHaveBeenCalled()
        })

        it('follows a README’s GitHub-style table of contents', () => {
            const readme = [
                '- [a](#foo--bar)',
                '- [b](#install---windows)',
                '- [c](#-quick-start)',
                '- [d](#%C3%BCber)',
                '',
                '## Foo & Bar',
                '## Install - Windows',
                '## 🚀 Quick start',
                '## Über',
            ].join('\n')
            const { container } = render(viewer(DOC_A, readme))
            const headings = Array.from(container.querySelectorAll('h2'))
            for (const name of ['a', 'b', 'c', 'd']) fireEvent.click(screen.getByRole('link', { name }))
            expect(notifyInfo).not.toHaveBeenCalled()
            expect(scrollIntoView.mock.contexts).toEqual(headings)
        })

        it('tells the user when an anchor has no target', () => {
            render(viewer(DOC_A, '[missing](#nowhere)'))
            fireEvent.click(screen.getByRole('link', { name: 'missing' }))
            expect(scrollIntoView).not.toHaveBeenCalled()
            expect(notifyInfo).toHaveBeenCalledWith("Couldn't find that section", { description: '#nowhere' })
        })

        it('opens linked documents in a tab and then scrolls to their #fragment', () => {
            const { container, rerender } = render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'setup' }))
            expect(workspace.openFile).toHaveBeenCalledWith(DOC_OTHER)
            expect(openUrl).not.toHaveBeenCalled()

            workspace.tabs = [fileTab(DOC_A), fileTab(DOC_OTHER)]
            rerender(viewer(DOC_OTHER, '# Intro\n\n## Part'))
            expect(scrollIntoView).toHaveBeenCalledTimes(1)
            expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('h2#part'))
        })

        it('reuses the open tab for a linked document written with other separators', () => {
            workspace.tabs = [fileTab(DOC_A), fileTab('C:\\notes\\docs\\other.md')]
            render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'setup' }))
            expect(workspace.openFile).toHaveBeenCalledWith('C:\\notes\\docs\\other.md')
        })

        it('routes a middle click like a click, instead of opening a new window', () => {
            vi.mocked(isTauri).mockReturnValue(true)
            render(viewer(DOC_A, source))
            const link = screen.getByRole('link', { name: 'site' })
            const notPrevented = fireEvent(link, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }))
            expect(notPrevented).toBe(false)
            expect(openUrl).toHaveBeenCalledWith('https://example.com')

            fireEvent(link, new MouseEvent('auxclick', { button: 2, bubbles: true, cancelable: true }))
            expect(openUrl).toHaveBeenCalledTimes(1)
        })

        it('opens web links in the system browser', () => {
            vi.mocked(isTauri).mockReturnValue(true)
            render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'site' }))
            expect(openUrl).toHaveBeenCalledWith('https://example.com')
        })

        it('shows other linked files in the file explorer instead of running them', () => {
            render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'chart' }))
            expect(revealItemInDir).toHaveBeenCalledWith('C:\\notes/img/chart.png')
            expect(workspace.openFile).not.toHaveBeenCalled()
        })

        it('never looks up a link to another computer’s shared folder', () => {
            // In Markdown `\\` is one backslash, so `\\\\evil` is how a document spells `\\evil`.
            render(viewer(DOC_A, String.raw`[Setup guide](\\\\evil\\share\\setup.exe) and [notes](//evil/share/notes.md)`))
            fireEvent.click(screen.getByRole('link', { name: 'Setup guide' }))
            fireEvent.click(screen.getByRole('link', { name: 'notes' }))
            expect(revealItemInDir).not.toHaveBeenCalled()
            expect(workspace.openFile).not.toHaveBeenCalled()
            expect(openUrl).not.toHaveBeenCalled()
            expect(notifyInfo).toHaveBeenCalledTimes(2)
            expect(notifyInfo).toHaveBeenCalledWith("Network links aren't opened", expect.anything())
        })

        it('explains when a relative link has no folder to resolve against', () => {
            workspace.tabs = [{ ...fileTab('example:intro'), readOnly: true }]
            render(viewer('example:intro', '[next](next.md)'))
            fireEvent.click(screen.getByRole('link', { name: 'next' }))
            expect(workspace.openFile).not.toHaveBeenCalled()
            expect(notifyInfo).toHaveBeenCalledWith("Can't follow this link", expect.anything())
        })
    })
})
