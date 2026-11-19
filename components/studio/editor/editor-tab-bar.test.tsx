import { fireEvent, render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'

let tabs: DocumentTab[] = []
let activeTabId: string | null = null
const setActiveTab = vi.fn(async (id: string) => {
    activeTabId = id
})
const closeTab = vi.fn(async () => {})
const moveTab = vi.fn()
let lastTabMove: { id: string } | null = null
const fitToView = vi.fn()
let canFitToView = false
let previewOpen = true

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({
        tabs,
        activeTabId,
        activeTab: tabs.find((t) => t.id === activeTabId) ?? null,
        setActiveTab,
        closeTab,
        moveTab,
        lastTabMove,
        closeOtherTabs: vi.fn(),
        closeAllTabs: vi.fn(),
    }),
    useWorkspaceSession: () => ({ workspaceRoot: '/w' }),
    useStudioLayout: () => ({ layout: { explorerOpen: true, editorOpen: true, previewOpen, outlineOpen: false } }),
}))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    useCanvasControls: () => ({ canFitToView, fitToView }),
}))
vi.mock('@/components/studio/markdown/markdown-expand-context', () => ({ useMarkdownExpand: () => ({ expanded: false }) }))
vi.mock('@/components/studio/editor/document-export-menu', () => ({ DocumentExportMenu: () => null }))
vi.mock('@/components/studio/editor/layout-toggle-buttons', () => ({ LayoutToggleButtons: () => null }))

const { EditorTabBar } = await import('./editor-tab-bar')

function tab(path: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content: '', isDirty: false, isSaving: false, ...extra }
}

/** Close buttons are hidden from assistive tech, so find them by their label. */
function closeButton(container: HTMLElement, label: string) {
    return container.querySelector(`button[aria-label="${label}"]`)
}

beforeEach(() => {
    setActiveTab.mockClear()
    closeTab.mockClear()
    moveTab.mockClear()
    lastTabMove = null
    fitToView.mockClear()
    canFitToView = false
    previewOpen = true
})

describe('EditorTabBar', () => {
    it('exposes the open documents as tabs, with the active one selected', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/b.md'
        render(<EditorTabBar />)

        expect(screen.getByRole('tablist', { name: 'Open documents' })).toBeInTheDocument()
        const [a, b] = screen.getAllByRole('tab')
        expect(a).toHaveAttribute('aria-selected', 'false')
        expect(b).toHaveAttribute('aria-selected', 'true')
        // Only the active tab is a Tab stop.
        expect(a).toHaveAttribute('tabindex', '-1')
        expect(b).toHaveAttribute('tabindex', '0')
    })

    it('tells assistive tech about unsaved, saving, read-only and failed saves', () => {
        tabs = [
            tab('/w/dirty.md', { isDirty: true }),
            tab('/w/saving.md', { isSaving: true }),
            tab('example:x', { name: 'Example.mmd', readOnly: true }),
            tab('/w/failed.md', { isDirty: true, saveError: 'Disk full' }),
            tab('/w/legacy.md', { readOnly: true }),
        ]
        activeTabId = '/w/dirty.md'
        const view = render(<EditorTabBar />)

        expect(screen.getByRole('tab', { name: 'dirty.md , unsaved changes' })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'saving.md , saving' })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'Example.mmd , read-only example' })).toBeInTheDocument()
        // A read-only file from the folder is not an example.
        expect(screen.getByRole('tab', { name: 'legacy.md , read-only' })).toBeInTheDocument()
        const failed = screen.getByRole('tab', { name: 'failed.md , unsaved changes, save failed: Disk full' })
        // The failure doesn't hide which file it is.
        expect(failed).toHaveAttribute('title', '/w/failed.md\nSave failed: Disk full')
        expect(closeButton(view.container, 'Close dirty.md, unsaved changes')).toHaveAttribute('tabindex', '-1')
    })

    it('holds only tabs in the tab list, and closes the focused tab with Delete', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md', { isDirty: true })]
        activeTabId = '/w/a.md'
        render(<EditorTabBar />)

        // The close buttons are for the mouse; assistive tech sees only the tabs.
        expect(screen.queryAllByRole('button', { name: /^Close / })).toHaveLength(0)
        const close = screen.getAllByRole('button', { hidden: true }).filter((b) => b.getAttribute('aria-label')?.startsWith('Close '))
        expect(close).toHaveLength(2)
        for (const button of close) {
            expect(button).toHaveAttribute('aria-hidden', 'true')
            expect(button).toHaveAttribute('tabindex', '-1')
        }

        fireEvent.keyDown(screen.getByRole('tab', { name: 'b.md , unsaved changes' }), { key: 'Delete' })
        expect(closeTab).toHaveBeenCalledWith('/w/b.md')
        fireEvent.click(close[0]!)
        expect(closeTab).toHaveBeenLastCalledWith('/w/a.md')
    })

    it('closes a tab on a middle-click, without switching to it', async () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md', { isDirty: true })]
        activeTabId = '/w/a.md'
        render(<EditorTabBar />)
        const user = userEvent.setup()

        await user.pointer({ keys: '[MouseMiddle]', target: screen.getByRole('tab', { name: 'b.md , unsaved changes' }) })

        // Closing asks about unsaved changes as the X button does.
        expect(closeTab).toHaveBeenCalledExactlyOnceWith('/w/b.md')
        expect(setActiveTab).not.toHaveBeenCalled()
    })

    it('stops a middle-click from starting to scroll the page', () => {
        tabs = [tab('/w/a.md')]
        activeTabId = '/w/a.md'
        render(<EditorTabBar />)

        const middle = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 1 })
        screen.getByRole('tab').dispatchEvent(middle)
        expect(middle.defaultPrevented).toBe(true)
        const left = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
        screen.getByRole('tab').dispatchEvent(left)
        expect(left.defaultPrevented).toBe(false)
    })

    it('keeps the keyboard on the open tab when a shortcut switches tabs while a tab has focus', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const { rerender } = render(<EditorTabBar />)
        const [a, b] = screen.getAllByRole('tab')
        a!.focus()

        activeTabId = '/w/b.md'
        rerender(<EditorTabBar />)

        expect(b).toHaveFocus()
    })

    it('leaves the keyboard where it is when a tab is switched to from elsewhere', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const { rerender } = render(
            <>
                <EditorTabBar />
                <textarea aria-label="editor" />
            </>
        )
        screen.getByRole('textbox', { name: 'editor' }).focus()

        activeTabId = '/w/b.md'
        rerender(
            <>
                <EditorTabBar />
                <textarea aria-label="editor" />
            </>
        )

        expect(screen.getByRole('textbox', { name: 'editor' })).toHaveFocus()
    })

    it('keeps the keyboard in the strip when the focused tab is closed', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md'), tab('/w/c.md')]
        activeTabId = '/w/b.md'
        const { rerender } = render(<EditorTabBar />)
        screen.getByRole('tab', { name: 'b.md' }).focus()

        // Ctrl+W or Delete closed it: its button goes, and the next tab is shown.
        tabs = [tab('/w/a.md'), tab('/w/c.md')]
        activeTabId = '/w/c.md'
        rerender(<EditorTabBar />)

        expect(screen.getByRole('tab', { name: 'c.md' })).toHaveFocus()
    })

    it('does not pull the keyboard back to the strip once it has gone elsewhere', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const view = (
            <>
                <EditorTabBar />
                <textarea aria-label="editor" />
            </>
        )
        const { rerender } = render(view)
        screen.getByRole('tab', { name: 'a.md' }).focus()
        const editor = screen.getByRole('textbox', { name: 'editor' })
        editor.focus()
        editor.blur()
        expect(document.body).toHaveFocus()

        tabs = [tab('/w/b.md')]
        activeTabId = '/w/b.md'
        rerender(view)

        expect(document.body).toHaveFocus()
    })

    it('moves between tabs with the arrow, Home and End keys', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md'), tab('/w/c.md')]
        activeTabId = '/w/a.md'
        render(<EditorTabBar />)
        const [a, b, c] = screen.getAllByRole('tab')

        fireEvent.keyDown(a!, { key: 'ArrowRight' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/b.md')
        expect(b).toHaveFocus()

        fireEvent.keyDown(a!, { key: 'ArrowLeft' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/c.md')
        expect(c).toHaveFocus()

        fireEvent.keyDown(c!, { key: 'Home' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/a.md')

        fireEvent.keyDown(a!, { key: 'End' })
        expect(setActiveTab).toHaveBeenLastCalledWith('/w/c.md')
    })

    it('scrolls the tab strip sideways with the mouse wheel when the tabs do not fit', () => {
        tabs = Array.from({ length: 20 }, (_, i) => tab(`/w/file-${i}.md`))
        activeTabId = tabs[0]!.id
        render(<EditorTabBar />)
        const strip = screen.getByRole('tablist')
        Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 500 })
        Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 2000 })

        const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
        strip.dispatchEvent(wheel)
        expect(strip.scrollLeft).toBe(120)
        expect(wheel.defaultPrevented).toBe(true)

        // Sideways scrolling (trackpad, tilt wheel) is left to the browser.
        const sideways = new WheelEvent('wheel', { deltaX: 80, deltaY: 5, bubbles: true, cancelable: true })
        strip.dispatchEvent(sideways)
        expect(sideways.defaultPrevented).toBe(false)
    })

    it('leaves the wheel alone when every tab fits', () => {
        tabs = [tab('/w/a.md')]
        activeTabId = '/w/a.md'
        render(<EditorTabBar />)
        const strip = screen.getByRole('tablist')
        Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 500 })
        Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 500 })

        const wheel = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })
        strip.dispatchEvent(wheel)
        expect(wheel.defaultPrevented).toBe(false)
    })

    it('keeps the Fit button reachable when it cannot be used, and says why on focus', async () => {
        tabs = [tab('/w/notes.md')]
        activeTabId = '/w/notes.md'
        render(<EditorTabBar />)

        const fit = screen.getByRole('button', { name: 'Fit diagram to screen' })
        expect(fit).not.toBeDisabled()
        expect(fit).toHaveAttribute('aria-disabled', 'true')
        expect(fit).not.toHaveAttribute('title')
        // Screen readers hear the reason too, not just the name and "dimmed".
        expect(fit).toHaveAccessibleDescription('Expand a Mermaid block to fit')

        fireEvent.click(fit)
        expect(fitToView).not.toHaveBeenCalled()

        act(() => fit.focus())
        expect(await screen.findByText('Expand a Mermaid block to fit', { selector: '[data-slot="tooltip-popup"] *' })).toBeInTheDocument()
    })

    it('says why Fit is unavailable for a diagram that cannot be drawn, and fits one that can', async () => {
        tabs = [tab('/w/broken.mmd')]
        activeTabId = '/w/broken.mmd'
        const view = render(<EditorTabBar />)

        const fit = screen.getByRole('button', { name: 'Fit diagram to screen' })
        expect(fit).toHaveAttribute('aria-disabled', 'true')
        expect(fit).toHaveAccessibleDescription('No diagram to fit')
        act(() => fit.focus())
        expect(await screen.findByText('No diagram to fit', { selector: '[data-slot="tooltip-popup"] *' })).toBeInTheDocument()

        canFitToView = true
        view.rerender(<EditorTabBar />)
        expect(fit).not.toHaveAttribute('aria-disabled')
        expect(fit).not.toHaveAccessibleDescription()
        fireEvent.click(fit)
        expect(fitToView).toHaveBeenCalledTimes(1)
    })

    it('says to show the preview when it is hidden, for Markdown and diagram tabs', () => {
        tabs = [tab('/w/notes.md'), tab('/w/flow.mmd')]
        activeTabId = '/w/notes.md'
        previewOpen = false
        canFitToView = true
        const view = render(<EditorTabBar />)

        const fit = screen.getByRole('button', { name: 'Fit diagram to screen' })
        expect(fit).toHaveAttribute('aria-disabled', 'true')
        expect(fit).toHaveAccessibleDescription('Show the preview to fit a diagram')

        activeTabId = '/w/flow.mmd'
        view.rerender(<EditorTabBar />)
        expect(fit).toHaveAccessibleDescription('Show the preview to fit a diagram')
        fireEvent.click(fit)
        expect(fitToView).not.toHaveBeenCalled()
    })

    it('shows the folder when two open files have the same name', () => {
        tabs = [tab('/w/docs/api/README.md'), tab('/w/docs/guide/README.md'), tab('/w/notes.md')]
        activeTabId = '/w/notes.md'
        const view = render(<EditorTabBar />)

        expect(screen.getByRole('tab', { name: /^README\.md\s*in api$/ })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: /^README\.md\s*in guide$/ })).toBeInTheDocument()
        expect(screen.getByRole('tab', { name: 'notes.md' })).toBeInTheDocument()
        expect(screen.getByText('api')).toHaveClass('text-muted-foreground')
        expect(closeButton(view.container, 'Close README.md in guide')).toBeInTheDocument()
    })

    it('opens the right-click menu of a background tab without switching to it, and closes that tab from it', async () => {
        tabs = [tab('/w/a.mmd'), tab('/w/b.mmd'), tab('/w/c.mmd')]
        activeTabId = '/w/a.mmd'
        const view = render(<EditorTabBar />)

        fireEvent.contextMenu(screen.getByRole('tab', { name: 'c.mmd' }), { clientX: 300, clientY: 20 })
        const close = await screen.findByRole('menuitem', { name: 'Close' })
        expect(setActiveTab).not.toHaveBeenCalled()
        expect(view.container.querySelector('[data-menu-open]')).toContainElement(screen.getByRole('tab', { name: 'c.mmd' }))

        fireEvent.click(close)
        expect(closeTab).toHaveBeenCalledWith('/w/c.mmd')
        expect(setActiveTab).not.toHaveBeenCalled()
    })
})

describe('EditorTabBar moving tabs', () => {
    const STRIP = { top: 0, bottom: 36, height: 36 }

    /** Three tabs, 100px wide side by side from x = 0, in a strip 36px high (happy-dom has no layout). */
    function renderStrip() {
        tabs = [tab('/w/a.md'), tab('/w/b.md'), tab('/w/c.md')]
        activeTabId = '/w/a.md'
        const view = render(<EditorTabBar />)
        const rect = (left: number, width: number) => ({ ...STRIP, left, width, right: left + width, x: left, y: 0, toJSON: () => ({}) }) as DOMRect
        vi.spyOn(screen.getByRole('tablist'), 'getBoundingClientRect').mockReturnValue(rect(0, 600))
        screen.getAllByRole('tab').forEach((t, i) => {
            vi.spyOn(t.closest<HTMLElement>('[role="presentation"]')!, 'getBoundingClientRect').mockReturnValue(rect(i * 100, 100))
        })
        return view
    }

    const press = (name: string, x = 50) =>
        fireEvent.pointerDown(screen.getByRole('tab', { name }), { button: 0, buttons: 1, clientX: x, clientY: 18, pointerId: 1 })
    const moveTo = (x: number, y = 18) => fireEvent.pointerMove(document, { buttons: 1, clientX: x, clientY: y, pointerId: 1 })
    const letGo = (x: number, y = 18) => fireEvent.pointerUp(document, { button: 0, clientX: x, clientY: y, pointerId: 1 })
    const dropLine = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-drop-line]')

    it('shows a line where a dragged tab will land, worked out from the middle of each tab, and moves it there', () => {
        const { container } = renderStrip()

        press('a.md')
        moveTo(160)
        // Past the middle of b.md, so before c.md.
        expect(dropLine(container)).toHaveAttribute('data-drop-line', 'start')
        expect(dropLine(container)!.closest('[role="presentation"]')).toContainElement(screen.getByRole('tab', { name: 'c.md' }))
        expect(screen.getByRole('tab', { name: 'a.md' }).closest('[data-dragging]')).not.toBeNull()
        // The line uses the theme's ring colour, and the system highlight in contrast themes.
        expect(dropLine(container)).toHaveClass('bg-ring', 'forced-colors:bg-[Highlight]')

        letGo(160)
        expect(moveTab).toHaveBeenCalledExactlyOnceWith('/w/a.md', 1)
        expect(dropLine(container)).toBeNull()
        expect(container.querySelector('[data-dragging]')).toBeNull()
    })

    it('moves a tab let go over the empty space after the last tab to the end', () => {
        const { container } = renderStrip()

        press('a.md')
        moveTo(480)
        expect(dropLine(container)).toHaveAttribute('data-drop-line', 'end')
        expect(dropLine(container)!.closest('[role="presentation"]')).toContainElement(screen.getByRole('tab', { name: 'c.md' }))
        letGo(480)

        expect(moveTab).toHaveBeenCalledExactlyOnceWith('/w/a.md', 2)
    })

    it('moves a tab to the start', () => {
        renderStrip()

        press('c.md', 250)
        moveTo(20)
        letGo(20)

        expect(moveTab).toHaveBeenCalledExactlyOnceWith('/w/c.md', 0)
    })

    it('swallows the click that comes as the button is let go after a drag', () => {
        renderStrip()

        press('a.md')
        moveTo(160)
        letGo(160)
        fireEvent.click(screen.getByRole('tab', { name: 'b.md' }))
        expect(setActiveTab).not.toHaveBeenCalled()
        expect(moveTab).toHaveBeenCalledTimes(1)

        // The next press is a click again.
        press('c.md', 250)
        letGo(250)
        fireEvent.click(screen.getByRole('tab', { name: 'c.md' }))
        expect(setActiveTab).toHaveBeenCalledExactlyOnceWith('/w/c.md')
    })

    it('puts everything back on Escape', () => {
        const { container } = renderStrip()

        press('a.md')
        moveTo(260)
        // Taken, so it doesn't also close something else.
        expect(fireEvent.keyDown(document, { key: 'Escape' })).toBe(false)
        expect(dropLine(container)).toBeNull()
        // Moving on after Escape doesn't start the drag again.
        moveTo(300)
        expect(dropLine(container)).toBeNull()
        letGo(300)
        fireEvent.click(screen.getByRole('tab', { name: 'c.md' }))

        expect(moveTab).not.toHaveBeenCalled()
        expect(setActiveTab).not.toHaveBeenCalled()
    })

    it('hides the line above or below the tab bar, and cancels a tab let go there', () => {
        const { container } = renderStrip()

        press('a.md')
        moveTo(260, 80)
        expect(dropLine(container)).toBeNull()
        moveTo(260, 18)
        expect(dropLine(container)).not.toBeNull()
        moveTo(260, -10)
        expect(dropLine(container)).toBeNull()
        letGo(260, -10)

        expect(moveTab).not.toHaveBeenCalled()
    })

    it('leaves a tab dropped back where it started alone', () => {
        renderStrip()

        press('b.md', 150)
        moveTo(120)
        letGo(120)
        press('b.md', 150)
        moveTo(240)
        letGo(240)

        expect(moveTab).not.toHaveBeenCalled()
    })

    it('treats a short press as a click', () => {
        const { container } = renderStrip()

        press('b.md', 150)
        moveTo(152)
        expect(dropLine(container)).toBeNull()
        letGo(152)
        fireEvent.click(screen.getByRole('tab', { name: 'b.md' }))

        expect(moveTab).not.toHaveBeenCalled()
        expect(setActiveTab).toHaveBeenCalledExactlyOnceWith('/w/b.md')
    })

    it('does not drag with the middle or right button, which close the tab or open its menu', async () => {
        const { container } = renderStrip()

        fireEvent.pointerDown(screen.getByRole('tab', { name: 'b.md' }), { button: 1, buttons: 4, clientX: 150, clientY: 18 })
        moveTo(260)
        fireEvent.pointerDown(screen.getByRole('tab', { name: 'b.md' }), { button: 2, buttons: 2, clientX: 150, clientY: 18 })
        moveTo(260)
        expect(dropLine(container)).toBeNull()
        letGo(260)

        await userEvent.setup().pointer({ keys: '[MouseMiddle]', target: screen.getByRole('tab', { name: 'b.md' }) })
        expect(closeTab).toHaveBeenCalledExactlyOnceWith('/w/b.md')
        expect(moveTab).not.toHaveBeenCalled()
    })

    it('keeps the keyboard on a moved tab, scrolls it into view, and says where it went', () => {
        const scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView
        tabs = [tab('/w/a.md'), tab('/w/b.md'), tab('/w/c.md'), tab('/w/notes.md')]
        activeTabId = '/w/a.md'
        const { rerender } = render(<EditorTabBar />)
        screen.getByRole('tab', { name: 'a.md' }).focus()
        scrollIntoView.mockClear()

        // Move Tab Right, twice.
        tabs = [tab('/w/b.md'), tab('/w/a.md'), tab('/w/c.md'), tab('/w/notes.md')]
        lastTabMove = { id: '/w/a.md' }
        rerender(<EditorTabBar />)
        expect(screen.getByRole('tab', { name: 'a.md' })).toHaveFocus()
        expect(screen.getByRole('status')).toHaveTextContent('a.md moved to position 2 of 4')

        tabs = [tab('/w/b.md'), tab('/w/c.md'), tab('/w/a.md'), tab('/w/notes.md')]
        lastTabMove = { id: '/w/a.md' }
        rerender(<EditorTabBar />)
        rerender(<EditorTabBar />)
        expect(screen.getByRole('status')).toHaveTextContent('a.md moved to position 3 of 4')
        expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['b.md', 'c.md', 'a.md', 'notes.md'])
        expect(scrollIntoView).toHaveBeenCalled()
        expect(scrollIntoView.mock.contexts.at(-1)).toBe(screen.getByRole('tab', { name: 'a.md' }))
    })

    it('leaves the keyboard in the editor when the open tab is moved from there', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        const view = () => (
            <>
                <EditorTabBar />
                <textarea aria-label="editor" />
            </>
        )
        const { rerender } = render(view())
        const editor = screen.getByRole('textbox', { name: 'editor' })
        editor.focus()

        tabs = [tab('/w/b.md'), tab('/w/a.md')]
        lastTabMove = { id: '/w/a.md' }
        rerender(view())

        expect(editor).toHaveFocus()
        expect(screen.getByRole('status')).toHaveTextContent('a.md moved to position 2 of 2')
    })

    it('names the folder of a moved tab that shares its name with another', () => {
        tabs = [tab('/w/api/README.md'), tab('/w/guide/README.md')]
        activeTabId = '/w/api/README.md'
        const { rerender } = render(<EditorTabBar />)

        tabs = [tab('/w/guide/README.md'), tab('/w/api/README.md')]
        lastTabMove = { id: '/w/api/README.md' }
        rerender(<EditorTabBar />)

        expect(screen.getByRole('status')).toHaveTextContent('README.md in api moved to position 2 of 2')
    })

    it('says nothing until a tab moves, or when the tabs change in another way', () => {
        tabs = [tab('/w/a.md'), tab('/w/b.md')]
        activeTabId = '/w/a.md'
        lastTabMove = { id: '/w/b.md' }
        const { rerender } = render(<EditorTabBar />)
        // A move from before the strip was drawn isn't news.
        expect(screen.getByRole('status')).toBeEmptyDOMElement()

        tabs = [tab('/w/a.md')]
        rerender(<EditorTabBar />)
        expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })
})
