import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidCanvas } from '@/components/studio/canvas/mermaid-canvas'
import type { EditorPlace, LocateInFile } from '@/components/studio/canvas/use-diagram-picking'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { SWAP_FALLBACK_MS } from '@/lib/mermaid/svg-iframe'

const state = vi.hoisted(() => ({
    editorOpen: true,
    jumpFromPreview: true,
    revealInEditor: vi.fn(),
}))

vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({ useMermaidSvg: vi.fn() }))

vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({
    useCanvasControls: () => ({ registerFitToView: () => () => {}, registerZoomDiagram: () => () => {}, setCanFitToView: () => {} }),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ activeTabId: 'a.mmd', activeTab: { id: 'a.mmd', name: 'flow.mmd' }, tabs: [{ id: 'a.mmd', name: 'flow.mmd' }] }),
    useCanvasFit: () => ({ canvasFitRequestId: 0 }),
    useStudioLayout: () => ({ layout: { editorOpen: state.editorOpen } }),
    useWorkspaceCoordinator: () => ({ revealInEditor: { current: state.revealInEditor } }),
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false), editor: { jumpFromPreview: state.jumpFromPreview } } }),
}))

/**
 * A 100×50 picture with node A at (10, 10)–(30, 30), node B at (70, 10)–(90, 30) and a link between them along
 * y = 40. The canvas measures 0×0 in happy-dom, so its centre is (0, 0) on screen, and at 100% a point (x, y) of
 * the picture is at (x − 50, y − 25).
 */
const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50">' +
    '<polyline class="edge" data-from="A" data-to="B" points="20,40 80,40" />' +
    '<g class="node" data-id="A" data-label="Start"><rect x="10" y="10" width="20" height="20" /></g>' +
    '<g class="node" data-id="B" data-label="B"><rect x="70" y="10" width="20" height="20" /></g>' +
    '</svg>'
/** The same picture with A moved to the right, as a later render might draw it. */
const MOVED_SVG = SVG.replace('<rect x="10" y="10"', '<rect x="40" y="10"')
const SOURCE = 'graph TD\n  A --> B\n  A[Start]'

const NODE_A = { clientX: -30, clientY: -5 }
const LINK = { clientX: 0, clientY: 15 }
const EMPTY = { clientX: 0, clientY: -20 }

function showSvg(svg: string) {
    vi.mocked(useMermaidSvg).mockReturnValue({
        svgForDisplay: svg,
        dimensions: { width: 100, height: 50 },
        error: null,
        currentError: null,
        isStale: false,
        isPending: false,
        isEmpty: false,
    })
}

const locateInTab: LocateInFile = (location): EditorPlace => ({ path: '/w/a.mmd', ...location })

function renderCanvas(source = SOURCE, locateInFile: LocateInFile | null = locateInTab) {
    const view = render(<MermaidCanvas source={source} locateInFile={locateInFile ?? undefined} partsInPalette />)
    const canvas = screen.getByRole('group', { name: 'Diagram canvas' })
    const transform = () => view.container.querySelector<HTMLElement>('.origin-center')!.style.transform
    const outline = () => view.container.querySelector('[data-slot="diagram-pick-outline"]')
    /** Zooms in a step, so a reset can be seen. */
    const zoomIn = () => fireEvent.keyDown(canvas, { key: '+' })
    return { ...view, canvas, transform, outline, zoomIn }
}

async function nextFrame() {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
}

beforeEach(() => {
    state.editorOpen = true
    state.jumpFromPreview = true
    state.revealInEditor.mockReset()
    showSvg(SVG)
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('MermaidCanvas double-click to the source', () => {
    it('selects a node where it is given its label, and leaves the view alone', () => {
        const { canvas, transform, zoomIn } = renderCanvas()
        zoomIn()
        const zoomed = transform()

        fireEvent.doubleClick(canvas, NODE_A)

        expect(state.revealInEditor).toHaveBeenCalledWith('/w/a.mmd', 3, 3, 1)
        expect(transform()).toBe(zoomed)
    })

    it('selects a link from a few pixels away', () => {
        const { canvas } = renderCanvas()

        fireEvent.doubleClick(canvas, { clientX: LINK.clientX, clientY: LINK.clientY + 3 })

        expect(state.revealInEditor).toHaveBeenCalledWith('/w/a.mmd', 2, 3, 7)
    })

    it('resets the view on empty canvas', () => {
        const { canvas, transform, zoomIn } = renderCanvas()
        zoomIn()

        fireEvent.doubleClick(canvas, EMPTY)

        expect(state.revealInEditor).not.toHaveBeenCalled()
        expect(transform()).toBe('translate(0px, 0px) scale(1)')
    })

    it('still pans when a drag starts on a part', () => {
        const { canvas, transform } = renderCanvas()

        fireEvent.pointerDown(canvas, { ...NODE_A, button: 0, pointerId: 1 })
        fireEvent.pointerMove(canvas, { clientX: NODE_A.clientX + 30, clientY: NODE_A.clientY + 10, buttons: 1, pointerId: 1 })
        fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 })

        expect(transform()).toBe('translate(30px, 10px) scale(1)')
        expect(state.revealInEditor).not.toHaveBeenCalled()
    })

    it('only resets the view while the editor is hidden, so showing it later moves nothing', () => {
        state.editorOpen = false
        const { canvas, transform, zoomIn, rerender } = renderCanvas()
        zoomIn()

        fireEvent.doubleClick(canvas, NODE_A)
        expect(transform()).toBe('translate(0px, 0px) scale(1)')

        state.editorOpen = true
        rerender(<MermaidCanvas source={SOURCE} locateInFile={locateInTab} partsInPalette />)
        expect(state.revealInEditor).not.toHaveBeenCalled()
    })

    it('only resets the view with "Double-click the preview to jump to the editor" off', () => {
        state.jumpFromPreview = false
        const { canvas, transform, zoomIn } = renderCanvas()
        zoomIn()

        fireEvent.doubleClick(canvas, NODE_A)

        expect(state.revealInEditor).not.toHaveBeenCalled()
        expect(transform()).toBe('translate(0px, 0px) scale(1)')
    })

    it('only resets the view when its host gives no way to the file', () => {
        const { canvas, outline } = renderCanvas(SOURCE, null)

        fireEvent.doubleClick(canvas, NODE_A)

        expect(state.revealInEditor).not.toHaveBeenCalled()
        expect(outline()).toBeNull()
    })

    it('does nothing for a part the text no longer has', () => {
        const { canvas, transform, zoomIn } = renderCanvas('graph TD\n  B')
        zoomIn()
        const zoomed = transform()

        expect(() => fireEvent.doubleClick(canvas, NODE_A)).not.toThrow()

        expect(state.revealInEditor).not.toHaveBeenCalled()
        expect(transform()).toBe(zoomed)
    })

    it('goes to the place the host gives, such as a Markdown line', () => {
        const locate = vi.fn<LocateInFile>((location) => ({
            path: '/w/notes.md',
            line: location.line + 10,
            column: location.column + 2,
            length: location.length,
        }))
        const { canvas } = renderCanvas(SOURCE, locate)

        fireEvent.doubleClick(canvas, NODE_A)

        expect(locate).toHaveBeenCalledWith({ line: 3, column: 3, length: 1 })
        expect(state.revealInEditor).toHaveBeenCalledWith('/w/notes.md', 13, 5, 1)
    })

    it('picks from the picture on screen while a newer one is still loading', () => {
        vi.useFakeTimers()
        const { canvas, rerender } = renderCanvas()

        // The new picture has A further right, but its frame hasn't loaded, so the old one still shows.
        showSvg(MOVED_SVG)
        rerender(<MermaidCanvas source={SOURCE} locateInFile={locateInTab} partsInPalette />)
        fireEvent.doubleClick(canvas, NODE_A)
        expect(state.revealInEditor).toHaveBeenCalledTimes(1)

        // Once it shows, A is somewhere else.
        act(() => vi.advanceTimersByTime(SWAP_FALLBACK_MS))
        fireEvent.doubleClick(canvas, NODE_A)
        expect(state.revealInEditor).toHaveBeenCalledTimes(1)
        fireEvent.doubleClick(canvas, { clientX: 0, clientY: -5 })
        expect(state.revealInEditor).toHaveBeenCalledTimes(2)
    })
})

describe('MermaidCanvas hover over a part', () => {
    it('outlines the part under the pointer and shows a pointer, once a frame', async () => {
        const { canvas, outline } = renderCanvas()

        fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 0 })
        expect(outline()).toHaveAttribute('d', '')
        await nextFrame()

        expect(outline()!.getAttribute('d')).toBe('M7 7H33V33H7Z')
        expect(canvas.style.cursor).toBe('pointer')

        fireEvent.pointerMove(canvas, { ...LINK, buttons: 0 })
        await nextFrame()
        expect(outline()!.getAttribute('d')).toBe('M20 40L80 40')

        fireEvent.pointerMove(canvas, { ...EMPTY, buttons: 0 })
        await nextFrame()
        expect(outline()).toHaveAttribute('d', '')
        expect(canvas.style.cursor).toBe('')
    })

    it('draws the outline at the same width at any zoom, in the focus colour', () => {
        const { outline } = renderCanvas()

        expect(outline()).toHaveAttribute('vector-effect', 'non-scaling-stroke')
        expect(outline()).toHaveClass('stroke-ring')
    })

    it('clears the outline when the pointer leaves or starts a drag', async () => {
        const { canvas, outline } = renderCanvas()
        fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 0 })
        await nextFrame()

        fireEvent.pointerDown(canvas, { ...NODE_A, button: 0, pointerId: 1 })
        expect(canvas.style.cursor).toBe('')
        fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 1, pointerId: 1 })
        expect(outline()).toHaveAttribute('d', '')
        fireEvent.pointerUp(canvas, { button: 0, pointerId: 1 })

        fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 0 })
        await nextFrame()
        expect(outline()!.getAttribute('d')).not.toBe('')
        fireEvent.pointerLeave(canvas)
        expect(outline()).toHaveAttribute('d', '')
    })

    it('shows no outline over a part the text no longer has', async () => {
        // The picture is from before an error: B is gone from the text.
        const { canvas, outline } = renderCanvas('graph TD\n  A -->')

        fireEvent.pointerMove(canvas, { clientX: 30, clientY: -5, buttons: 0 })
        await nextFrame()
        expect(outline()).toHaveAttribute('d', '')
        expect(canvas.style.cursor).toBe('')

        fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 0 })
        await nextFrame()
        expect(outline()!.getAttribute('d')).toBe('M7 7H33V33H7Z')
    })

    it('shows no outline over the zoom toolbar or an error banner, which take the double-click themselves', async () => {
        // The older picture shows under the error's banner.
        vi.mocked(useMermaidSvg).mockReturnValue({ ...vi.mocked(useMermaidSvg)(SOURCE, null), currentError: 'Parse error', isStale: true })
        const { canvas, outline } = renderCanvas()

        // Over each, at a point of the picture that has node A.
        for (const overlay of [screen.getByRole('group', { name: 'Zoom' }), screen.getByText('Diagram has an error')]) {
            fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 0 })
            await nextFrame()
            expect(outline()!.getAttribute('d')).not.toBe('')

            fireEvent.pointerMove(overlay, { ...NODE_A, buttons: 0 })
            await nextFrame()
            expect(outline()).toHaveAttribute('d', '')
            expect(canvas.style.cursor).toBe('')
        }
    })

    it('shows no outline while a double-click would not jump', async () => {
        state.editorOpen = false
        const { canvas, outline } = renderCanvas()

        fireEvent.pointerMove(canvas, { ...NODE_A, buttons: 0 })
        await nextFrame()

        expect(outline()).toHaveAttribute('d', '')
        expect(canvas.style.cursor).toBe('')
    })

    it('keeps the outline layer away from screen readers, the keyboard and the pointer, with none of the diagram in it', () => {
        const { canvas, outline } = renderCanvas()
        const layer = outline()!.closest('svg')!

        expect(layer).toHaveAttribute('aria-hidden', 'true')
        expect(layer).toHaveClass('pointer-events-none')
        expect(layer.querySelectorAll('[tabindex]')).toHaveLength(0)
        expect(layer.querySelectorAll('*')).toHaveLength(1)
        // Still one image for assistive tech, in its sandboxed frame without scripts.
        expect(screen.getAllByRole('img')).toHaveLength(1)
        for (const frame of screen.getAllByTitle('Diagram preview')) expect(frame).toHaveAttribute('sandbox', '')
        expect(document.querySelector('g.node')).toBeNull()
        expect(canvas).toHaveAccessibleDescription(/Double-click a node, link or message to select its text in the editor/)
        expect(canvas).toHaveAccessibleDescription(/type @ to list the diagram's parts/)
    })
})

describe('MermaidCanvas screen reader hint', () => {
    const DOUBLE_CLICK = /Double-click/
    const PALETTE = /type @ to list/

    it.each([
        ['"Double-click the preview to jump to the editor" is off', () => (state.jumpFromPreview = false)],
        ['the editor is hidden', () => (state.editorOpen = false)],
    ])('leaves out the double-click while %s', (_name, arrange) => {
        arrange()
        const { canvas } = renderCanvas()

        expect(canvas).not.toHaveAccessibleDescription(DOUBLE_CLICK)
        expect(canvas).toHaveAccessibleDescription(PALETTE)
        expect(canvas).toHaveAccessibleDescription(/arrow keys move the diagram/)
    })

    it('mentions no parts for a diagram whose parts cannot be picked', () => {
        const { canvas } = renderCanvas('classDiagram\n  class A')

        expect(canvas).not.toHaveAccessibleDescription(DOUBLE_CLICK)
        expect(canvas).not.toHaveAccessibleDescription(PALETTE)
        expect(canvas).toHaveAccessibleDescription(/arrow keys move the diagram/)
    })
})
