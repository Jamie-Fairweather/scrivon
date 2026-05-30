'use client'

import { useMemo, type ReactNode } from 'react'
import { isExampleTabId } from '@/lib/examples/example-tab'
import type { PaletteMode } from '@/components/studio/command-palette/types'
import { useCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import { useGlobalKeybinds } from '@/components/studio/hooks/use-global-keybinds'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import {
    useCanvasFit,
    useDocumentSave,
    useDocumentTabs,
    useStudioLayout,
    useWorkspaceSession,
} from '@/components/studio/workspace/workspace-provider'

type GlobalKeybindsProviderProps = {
    children: ReactNode
}

export function GlobalKeybindsProvider({ children }: GlobalKeybindsProviderProps) {
    const { isDesktop, workspaceRoot } = useWorkspaceSession()
    const { activeTabId } = useDocumentTabs()
    const { flushSave, flushAllSaves } = useDocumentSave()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOnly } = useStudioLayout()
    const { requestCanvasFit } = useCanvasFit()
    const { settings, openSettings } = useAppSettings()
    const { openMode } = useCommandPalette()

    const hasWorkspace = Boolean(workspaceRoot)
    const hasWorkspaceTab = Boolean(activeTabId && !isExampleTabId(activeTabId))

    const handlers = useMemo(
        () => ({
            'document.save': () => {
                if (!hasWorkspaceTab || !activeTabId) return false
                void flushSave(activeTabId)
                return true
            },
            'workspace.saveAll': () => {
                if (!hasWorkspace) return false
                void flushAllSaves()
                return true
            },
            'settings.open': () => {
                openSettings()
                return true
            },
            'palette.open': () => {
                openMode('all' satisfies PaletteMode)
                return true
            },
            'palette.openText': () => {
                openMode('text' satisfies PaletteMode)
                return true
            },
            'palette.openFiles': () => {
                openMode('files' satisfies PaletteMode)
                return true
            },
            'view.toggleExplorer': () => {
                if (!hasWorkspace) return false
                setExplorerOpen(!layout.explorerOpen)
                return true
            },
            'view.toggleEditor': () => {
                if (!hasWorkspace) return false
                setEditorOpen(!layout.editorOpen)
                return true
            },
            'view.previewOnly': () => {
                if (!hasWorkspace) return false
                setPreviewOnly()
                return true
            },
            'view.fitDiagram': () => {
                if (!hasWorkspace) return false
                requestCanvasFit()
                return true
            },
        }),
        [
            activeTabId,
            flushAllSaves,
            flushSave,
            hasWorkspace,
            hasWorkspaceTab,
            layout.editorOpen,
            layout.explorerOpen,
            openMode,
            openSettings,
            requestCanvasFit,
            setEditorOpen,
            setExplorerOpen,
            setPreviewOnly,
        ]
    )

    useGlobalKeybinds(settings.keybinds, handlers, { enabled: isDesktop, hasWorkspace })

    return children
}
