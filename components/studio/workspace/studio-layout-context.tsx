'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { AppSettings } from '@/lib/settings/types'
import { isPreviewShown } from '@/lib/workspace/layout'
import type { StudioLayoutState } from '@/lib/workspace/types'

type StudioLayoutContextValue = {
    layout: StudioLayoutState
    setExplorerOpen: (open: boolean) => void
    setEditorOpen: (open: boolean) => void
    setPreviewOpen: (open: boolean) => void
    setOutlineOpen: (open: boolean) => void
    setPreviewOnly: () => void
}

const StudioLayoutContext = createContext<StudioLayoutContextValue | null>(null)

export function useStudioLayout(): StudioLayoutContextValue {
    const ctx = useContext(StudioLayoutContext)
    if (!ctx) throw new Error('useStudioLayout must be used within WorkspaceProvider')
    return ctx
}

type Pane = 'editorOpen' | 'previewOpen'

/** Shows or hides the editor or the preview. Hiding the one left on screen shows the other, so the window is never empty. */
function withPaneOpen(settings: AppSettings, pane: Pane, open: boolean): AppSettings {
    const layout = { ...settings.layout, [pane]: open }
    if (!layout.editorOpen && !layout.previewOpen) layout[pane === 'editorOpen' ? 'previewOpen' : 'editorOpen'] = true
    return { ...settings, layout }
}

export function StudioLayoutProvider({ children }: { children: ReactNode }) {
    const { settings, updateSettings, setLayoutExplorerOpen } = useAppSettings()

    const { explorerOpen, editorOpen, previewOpen, outlineOpen } = settings.layout
    const layout = useMemo<StudioLayoutState>(
        () => ({ explorerOpen, editorOpen, previewOpen: isPreviewShown({ previewOpen, editorOpen }), outlineOpen }),
        [explorerOpen, editorOpen, previewOpen, outlineOpen]
    )

    const setEditorOpen = useCallback((open: boolean) => updateSettings((current) => withPaneOpen(current, 'editorOpen', open)), [updateSettings])

    const setPreviewOpen = useCallback((open: boolean) => updateSettings((current) => withPaneOpen(current, 'previewOpen', open)), [updateSettings])

    const setOutlineOpen = useCallback(
        (open: boolean) => updateSettings((current) => ({ ...current, layout: { ...current.layout, outlineOpen: open } })),
        [updateSettings]
    )

    const setPreviewOnly = useCallback(() => {
        setLayoutExplorerOpen(false)
        setPreviewOpen(true)
        setEditorOpen(false)
        setOutlineOpen(false)
    }, [setLayoutExplorerOpen, setPreviewOpen, setEditorOpen, setOutlineOpen])

    const value = useMemo(
        () => ({
            layout,
            setExplorerOpen: setLayoutExplorerOpen,
            setEditorOpen,
            setPreviewOpen,
            setOutlineOpen,
            setPreviewOnly,
        }),
        [layout, setLayoutExplorerOpen, setEditorOpen, setPreviewOpen, setOutlineOpen, setPreviewOnly]
    )

    return <StudioLayoutContext.Provider value={value}>{children}</StudioLayoutContext.Provider>
}
