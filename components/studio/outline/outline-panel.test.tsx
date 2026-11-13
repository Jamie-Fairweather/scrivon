import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackEditorCursor, type CursorSource } from '@/components/studio/editor/editor-cursor'
import { registerPreviewHeadingReveal } from '@/components/studio/markdown/preview-heading'
import type { DocumentTab } from '@/lib/workspace/types'
import { OutlinePanel } from './outline-panel'

const mocks = vi.hoisted(() => ({
    activeTab: null as DocumentTab | null,
    editorOpen: true,
    setOutlineOpen: vi.fn(),
    revealInEditor: vi.fn(),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTab: mocks.activeTab }),
    useStudioLayout: () => ({
        layout: { explorerOpen: true, editorOpen: mocks.editorOpen, outlineOpen: true },
        setOutlineOpen: mocks.setOutlineOpen,
    }),
    useWorkspaceCoordinator: () => ({ revealInEditor: { current: mocks.revealInEditor } }),
}))

function tab(name: string, content: string): DocumentTab {
    return { id: `C:/ws/${name}`, path: `C:/ws/${name}`, name, content, isDirty: false, isSaving: false }
}

const GUIDE = ['# Guide', '', '## Install', '', '### Windows', '', '## Use', ''].join('\n')

let stopEditorCursor: (() => void) | undefined
/** Puts the code editor's caret on a line, or takes the editor away (null), as the editor panel does. */
function setEditorCursorLine(line: number | null) {
    stopEditorCursor?.()
    stopEditorCursor = undefined
    if (line === null) return
    const noEvents = () => ({ dispose() {} })
    const model = { getLineContent: () => '', getOptions: () => ({ tabSize: 4 }), getValueInRange: () => '' }
    stopEditorCursor = trackEditorCursor({
        getModel: () => model,
        getPosition: () => ({ lineNumber: line, column: 1 }),
        getSelections: () => [],
        onDidChangeCursorSelection: noEvents,
        onDidChangeModel: noEvents,
        onDidChangeModelContent: noEvents,
        onDidChangeModelOptions: noEvents,
        onDidDispose: noEvents,
    } as unknown as CursorSource)
}

beforeEach(() => {
    // The test DOM has no workers, so the outline is read on the main thread, straight away.
    vi.stubGlobal('Worker', undefined)
    mocks.activeTab = null
    mocks.editorOpen = true
    mocks.setOutlineOpen.mockClear()
    mocks.revealInEditor.mockClear()
    setEditorCursorLine(null)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('OutlinePanel', () => {
    it("shows the Markdown file's headings as a nested list", () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        render(<OutlinePanel />)

        const outline = screen.getByRole('navigation', { name: 'Outline' })
        const top = within(outline).getAllByRole('list')[0]!
        expect(top.children).toHaveLength(1)
        const guide = within(outline).getByRole('button', { name: 'Guide' }).closest('li')!
        const sections = within(guide).getAllByRole('list')[0]!
        expect(
            within(sections)
                .getAllByRole('button')
                .map((button) => button.textContent)
        ).toEqual(['Install', 'Windows', 'Use'])
        const install = within(sections).getByRole('button', { name: 'Install' }).closest('li')!
        expect(within(install).getByRole('button', { name: 'Windows' })).toBeInTheDocument()
        expect(within(install).queryByRole('button', { name: 'Use' })).toBeNull()
    })

    it('moves the editor and the preview to a heading when it is clicked', async () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        const revealInPreview = vi.fn()
        const unregister = registerPreviewHeadingReveal(revealInPreview)
        render(<OutlinePanel />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Windows' }))

        expect(revealInPreview).toHaveBeenCalledWith('windows')
        expect(mocks.revealInEditor).toHaveBeenCalledWith('C:/ws/guide.md', 5, 1)
        unregister()
    })

    it('moves only the preview while the editor is hidden', async () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        mocks.editorOpen = false
        const revealInPreview = vi.fn()
        const unregister = registerPreviewHeadingReveal(revealInPreview)
        render(<OutlinePanel />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Use' }))

        expect(revealInPreview).toHaveBeenCalledWith('use')
        expect(mocks.revealInEditor).not.toHaveBeenCalled()
        unregister()
    })

    it("marks the heading of the section the editor's cursor is in", () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        render(<OutlinePanel />)
        expect(screen.queryByRole('button', { current: true })).toBeNull()

        act(() => setEditorCursorLine(6))
        expect(screen.getByRole('button', { current: true })).toHaveTextContent('Windows')

        act(() => setEditorCursorLine(8))
        expect(screen.getByRole('button', { current: true })).toHaveTextContent('Use')
    })

    it('marks no heading while the editor is hidden', () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        mocks.editorOpen = false
        setEditorCursorLine(6)
        render(<OutlinePanel />)

        expect(screen.queryByRole('button', { current: true })).toBeNull()
    })

    it("is one Tab stop: the heading you're in, else the first one", () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        render(<OutlinePanel />)
        const tabStops = () =>
            within(screen.getByRole('navigation', { name: 'Outline' }))
                .getAllByRole('button')
                .filter((button) => button.tabIndex === 0)
                .map((button) => button.textContent)

        expect(tabStops()).toEqual(['Guide'])
        act(() => setEditorCursorLine(6))
        expect(tabStops()).toEqual(['Windows'])
    })

    it('moves focus with the arrow keys, Home and End, and the Tab stop follows', async () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        render(<OutlinePanel />)
        const user = userEvent.setup()
        const heading = (name: string) => screen.getByRole('button', { name })

        act(() => heading('Guide').focus())
        await user.keyboard('{ArrowUp}')
        expect(heading('Guide')).toHaveFocus()
        await user.keyboard('{ArrowDown}{ArrowDown}')
        expect(heading('Windows')).toHaveFocus()
        expect(heading('Windows').tabIndex).toBe(0)
        expect(heading('Guide').tabIndex).toBe(-1)
        await user.keyboard('{End}{ArrowDown}')
        expect(heading('Use')).toHaveFocus()
        await user.keyboard('{ArrowUp}')
        expect(heading('Windows')).toHaveFocus()
        await user.keyboard('{Home}')
        expect(heading('Guide')).toHaveFocus()

        // Keys with Shift, Ctrl or Alt, and other keys, are left alone.
        await user.keyboard('{Shift>}{ArrowDown}{/Shift}{Control>}{End}{/Control}{PageDown}')
        expect(heading('Guide')).toHaveFocus()
    })

    it("leaves in one Tab press, and comes back to the heading you're in", async () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        setEditorCursorLine(6)
        render(
            <>
                <OutlinePanel />
                <button type="button">After</button>
            </>
        )
        const user = userEvent.setup()

        act(() => screen.getByRole('button', { name: 'Hide Outline' }).focus())
        await user.tab()
        expect(screen.getByRole('button', { name: 'Windows' })).toHaveFocus()
        await user.keyboard('{ArrowDown}')
        await user.tab()
        expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
        await user.tab({ shift: true })
        expect(screen.getByRole('button', { name: 'Windows' })).toHaveFocus()
    })

    it('picks the focused heading with Enter or Space', async () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        const revealInPreview = vi.fn()
        const unregister = registerPreviewHeadingReveal(revealInPreview)
        render(<OutlinePanel />)
        const user = userEvent.setup()

        act(() => screen.getByRole('button', { name: 'Guide' }).focus())
        await user.keyboard('{ArrowDown}{Enter}')
        expect(revealInPreview).toHaveBeenLastCalledWith('install')
        await user.keyboard('{End} ')
        expect(revealInPreview).toHaveBeenLastCalledWith('use')
        unregister()
    })

    it('follows the text as it is typed', () => {
        mocks.activeTab = tab('guide.md', GUIDE)
        const { rerender } = render(<OutlinePanel />)

        mocks.activeTab = tab('guide.md', `${GUIDE}\n## Uninstall`)
        rerender(<OutlinePanel />)

        expect(screen.getByRole('button', { name: 'Uninstall' })).toBeInTheDocument()
    })

    it('says when no file is open', () => {
        render(<OutlinePanel />)
        expect(screen.getByText('Open a Markdown file to see its headings.')).toBeInTheDocument()
    })

    it('says that only Markdown files have an outline', () => {
        mocks.activeTab = tab('flow.mmd', 'graph TD\n  A --> B')
        render(<OutlinePanel />)
        expect(screen.getByText('Only Markdown files have an outline.')).toBeInTheDocument()
    })

    it('says how to add a heading when the file has none', () => {
        mocks.activeTab = tab('notes.md', 'Just some notes.')
        render(<OutlinePanel />)
        expect(screen.getByText('No headings yet. Start a line with # to add one.')).toBeInTheDocument()
    })

    it('can be hidden from its own button', async () => {
        render(<OutlinePanel />)
        await userEvent.setup().click(screen.getByRole('button', { name: 'Hide Outline' }))
        expect(mocks.setOutlineOpen).toHaveBeenCalledWith(false)
    })
})
