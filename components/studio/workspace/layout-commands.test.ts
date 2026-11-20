import { describe, expect, it, vi } from 'vitest'
import { buildLayoutCommands, type LayoutCommandsContext } from '@/components/studio/workspace/layout-commands'

function context(overrides: Partial<LayoutCommandsContext> = {}): LayoutCommandsContext {
    return {
        hasWorkspace: true,
        explorerOpen: true,
        editorOpen: true,
        previewOpen: true,
        outlineOpen: false,
        focusMode: false,
        canFitDiagram: true,
        setFocusMode: vi.fn(),
        focusEditorSoon: vi.fn(),
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

    it('shows the Outline with all panels and closes it for Editor and Preview, as Preview Only does', () => {
        const closed = context({ outlineOpen: false })
        void find(closed, 'layout-all-panels')!.run()
        expect(closed.setOutlineOpen).toHaveBeenLastCalledWith(true)

        const open = context({ outlineOpen: true })
        void find(open, 'layout-editor-preview')!.run()
        expect(open.setOutlineOpen).toHaveBeenLastCalledWith(false)
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
            'toggle-focus-mode',
        ]) {
            expect(find(ctx, id)).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        }
    })
})

describe('buildLayoutCommands Focus Mode', () => {
    it('turns focus mode on and off, on its shortcut, and says whether it is on', () => {
        const off = context({ focusMode: false })
        expect(find(off, 'toggle-focus-mode')).toMatchObject({
            label: 'Focus Mode',
            checked: false,
            keybind: 'view.toggleFocusMode',
            disabled: false,
        })
        void find(off, 'toggle-focus-mode')!.run()
        expect(off.setFocusMode).toHaveBeenCalledWith(true)

        const on = context({ focusMode: true, explorerOpen: false, previewOpen: false, outlineOpen: false })
        expect(find(on, 'toggle-focus-mode')?.checked).toBe(true)
        void find(on, 'toggle-focus-mode')!.run()
        expect(on.setFocusMode).toHaveBeenCalledWith(false)
    })

    it('moves the keyboard to the editor as focus mode turns on, as the pane that had it may be gone', () => {
        // From the View menu or the palette, which hold focus as the command runs, the editor would not get it otherwise.
        const off = context({ focusMode: false })
        void find(off, 'toggle-focus-mode')!.run()
        expect(off.focusEditorSoon).toHaveBeenCalledOnce()

        // Leaving keeps focus where it is: the tab bar's focus handling covers the editor's empty region.
        const on = context({ focusMode: true, explorerOpen: false, previewOpen: false, outlineOpen: false })
        void find(on, 'toggle-focus-mode')!.run()
        expect(on.focusEditorSoon).not.toHaveBeenCalled()
    })

    it('can be found by the words people use for it', () => {
        const keywords = find(context(), 'toggle-focus-mode')?.keywords
        for (const word of ['distraction', 'writing', 'zen']) expect(keywords).toContain(word)
    })

    it('shows the hidden panes as off in focus mode, so their commands show them rather than hide them', () => {
        // In focus mode the layout reads as only the editor on screen (studio-layout-context.tsx).
        const ctx = context({ focusMode: true, explorerOpen: false, previewOpen: false, outlineOpen: false })
        for (const id of ['toggle-explorer', 'toggle-preview', 'toggle-outline']) expect(find(ctx, id)?.checked).toBe(false)

        void find(ctx, 'toggle-explorer')!.run()
        void find(ctx, 'toggle-preview')!.run()
        void find(ctx, 'toggle-outline')!.run()
        expect(ctx.setExplorerOpen).toHaveBeenCalledWith(true)
        expect(ctx.setPreviewOpen).toHaveBeenCalledWith(true)
        expect(ctx.setOutlineOpen).toHaveBeenCalledWith(true)
        // Focus mode itself is left by those setters, not turned off a second time here.
        expect(ctx.setFocusMode).not.toHaveBeenCalled()
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
