import { describe, expect, it, vi } from 'vitest'
import { buildLayoutCommands, type LayoutCommandsContext } from '@/components/studio/workspace/layout-commands'

function context(overrides: Partial<LayoutCommandsContext> = {}): LayoutCommandsContext {
    return {
        hasWorkspace: true,
        explorerOpen: true,
        editorOpen: true,
        previewOpen: true,
        outlineOpen: false,
        canFitDiagram: true,
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setPreviewOpen: vi.fn(),
        setOutlineOpen: vi.fn(),
        setPreviewOnly: vi.fn(),
        requestCanvasFit: vi.fn(),
        zoomDiagram: vi.fn(),
        ...overrides,
    }
}

const find = (ctx: LayoutCommandsContext, id: string) => buildLayoutCommands(ctx).find((command) => command.id === id)

describe('buildLayoutCommands panes', () => {
    it('shows the explorer and editor as on/off, on their shortcuts, and flips them', () => {
        const ctx = context({ explorerOpen: true, editorOpen: false })
        expect(find(ctx, 'toggle-explorer')).toMatchObject({ label: 'Explorer', checked: true, keybind: 'view.toggleExplorer' })
        expect(find(ctx, 'toggle-editor')).toMatchObject({ label: 'Editor', checked: false, keybind: 'view.toggleEditor' })

        void find(ctx, 'toggle-explorer')!.run()
        void find(ctx, 'toggle-editor')!.run()
        expect(ctx.setExplorerOpen).toHaveBeenCalledWith(false)
        expect(ctx.setEditorOpen).toHaveBeenCalledWith(true)
    })

    it('shows and hides the preview, on its shortcut', () => {
        const shown = context({ previewOpen: true })
        expect(find(shown, 'toggle-preview')).toMatchObject({ label: 'Preview', checked: true, keybind: 'view.togglePreview', disabled: false })
        void find(shown, 'toggle-preview')!.run()
        expect(shown.setPreviewOpen).toHaveBeenCalledWith(false)

        const hidden = context({ previewOpen: false })
        expect(find(hidden, 'toggle-preview')?.checked).toBe(false)
        void find(hidden, 'toggle-preview')!.run()
        expect(hidden.setPreviewOpen).toHaveBeenCalledWith(true)
    })

    it('shows and hides the Outline panel', () => {
        const closed = context({ outlineOpen: false })
        expect(find(closed, 'toggle-outline')).toMatchObject({ label: 'Outline', checked: false, disabled: false })
        void find(closed, 'toggle-outline')!.run()
        expect(closed.setOutlineOpen).toHaveBeenCalledWith(true)

        const open = context({ outlineOpen: true })
        expect(find(open, 'toggle-outline')?.checked).toBe(true)
        void find(open, 'toggle-outline')!.run()
        expect(open.setOutlineOpen).toHaveBeenCalledWith(false)
    })
})

describe('buildLayoutCommands layout modes', () => {
    it('switches to each layout', () => {
        const ctx = context({ explorerOpen: false, editorOpen: false })

        void find(ctx, 'layout-all-panels')!.run()
        expect(ctx.setExplorerOpen).toHaveBeenLastCalledWith(true)
        expect(ctx.setEditorOpen).toHaveBeenLastCalledWith(true)
        expect(ctx.setPreviewOpen).toHaveBeenLastCalledWith(true)

        const editorOnly = context({ previewOpen: false })
        void find(editorOnly, 'layout-editor-preview')!.run()
        expect(editorOnly.setExplorerOpen).toHaveBeenLastCalledWith(false)
        expect(editorOnly.setEditorOpen).toHaveBeenLastCalledWith(true)
        expect(editorOnly.setPreviewOpen).toHaveBeenLastCalledWith(true)

        void find(ctx, 'preview-only')!.run()
        expect(ctx.setPreviewOnly).toHaveBeenCalledTimes(1)
        expect(find(ctx, 'preview-only')?.keybind).toBe('view.previewOnly')
    })

    it('can be found by typing "layout"', () => {
        for (const id of ['layout-all-panels', 'layout-editor-preview', 'preview-only']) {
            expect(find(context(), id)?.keywords).toContain('layout')
        }
    })

    it('turns the layout commands off with no folder open, and says why', () => {
        const ctx = context({ hasWorkspace: false })
        for (const id of [
            'toggle-explorer',
            'toggle-editor',
            'toggle-preview',
            'toggle-outline',
            'layout-all-panels',
            'layout-editor-preview',
            'preview-only',
        ]) {
            expect(find(ctx, id)).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        }
    })
})

describe('buildLayoutCommands Fit Diagram to Screen', () => {
    it('fits the diagram, and is off with a reason when none is drawn', () => {
        const ctx = context()
        void find(ctx, 'fit-diagram')!.run()
        expect(ctx.requestCanvasFit).toHaveBeenCalledTimes(1)
        expect(find(ctx, 'fit-diagram')).toMatchObject({ disabled: false, keybind: 'view.fitDiagram' })

        expect(find(context({ canFitDiagram: false }), 'fit-diagram')).toMatchObject({ disabled: true, disabledReason: 'No diagram to fit' })
        expect(find(context({ hasWorkspace: false, canFitDiagram: false }), 'fit-diagram')).toMatchObject({
            disabled: true,
            disabledReason: 'No folder open',
        })
    })
})

describe('buildLayoutCommands diagram zoom (F06)', () => {
    const zoomCommands = [
        ['zoom-diagram-in', 'Zoom Diagram In', 'view.zoomDiagramIn', 'in'],
        ['zoom-diagram-out', 'Zoom Diagram Out', 'view.zoomDiagramOut', 'out'],
        ['reset-diagram-zoom', 'Reset Diagram Zoom', 'view.resetDiagramZoom', 'reset'],
    ] as const

    it('zooms the diagram in, out and back to 100%, on their own shortcuts', () => {
        const ctx = context()
        for (const [id, label, keybind, how] of zoomCommands) {
            const command = find(ctx, id)
            expect(command).toMatchObject({ label, keybind, disabled: false })
            expect(command?.keywords).toContain('zoom')
            void command!.run()
            expect(ctx.zoomDiagram).toHaveBeenLastCalledWith(how)
        }
    })

    it('is off with a reason when no diagram is shown or no folder is open', () => {
        for (const [id] of zoomCommands) {
            expect(find(context({ canFitDiagram: false }), id)).toMatchObject({ disabled: true, disabledReason: 'No diagram shown' })
            expect(find(context({ hasWorkspace: false }), id)).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        }
    })
})
