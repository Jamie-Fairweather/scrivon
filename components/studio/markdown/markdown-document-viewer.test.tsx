import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { notifyInfo } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import type { DocumentTab } from '@/lib/workspace/types'
import { MarkdownExpandProvider } from './markdown-expand-context'
import { MarkdownDocumentViewer } from './markdown-document-viewer'

const workspace = vi.hoisted(() => ({
    tabs: [] as DocumentTab[],
    openFile: vi.fn(async (path: string) => {
        void path
    }),
    workspaceRoot: 'C:\\notes' as string | null,
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useCanvasFit: () => ({ canvasFitRequestId: 0, requestCanvasFit: () => {} }),
    useDocumentTabs: () => ({ tabs: workspace.tabs, openFile: workspace.openFile }),
    useWorkspaceSession: () => ({ workspaceRoot: workspace.workspaceRoot }),
}))

vi.mock('@/components/studio/canvas/mermaid-canvas', () => ({
    MermaidCanvas: ({ source }: { source: string }) => <div data-testid="expanded-canvas">{source}</div>,
}))

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ svgForDisplay: null, dimensions: null, error: null, isPending: false }),
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

        it('opens absolute Windows path links', () => {
            render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'spec' }))
            expect(workspace.openFile).toHaveBeenCalledWith('C:\\specs\\a.md')
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

        it('explains when a relative link has no folder to resolve against', () => {
            workspace.tabs = [{ ...fileTab('example:intro'), readOnly: true }]
            render(viewer('example:intro', '[next](next.md)'))
            fireEvent.click(screen.getByRole('link', { name: 'next' }))
            expect(workspace.openFile).not.toHaveBeenCalled()
            expect(notifyInfo).toHaveBeenCalledWith("Can't follow this link", expect.anything())
        })
    })
})
