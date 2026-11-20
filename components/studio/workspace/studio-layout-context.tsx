'use client'

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { AppSettings } from '@/lib/settings/types'
import { shownLayout } from '@/lib/workspace/layout'
import type { StudioLayoutState } from '@/lib/workspace/types'

type StudioLayoutContextValue = {
    /** The panes on screen: in focus mode, only the editor. */
    layout: StudioLayoutState
    /** Only the editor shows, filling the window. The tab bar and the status bar are hidden too. */
    focusMode: boolean
    setFocusMode: (on: boolean) => void
    // Each of these leaves focus mode when it shows a pane focus mode hides (or hides the editor), so that pane really
    // appears. Otherwise focus mode stays, and the change is kept for when it ends.
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

type Pane = 'explorerOpen' | 'editorOpen' | 'previewOpen' | 'outlineOpen'

/**
 * Whether showing or hiding this pane changes what focus mode shows, so focus mode has to end for it. Showing the
 * editor doesn't (it is the one pane there, so Find in Workspace and Go to Line keep focus mode), and nor does hiding
 * a pane focus mode already hides. Showing any other pane, or hiding the editor, does.
 */
function leavesFocusMode(pane: Pane, open: boolean): boolean {
    return pane === 'editorOpen' ? !open : open
}

/**
 * Shows or hides a pane, leaving focus mode when that changes what is on screen. In focus mode, a change that
 * doesn't is kept for when it ends. Hiding the editor or the preview while it is the one left on screen shows the
 * other, so the window is never empty.
 */
function withPaneOpen(settings: AppSettings, pane: Pane, open: boolean): AppSettings {
    const focusMode = settings.layout.focusMode && !leavesFocusMode(pane, open)
    const layout = { ...settings.layout, [pane]: open, focusMode }
    if (!layout.editorOpen && !layout.previewOpen) layout[pane === 'editorOpen' ? 'previewOpen' : 'editorOpen'] = true
    return { ...settings, layout }
}

export function StudioLayoutProvider({ children }: { children: ReactNode }) {
    const { settings, updateSettings } = useAppSettings()

    const { explorerOpen, editorOpen, previewOpen, outlineOpen, focusMode } = settings.layout
    const layout = useMemo<StudioLayoutState>(
        () => shownLayout({ explorerOpen, editorOpen, previewOpen, outlineOpen }, focusMode),
        [explorerOpen, editorOpen, previewOpen, outlineOpen, focusMode]
    )

    const setPane = useCallback((pane: Pane, open: boolean) => updateSettings((current) => withPaneOpen(current, pane, open)), [updateSettings])
    const setExplorerOpen = useCallback((open: boolean) => setPane('explorerOpen', open), [setPane])
    const setEditorOpen = useCallback((open: boolean) => setPane('editorOpen', open), [setPane])
    const setPreviewOpen = useCallback((open: boolean) => setPane('previewOpen', open), [setPane])
    const setOutlineOpen = useCallback((open: boolean) => setPane('outlineOpen', open), [setPane])

    const setFocusMode = useCallback(
        (on: boolean) => updateSettings((current) => ({ ...current, layout: { ...current.layout, focusMode: on } })),
        [updateSettings]
    )

    const setPreviewOnly = useCallback(() => {
        setExplorerOpen(false)
        setPreviewOpen(true)
        setEditorOpen(false)
        setOutlineOpen(false)
    }, [setExplorerOpen, setPreviewOpen, setEditorOpen, setOutlineOpen])

    const value = useMemo(
        () => ({
            layout,
            focusMode,
            setFocusMode,
            setExplorerOpen,
            setEditorOpen,
            setPreviewOpen,
            setOutlineOpen,
            setPreviewOnly,
        }),
        [layout, focusMode, setFocusMode, setExplorerOpen, setEditorOpen, setPreviewOpen, setOutlineOpen, setPreviewOnly]
    )

    return <StudioLayoutContext.Provider value={value}>{children}</StudioLayoutContext.Provider>
}
