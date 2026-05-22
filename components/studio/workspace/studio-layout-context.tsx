'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
    STORAGE_LAYOUT_EDITOR,
    STORAGE_LAYOUT_EXPLORER,
    type StudioLayoutState,
} from '@/lib/workspace/types'

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
    const [layout, setLayout] = useState<StudioLayoutState>({
        explorerOpen: true,
        editorOpen: true,
    })

    useEffect(() => {
        const explorer = localStorage.getItem(STORAGE_LAYOUT_EXPLORER)
        const editor = localStorage.getItem(STORAGE_LAYOUT_EDITOR)
        setLayout({
            explorerOpen: explorer !== 'false',
            editorOpen: editor !== 'false',
        })
    }, [])

    const persistLayout = useCallback((next: StudioLayoutState) => {
        setLayout(next)
        localStorage.setItem(STORAGE_LAYOUT_EXPLORER, String(next.explorerOpen))
        localStorage.setItem(STORAGE_LAYOUT_EDITOR, String(next.editorOpen))
    }, [])

    const setExplorerOpen = useCallback((open: boolean) => {
        setLayout((prev) => {
            const next = { ...prev, explorerOpen: open }
            localStorage.setItem(STORAGE_LAYOUT_EXPLORER, String(open))
            return next
        })
    }, [])

    const setEditorOpen = useCallback((open: boolean) => {
        setLayout((prev) => {
            const next = { ...prev, editorOpen: open }
            localStorage.setItem(STORAGE_LAYOUT_EDITOR, String(open))
            return next
        })
    }, [])

    const setPreviewOnly = useCallback(() => persistLayout({ explorerOpen: false, editorOpen: false }), [persistLayout])

    const value = useMemo(
        () => ({
            layout,
            setExplorerOpen,
            setEditorOpen,
            setPreviewOnly,
        }),
        [layout, setExplorerOpen, setEditorOpen, setPreviewOnly]
    )

    return <StudioLayoutContext.Provider value={value}>{children}</StudioLayoutContext.Provider>
}
