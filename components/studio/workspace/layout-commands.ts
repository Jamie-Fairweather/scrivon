'use client'

import { useMemo } from 'react'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import type { AppCommand } from '@/components/studio/commands/app-command'
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
}

const NO_FOLDER = 'No folder open'

/** Which panes show, the layouts, and fitting the diagram. */
export function buildLayoutCommands(ctx: LayoutCommandsContext): AppCommand[] {
    const off = !ctx.hasWorkspace
    const layout = (id: string, label: string, explorer: boolean, editor: boolean): AppCommand => ({
        id,
        label,
        keywords: 'layout mode view panels panes',
        disabled: off,
        disabledReason: NO_FOLDER,
        run: () => {
            ctx.setExplorerOpen(explorer)
            ctx.setEditorOpen(editor)
            ctx.setPreviewOpen(true)
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
        layout('layout-all-panels', 'Show All Panels', true, true),
        layout('layout-editor-preview', 'Editor and Preview', false, true),
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
    ]
}

export function useLayoutCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOpen, setOutlineOpen, setPreviewOnly } = useStudioLayout()
    const { requestCanvasFit } = useCanvasFit()
    // Off when nothing is drawn (an empty file, a Markdown tab with no diagram opened full size).
    const { canFitToView } = useCanvasControls()
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
        ]
    )
    useRegisterCommands(commands)
}
