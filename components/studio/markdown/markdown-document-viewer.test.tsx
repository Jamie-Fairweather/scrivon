import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { notifyInfo } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'
import { MarkdownExpandProvider } from './markdown-expand-context'
import { MarkdownDocumentViewer } from './markdown-document-viewer'
import { extractMermaidBlockSources } from './mermaid-block-sources'

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

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
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

vi.mock('./mermaid-block-sources', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./mermaid-block-sources')>()
    return { ...actual, extractMermaidBlockSources: vi.fn(actual.extractMermaidBlockSources) }
})

const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

/** A tiny inline picture, which shows without the app reading a file. */
const GIF = 'data:image/gif;base64,R0lGOD'
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

/** What StudioLayout shows for a diagram tab: the provider stays, the Markdown preview goes. */
function diagramTab(tabId: string) {
    return (
        <MarkdownExpandProvider tabId={tabId}>
            <div data-testid="diagram-canvas" />
        </MarkdownExpandProvider>
    )
}

function viewport(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!
}

describe('MarkdownDocumentViewer', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>

    beforeEach(() => {
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

    describe('empty document (U81)', () => {
        const EMPTY_MESSAGE = 'Start writing Markdown to see a preview.'

        it('says how to get a preview instead of showing a blank page', () => {
            for (const source of ['', '  \n\t\r\n  ', '---\ntitle: Draft\n---\n\n']) {
                const { container, unmount } = render(viewer(DOC_A, source))
                expect({ source, shown: screen.queryByText(EMPTY_MESSAGE) !== null }).toEqual({ source, shown: true })
                expect(container.querySelector('article')).toBeNull()
                unmount()
            }
        })

        it('shows the document in its place once it has content, and the message again when it is cleared', async () => {
            const { container, rerender } = render(viewer(DOC_A, ''))
            expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument()

            rerender(viewer(DOC_A, '# Hello'))
            await nextFrame()
            expect(container.querySelector('h1')).toHaveTextContent('Hello')
            expect(screen.queryByText(EMPTY_MESSAGE)).toBeNull()

            rerender(viewer(DOC_A, ' \n'))
            await nextFrame()
            expect(container.querySelector('h1')).toBeNull()
            expect(screen.getByText(EMPTY_MESSAGE)).toBeInTheDocument()
        })
    })

    describe('a document the preview can’t show (N72)', () => {
        // Thousands of nested quotes overflow the parser's stack, inside the preview's render.
        const TOO_DEEP = `${'>'.repeat(5000)} x`

        beforeEach(() => {
            // React and the boundary both log the caught error.
            vi.spyOn(console, 'error').mockImplementation(() => {})
        })

        afterEach(() => vi.restoreAllMocks())

        it('says so in the preview alone, and shows the document again once it is edited', async () => {
            const { container, rerender } = render(viewer(DOC_A, '# Fine'))
            const scroller = viewport(container)

            rerender(viewer(DOC_A, TOO_DEEP))
            await nextFrame()
            expect(screen.getByText("Couldn't show the preview")).toBeInTheDocument()
            expect(screen.getByText('Edit the document to try again.')).toBeInTheDocument()
            expect(viewport(container)).toBe(scroller)

            rerender(viewer(DOC_A, '# Fixed'))
            await nextFrame()
            expect(container.querySelector('h1')).toHaveTextContent('Fixed')
            expect(screen.queryByText("Couldn't show the preview")).toBeNull()
        })

        it('shows another tab’s document as usual', async () => {
            workspace.tabs = [fileTab(DOC_A), fileTab(DOC_OTHER)]
            const { container, rerender } = render(viewer(DOC_A, TOO_DEEP))
            expect(screen.getByText("Couldn't show the preview")).toBeInTheDocument()

            rerender(viewer(DOC_OTHER, '# Other'))
            await nextFrame()
            expect(container.querySelector('h1')).toHaveTextContent('Other')
        })
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
        workspace.tabs = [fileTab('a.md'), fileTab('b.md')]
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

    it('still remembers it after a diagram tab was shown in its place', () => {
        workspace.tabs = [fileTab('a.md'), fileTab('x.mmd')]
        const { container, rerender } = render(viewer('a.md', '# Alpha'))
        viewport(container).scrollTop = 300
        fireEvent.scroll(viewport(container))

        rerender(diagramTab('x.mmd'))
        expect(screen.getByTestId('diagram-canvas')).toBeInTheDocument()
        expect(container.querySelector('[data-slot="scroll-area-viewport"]')).toBeNull()

        rerender(viewer('a.md', '# Alpha'))
        expect(viewport(container).scrollTop).toBe(300)
    })

    it('starts a document that was closed and opened again at the top', () => {
        workspace.tabs = [fileTab('a.md'), fileTab('b.md')]
        const { container, rerender } = render(viewer('a.md', '# Alpha'))
        viewport(container).scrollTop = 300
        fireEvent.scroll(viewport(container))

        workspace.tabs = [fileTab('b.md')]
        rerender(viewer('b.md', '# Beta'))
        workspace.tabs = [fileTab('b.md'), fileTab('a.md')]
        rerender(viewer('a.md', '# Alpha'))
        expect(viewport(container).scrollTop).toBe(0)
    })

    describe('web images', () => {
        const withImages = [
            '![Tracker](https://tracker.example/pixel.png?id=1)',
            '',
            '[![Build badge](//badges.example/build.svg)](https://ci.example)',
            '',
            `![Local](${GIF})`,
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
            expect(container.querySelector(`img[src="${GIF}"]`)).not.toBeNull()

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
            render(viewer(DOC_A, `![Local](${GIF})`))
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

        it('keeps the choice after a diagram tab was shown in the preview’s place', () => {
            const { container, rerender } = render(viewer(DOC_A, withImages))
            fireEvent.click(screen.getByRole('button', { name: 'Load images' }))

            rerender(diagramTab('C:\\notes/x.mmd'))
            rerender(viewer(DOC_A, withImages))
            expect(container.querySelector('img[src^="https:"]')).not.toBeNull()
            expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull()
        })
    })

    describe('images from the open folder (F02)', () => {
        beforeEach(() => {
            vi.mocked(isTauri).mockReturnValue(true)
        })

        it('finds an image from the document’s own folder, and doesn’t count it as a web image', async () => {
            vi.mocked(invoke).mockImplementationOnce(async () => 'data:image/png;base64,FOLDER')
            workspace.tabs = [fileTab(DOC_OTHER)]
            render(viewer(DOC_OTHER, '![Chart](../img/chart.png)'))

            await waitFor(() => expect(screen.getByRole('img', { name: 'Chart' })).toHaveAttribute('src', 'data:image/png;base64,FOLDER'))
            expect(invoke).toHaveBeenCalledWith('read_workspace_image', { root: 'C:\\notes', path: 'C:\\notes\\img\\chart.png' })
            expect(screen.queryByRole('button', { name: 'Load images' })).toBeNull()
        })

        it('reads no file for an example, which has no folder', () => {
            const example = 'example:readme'
            workspace.tabs = [{ ...fileTab(example), path: example }]
            render(viewer(example, '![Chart](chart.png)'))

            expect(screen.getByRole('img', { name: /^Image not shown: Chart \(chart\.png\)\. Save the document/ })).toBeInTheDocument()
            expect(invoke).not.toHaveBeenCalled()
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

        it('parses the document only once per edit while following the expanded block (N69)', async () => {
            const { rerender } = render(viewer(DOC_A, twoDiagrams))
            fireEvent.click(screen.getByRole('button', { name: 'Expand diagram 2: Login flow' }))
            await nextFrame()
            const parses = markdownParses.count

            rerender(viewer(DOC_A, twoDiagrams.replace('C --> D', 'C --> E')))
            await nextFrame()
            expect(screen.getByTestId('expanded-canvas').textContent).toBe('flowchart LR\n  accTitle: Login flow\n  C --> E')
            // The preview under the overlay parsed it; the expanded view reads the diagrams it found.
            expect(markdownParses.count).toBe(parses + 1)
            expect(extractMermaidBlockSources).not.toHaveBeenCalled()
        })

        it('closes when the document is cleared', async () => {
            const { rerender } = render(viewer(DOC_A, twoDiagrams))
            fireEvent.click(screen.getByRole('button', { name: 'Expand diagram 1' }))
            rerender(viewer(DOC_A, '   '))
            await waitFor(() => expect(screen.queryByTestId('expanded-canvas')).toBeNull())
            expect(screen.getByText('Start writing Markdown to see a preview.')).toBeInTheDocument()
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

        // happy-dom lets any element take focus. A browser only lets links, form fields and elements with a tabindex
        // take it, so headings and `<a name>` anchors need one (N28 review).
        beforeEach(() => {
            const focus = HTMLElement.prototype.focus
            vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
                if (this.matches('a[href], button, input, select, textarea, [tabindex]')) focus.call(this, options)
            })
        })

        afterEach(() => vi.restoreAllMocks())

        it('keeps heading and footnote ids, with GitHub’s prefix, and never uses target=_blank', () => {
            const { container } = render(viewer(DOC_A, source))
            expect(container.querySelector('h1')).toHaveAttribute('id', 'user-content-install-steps')
            expect(container.querySelector('#user-content-fn-1')).not.toBeNull()
            expect(container.querySelector('#user-content-footnote-label')).toHaveClass('sr-only')
            expect(container.querySelector('a[data-footnote-ref]')).toHaveAttribute('aria-describedby', 'user-content-footnote-label')
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

        it('moves focus to the section or footnote it scrolled to, so Tab carries on from there (N28)', () => {
            const { container } = render(viewer(DOC_A, source))
            const heading = container.querySelector<HTMLElement>('h1')!
            const below = screen.getByRole('link', { name: 'below' })
            below.focus()
            fireEvent.click(below)
            expect(heading).toHaveFocus()
            expect(heading).toHaveAttribute('tabindex', '-1')

            // Focusable only until focus leaves it again.
            const footnoteRef = container.querySelector<HTMLElement>('a[data-footnote-ref]')!
            footnoteRef.focus()
            expect(heading).not.toHaveAttribute('tabindex')
            fireEvent.click(footnoteRef)
            const note = container.querySelector<HTMLElement>('#user-content-fn-1')!
            expect(note).toHaveFocus()
            expect(note).toHaveAttribute('tabindex', '-1')

            // Back from the footnote to its marker, a link that takes focus as it is.
            fireEvent.click(note.querySelector<HTMLElement>('a[data-footnote-backref]')!)
            expect(footnoteRef).toHaveFocus()
            expect(footnoteRef).not.toHaveAttribute('tabindex')
            expect(note).not.toHaveAttribute('tabindex')
        })

        it('moves focus to an old-style <a name> anchor, which has no link to take focus with (N28 review)', () => {
            const { container } = render(viewer(DOC_A, '<a name="install"></a>\n\nInstall it.\n\n[x](#install)'))
            const anchor = container.querySelector<HTMLElement>('a[name]')!
            const link = screen.getByRole('link', { name: 'x' })
            link.focus()
            fireEvent.click(link)
            expect(anchor).toHaveFocus()
            expect(anchor).toHaveAttribute('tabindex', '-1')

            link.focus()
            expect(anchor).not.toHaveAttribute('tabindex')
        })

        it('keeps the section focusable while the user is in another window, so focus is still there on return (N28 review)', () => {
            const { container } = render(viewer(DOC_A, source))
            const heading = container.querySelector<HTMLElement>('h1')!
            fireEvent.click(screen.getByRole('link', { name: 'below' }))
            expect(heading).toHaveFocus()

            // Leaving the window blurs the heading but leaves it the page's focused element.
            fireEvent.blur(heading)
            expect(heading).toHaveFocus()
            expect(heading).toHaveAttribute('tabindex', '-1')

            // Back in the window, Tab moves on from it.
            fireEvent.focus(heading)
            screen.getByRole('link', { name: 'site' }).focus()
            expect(heading).not.toHaveAttribute('tabindex')
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

        it('keeps a heading from taking an id the app uses, and #links still reach it (B05 review)', () => {
            const { container } = render(
                viewer(DOC_A, '# Export title\n\nSee [x](#export-title), [y](#Export-Title) and [z](#user-content-export-title).')
            )
            // The export dialog's title field, which opens after the preview (a portal at the end of the page). Its
            // <label htmlFor> and getElementById must find it, not the heading that comes first.
            const field = document.createElement('input')
            field.id = 'export-title'
            document.body.append(field)
            try {
                const heading = container.querySelector('h1')
                expect(heading).toHaveAttribute('id', 'user-content-export-title')
                expect(document.getElementById('export-title')).toBe(field)

                for (const name of ['x', 'y', 'z']) fireEvent.click(screen.getByRole('link', { name }))
                expect(notifyInfo).not.toHaveBeenCalled()
                expect(scrollIntoView.mock.contexts).toEqual([heading, heading, heading])
            } finally {
                field.remove()
            }
        })

        it('reaches an old-style <a name> anchor, as the PDF does (review)', () => {
            const { container } = render(
                viewer(DOC_A, '<a name="install"></a>\n\nInstall it.\n\n<a name="Set_Up">Set up</a>\n\n[x](#install) [y](#Install) [z](#set_up)')
            )
            const [install, setUp] = Array.from(container.querySelectorAll('a[name]'))
            expect(install).toHaveAttribute('name', 'user-content-install')
            for (const name of ['x', 'y', 'z']) fireEvent.click(screen.getByRole('link', { name }))
            expect(notifyInfo).not.toHaveBeenCalled()
            expect(scrollIntoView.mock.contexts).toEqual([install, install, setUp])
        })

        it('tells the user when an anchor has no target', () => {
            render(viewer(DOC_A, '[missing](#nowhere)'))
            fireEvent.click(screen.getByRole('link', { name: 'missing' }))
            expect(scrollIntoView).not.toHaveBeenCalled()
            expect(notifyInfo).toHaveBeenCalledWith("Couldn't find that section", { description: '#nowhere' })
        })

        describe('back to top (N27)', () => {
            it('scrolls to the top for #top when nothing has that id, as a browser does', () => {
                const { container } = render(viewer(DOC_A, '# Intro\n\nText.\n\n[Back to top](#top) [Up](#TOP)'))
                for (const name of ['Back to top', 'Up']) {
                    viewport(container).scrollTop = 500
                    fireEvent.click(screen.getByRole('link', { name }))
                    expect(viewport(container).scrollTop).toBe(0)
                }
                expect(scrollIntoView).not.toHaveBeenCalled()
                expect(notifyInfo).not.toHaveBeenCalled()
            })

            it('goes to the document’s own section called Top when it has one', () => {
                const { container } = render(viewer(DOC_A, '# Intro\n\n## Top\n\n[Back to top](#top)'))
                viewport(container).scrollTop = 500
                fireEvent.click(screen.getByRole('link', { name: 'Back to top' }))
                expect(scrollIntoView.mock.contexts).toEqual([container.querySelector('h2#user-content-top')])
                expect(viewport(container).scrollTop).toBe(500)
            })

            it('scrolls to the top for a bare #, even when the document has a section called Top', () => {
                const { container } = render(viewer(DOC_A, '# Intro\n\n## Top\n\nText.\n\n[Up](#)'))
                viewport(container).scrollTop = 500
                fireEvent.click(screen.getByRole('link', { name: 'Up' }))
                expect(viewport(container).scrollTop).toBe(0)
                expect(scrollIntoView).not.toHaveBeenCalled()
                expect(notifyInfo).not.toHaveBeenCalled()
            })

            it('opens a linked document at its top for other.md#top, not where it was last read', () => {
                workspace.tabs = [fileTab(DOC_A), fileTab(DOC_OTHER)]
                const { container, rerender } = render(viewer(DOC_OTHER, '# Other'))
                viewport(container).scrollTop = 300
                fireEvent.scroll(viewport(container))

                rerender(viewer(DOC_A, '[other](docs/other.md#top)'))
                fireEvent.click(screen.getByRole('link', { name: 'other' }))
                expect(workspace.openFile).toHaveBeenCalledWith(DOC_OTHER)

                rerender(viewer(DOC_OTHER, '# Other'))
                expect(viewport(container).scrollTop).toBe(0)
                expect(notifyInfo).not.toHaveBeenCalled()
            })
        })

        it('opens linked documents in a tab and then scrolls to their #fragment', () => {
            const { container, rerender } = render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'setup' }))
            expect(workspace.openFile).toHaveBeenCalledWith(DOC_OTHER)
            expect(openUrl).not.toHaveBeenCalled()

            workspace.tabs = [fileTab(DOC_A), fileTab(DOC_OTHER)]
            rerender(viewer(DOC_OTHER, '# Intro\n\n## Part'))
            expect(scrollIntoView).toHaveBeenCalledTimes(1)
            expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('h2#user-content-part'))
            // The link that was followed went with the old document, so focus starts again at the section (N28).
            expect(container.querySelector('h2#user-content-part')).toHaveFocus()
        })

        it('leaves focus where it is when it has moved out of the preview by the time the linked document opens (N28)', () => {
            const { container, rerender } = render(viewer(DOC_A, source))
            fireEvent.click(screen.getByRole('link', { name: 'setup' }))
            const editor = document.createElement('textarea')
            document.body.append(editor)
            try {
                editor.focus()
                workspace.tabs = [fileTab(DOC_A), fileTab(DOC_OTHER)]
                rerender(viewer(DOC_OTHER, '# Intro\n\n## Part'))
                expect(scrollIntoView.mock.contexts).toEqual([container.querySelector('h2#user-content-part')])
                expect(editor).toHaveFocus()
            } finally {
                editor.remove()
            }
        })

        it('still scrolls to the #fragment of a file the explorer doesn’t list, once its tab opens under the tidied path (N23)', () => {
            const { container, rerender } = render(viewer(DOC_A, '[new](docs/sub/new.md#part)'))
            fireEvent.click(screen.getByRole('link', { name: 'new' }))
            expect(workspace.openFile).toHaveBeenCalledWith('C:\\notes/docs/sub/new.md')

            // What openFile really does: the tab's id is the path with `\` throughout.
            const opened = 'C:\\notes\\docs\\sub\\new.md'
            workspace.tabs = [fileTab(DOC_A), fileTab(opened)]
            rerender(viewer(opened, '# New\n\n## Part'))
            expect(scrollIntoView).toHaveBeenCalledTimes(1)
            expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('h2#user-content-part'))
        })

        describe('while the diagrams above the linked section are drawn (N22)', () => {
            /** The resize observers in use, and what each one watches. */
            const observers = new Set<{ callback: ResizeObserverCallback; targets: Element[] }>()
            const original = globalThis.ResizeObserver

            beforeEach(() => {
                globalThis.ResizeObserver = class {
                    private readonly entry: { callback: ResizeObserverCallback; targets: Element[] }
                    constructor(callback: ResizeObserverCallback) {
                        this.entry = { callback, targets: [] }
                        observers.add(this.entry)
                    }
                    observe(target: Element) {
                        this.entry.targets.push(target)
                    }
                    unobserve() {}
                    disconnect() {
                        observers.delete(this.entry)
                    }
                } as unknown as typeof ResizeObserver
            })

            afterEach(() => {
                globalThis.ResizeObserver = original
                observers.clear()
            })

            /** What a diagram growing from its placeholder into a picture does to the preview's content. */
            function growContent(container: HTMLElement) {
                const content = viewport(container).firstElementChild!
                for (const { callback, targets } of [...observers]) {
                    if (targets.includes(content)) act(() => callback([], {} as ResizeObserver))
                }
            }

            function openLinkedPart() {
                const view = render(viewer(DOC_A, source))
                fireEvent.click(screen.getByRole('link', { name: 'setup' }))
                workspace.tabs = [fileTab(DOC_A), fileTab(DOC_OTHER)]
                view.rerender(viewer(DOC_OTHER, '```mermaid\nflowchart TD\n```\n\n## Part'))
                expect(scrollIntoView).toHaveBeenCalledTimes(1)
                return view
            }

            it('scrolls to the section again each time the content above it grows', () => {
                const { container } = openLinkedPart()
                growContent(container)
                growContent(container)
                expect(scrollIntoView).toHaveBeenCalledTimes(3)
                expect(new Set(scrollIntoView.mock.contexts)).toEqual(new Set([container.querySelector('h2#user-content-part')]))
            })

            it('stops once the user scrolls the preview themselves', () => {
                const { container } = openLinkedPart()
                fireEvent.wheel(viewport(container))
                growContent(container)
                expect(scrollIntoView).toHaveBeenCalledTimes(1)
            })

            it('stops after a moment', () => {
                vi.useFakeTimers()
                try {
                    const { container } = openLinkedPart()
                    act(() => vi.advanceTimersByTime(1500))
                    growContent(container)
                    expect(scrollIntoView).toHaveBeenCalledTimes(1)
                } finally {
                    vi.useRealTimers()
                }
            })

            it('stops when another tab is shown', () => {
                const { container, rerender } = openLinkedPart()
                rerender(viewer(DOC_A, source))
                growContent(container)
                expect(scrollIntoView).toHaveBeenCalledTimes(1)
            })
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

        it('hands phone links, written in Markdown or HTML, to the system (N26)', () => {
            vi.mocked(isTauri).mockReturnValue(true)
            render(viewer(DOC_A, 'Call [the office](tel:+442012345678) or <a href="tel:+15550100">the desk</a>.'))
            for (const [name, url] of [
                ['the office', 'tel:+442012345678'],
                ['the desk', 'tel:+15550100'],
            ] as const) {
                const link = screen.getByRole('link', { name })
                expect(link).toHaveAttribute('href', url)
                fireEvent.click(link)
                expect(openUrl).toHaveBeenLastCalledWith(url)
            }
            expect(notifyInfo).not.toHaveBeenCalled()
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
