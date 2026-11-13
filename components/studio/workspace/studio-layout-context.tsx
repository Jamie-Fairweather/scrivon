'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { StudioLayoutState } from '@/lib/workspace/types'

type StudioLayoutContextValue = {
    layout: StudioLayoutState
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setOutlineOpen: (open: boolean) => void
    setPreviewOnly: () => void
}

const StudioLayoutContext = createContext<StudioLayoutContextValue | null>(null)

export function useStudioLayout(): StudioLayoutContextValue {
    const ctx = useContext(StudioLayoutContext)
    if (!ctx) throw new Error('useStudioLayout must be used within WorkspaceProvider')
    return ctx
}

export function StudioLayoutProvider({ children }: { children: ReactNode }) {
    const { settings, updateSettings, setLayoutExplorerOpen, setLayoutEditorOpen } = useAppSettings()

    const layout = useMemo<StudioLayoutState>(
        () => ({
            explorerOpen: settings.layout.explorerOpen,
            editorOpen: settings.layout.editorOpen,
            outlineOpen: settings.layout.outlineOpen,
        }),
        [settings.layout.explorerOpen, settings.layout.editorOpen, settings.layout.outlineOpen]
    )

    const setOutlineOpen = useCallback(
        (open: boolean) => updateSettings((current) => ({ ...current, layout: { ...current.layout, outlineOpen: open } })),
        [updateSettings]
    )

    const setPreviewOnly = useCallback(() => {
        setLayoutExplorerOpen(false)
        setLayoutEditorOpen(false)
        setOutlineOpen(false)
    }, [setLayoutExplorerOpen, setLayoutEditorOpen, setOutlineOpen])

    const value = useMemo(
        () => ({
            layout,
            setExplorerOpen: setLayoutExplorerOpen,
            setEditorOpen: setLayoutEditorOpen,
            setOutlineOpen,
            setPreviewOnly,
        }),
        [layout, setLayoutExplorerOpen, setLayoutEditorOpen, setOutlineOpen, setPreviewOnly]
    )

    return <StudioLayoutContext.Provider value={value}>{children}</StudioLayoutContext.Provider>
}
