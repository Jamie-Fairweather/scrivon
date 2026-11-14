'use client'

import { useMemo } from 'react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import type { DiagramZoom } from '@/components/studio/canvas/use-pan-zoom'
import type { AppCommand } from '@/components/studio/commands/app-command'
import type { KeybindActionId } from '@/lib/settings/types'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useCanvasFit, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

export type LayoutCommandsContext = {
    hasWorkspace: boolean
    explorerOpen: boolean
    editorOpen: boolean
    previewOpen: boolean
    outlineOpen: boolean
    /** True while a diagram is drawn on screen (a Mermaid tab, or a Markdown diagram opened full size). */
    canFitDiagram: boolean
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setPreviewOpen: (open: boolean) => void
    setOutlineOpen: (open: boolean) => void
    setPreviewOnly: () => void
    requestCanvasFit: () => void
    zoomDiagram: (how: DiagramZoom) => void
}

const NO_FOLDER = 'No folder open'

/** Which panes show, the layouts, and fitting and zooming the diagram. */
export function buildLayoutCommands(ctx: LayoutCommandsContext): AppCommand[] {
    const off = !ctx.hasWorkspace
    const zoom = (id: string, label: string, keywords: string, keybind: KeybindActionId, how: DiagramZoom): AppCommand => ({
        id,
        label,
        keywords: `${keywords} diagram canvas`,
        keybind,
        disabled: off || !ctx.canFitDiagram,
        disabledReason: off ? NO_FOLDER : 'No diagram shown',
        run: () => ctx.zoomDiagram(how),
    })
    // The explorer and the Outline go together: both show for all panels, both close for Editor and Preview.
    const layout = (id: string, label: string, sidePanels: boolean): AppCommand => ({
        id,
        label,
        keywords: 'layout mode view panels panes outline',
        disabled: off,
        disabledReason: NO_FOLDER,
        run: () => {
            ctx.setExplorerOpen(sidePanels)
            ctx.setEditorOpen(true)
            ctx.setPreviewOpen(true)
            ctx.setOutlineOpen(sidePanels)
        },
    })

    return [
        {
            id: 'toggle-explorer',
            label: 'Explorer',
            keywords: 'sidebar files',
            keybind: 'view.toggleExplorer',
            checked: ctx.explorerOpen,
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.setExplorerOpen(!ctx.explorerOpen),
        },
        {
            id: 'toggle-editor',
            label: 'Editor',
            keybind: 'view.toggleEditor',
            checked: ctx.editorOpen,
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.setEditorOpen(!ctx.editorOpen),
        },
        {
            id: 'toggle-preview',
            label: 'Preview',
            keywords: 'diagram editor only full width',
            keybind: 'view.togglePreview',
            checked: ctx.previewOpen,
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.setPreviewOpen(!ctx.previewOpen),
        },
        {
            id: 'toggle-outline',
            label: 'Outline',
            keywords: 'outline headings contents',
            checked: ctx.outlineOpen,
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.setOutlineOpen(!ctx.outlineOpen),
        },
        layout('layout-all-panels', 'Show All Panels', true),
        layout('layout-editor-preview', 'Editor and Preview', false),
        {
            id: 'preview-only',
            label: 'Preview Only',
            keywords: 'preview only layout mode view panels panes',
            keybind: 'view.previewOnly',
            disabled: off,
            disabledReason: NO_FOLDER,
            run: () => ctx.setPreviewOnly(),
        },
        {
            id: 'fit-diagram',
            label: 'Fit Diagram to Screen',
            keywords: 'fit diagram canvas screen zoom',
            keybind: 'view.fitDiagram',
            disabled: off || !ctx.canFitDiagram,
            disabledReason: off ? NO_FOLDER : 'No diagram to fit',
            run: () => ctx.requestCanvasFit(),
        },
        zoom('zoom-diagram-in', 'Zoom Diagram In', 'zoom in bigger magnify', 'view.zoomDiagramIn', 'in'),
        zoom('zoom-diagram-out', 'Zoom Diagram Out', 'zoom out smaller', 'view.zoomDiagramOut', 'out'),
        zoom('reset-diagram-zoom', 'Reset Diagram Zoom', 'zoom reset 100% actual size', 'view.resetDiagramZoom', 'reset'),
    ]
}

export function useLayoutCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOpen, setOutlineOpen, setPreviewOnly } = useStudioLayout()
    const { requestCanvasFit } = useCanvasFit()
    // Off when nothing is drawn (an empty file, a Markdown tab with no diagram opened full size).
    const { canFitToView, zoomDiagram } = useCanvasControls()
    const hasWorkspace = Boolean(workspaceRoot)

    const commands = useMemo(
        () =>
            buildLayoutCommands({
                hasWorkspace,
                explorerOpen: layout.explorerOpen,
                editorOpen: layout.editorOpen,
                previewOpen: layout.previewOpen,
                outlineOpen: layout.outlineOpen,
                canFitDiagram: canFitToView,
                setExplorerOpen,
                setEditorOpen,
                setPreviewOpen,
                setOutlineOpen,
                setPreviewOnly,
                requestCanvasFit,
                zoomDiagram,
            }),
        [
            hasWorkspace,
            layout.explorerOpen,
            layout.editorOpen,
            layout.previewOpen,
            layout.outlineOpen,
            canFitToView,
            setExplorerOpen,
            setEditorOpen,
            setPreviewOpen,
            setOutlineOpen,
            setPreviewOnly,
            requestCanvasFit,
            zoomDiagram,
        ]
    )
    useRegisterCommands(commands)
}
