'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { StudioLayoutState } from '@/lib/workspace/types'

type StudioLayoutContextValue = {
    layout: StudioLayoutState
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setPreviewOnly: () => void
}

const StudioLayoutContext = createContext<StudioLayoutContextValue | null>(null)

export function useStudioLayout(): StudioLayoutContextValue {
    const ctx = useContext(StudioLayoutContext)
    if (!ctx) throw new Error('useStudioLayout must be used within WorkspaceProvider')
    return ctx
}

export function StudioLayoutProvider({ children }: { children: ReactNode }) {
    const { settings, setLayoutExplorerOpen, setLayoutEditorOpen } = useAppSettings()

    const layout = useMemo<StudioLayoutState>(
        () => ({
            explorerOpen: settings.layout.explorerOpen,
            editorOpen: settings.layout.editorOpen,
        }),
        [settings.layout.explorerOpen, settings.layout.editorOpen]
    )

    const setPreviewOnly = useCallback(() => {
        setLayoutExplorerOpen(false)
        setLayoutEditorOpen(false)
    }, [setLayoutExplorerOpen, setLayoutEditorOpen])

    const value = useMemo(
        () => ({
            layout,
            setExplorerOpen: setLayoutExplorerOpen,
            setEditorOpen: setLayoutEditorOpen,
            setPreviewOnly,
        }),
        [layout, setLayoutExplorerOpen, setLayoutEditorOpen, setPreviewOnly]
    )

    return <StudioLayoutContext.Provider value={value}>{children}</StudioLayoutContext.Provider>
}
