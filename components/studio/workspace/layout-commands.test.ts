import { describe, expect, it, vi } from 'vitest'
import { buildLayoutCommands, type LayoutCommandsContext } from '@/components/studio/workspace/layout-commands'

function context(overrides: Partial<LayoutCommandsContext> = {}): LayoutCommandsContext {
    return {
        hasWorkspace: true,
        explorerOpen: true,
        editorOpen: true,
        canFitDiagram: true,
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setPreviewOnly: vi.fn(),
        requestCanvasFit: vi.fn(),
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
})

describe('buildLayoutCommands layout modes', () => {
    it('switches to each layout', () => {
        const ctx = context({ explorerOpen: false, editorOpen: false })

        void find(ctx, 'layout-all-panels')!.run()
        expect(ctx.setExplorerOpen).toHaveBeenLastCalledWith(true)
        expect(ctx.setEditorOpen).toHaveBeenLastCalledWith(true)

        void find(ctx, 'layout-editor-preview')!.run()
        expect(ctx.setExplorerOpen).toHaveBeenLastCalledWith(false)
        expect(ctx.setEditorOpen).toHaveBeenLastCalledWith(true)

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
        for (const id of ['toggle-explorer', 'toggle-editor', 'layout-all-panels', 'layout-editor-preview', 'preview-only']) {
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
