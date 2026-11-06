'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ExpandedMermaidBlock = {
    blockId: string
    source: string
    canvasKey: string
}

type MarkdownExpandContextValue = {
    expanded: ExpandedMermaidBlock | null
    setExpanded: (block: ExpandedMermaidBlock | null) => void
}

type ExpandedState = {
    tabId: string | null
    block: ExpandedMermaidBlock
}

const MarkdownExpandContext = createContext<MarkdownExpandContextValue | null>(null)

/**
 * Holds the expanded Markdown diagram for the active tab. The expanded block belongs to the tab it was opened
 * in, so switching tabs closes it. Children are never remounted on a tab switch: they hold the editor, its undo
 * history and the per-tab canvas zoom.
 */
export function MarkdownExpandProvider({ tabId, children }: { tabId: string | null; children: ReactNode }) {
    const [state, setState] = useState<ExpandedState | null>(null)

    if (state && state.tabId !== tabId) setState(null)

    const expanded = state && state.tabId === tabId ? state.block : null

    const setExpanded = useCallback((block: ExpandedMermaidBlock | null) => setState(block ? { tabId, block } : null), [tabId])

    const value = useMemo(() => ({ expanded, setExpanded }), [expanded, setExpanded])

    return <MarkdownExpandContext.Provider value={value}>{children}</MarkdownExpandContext.Provider>
}

export function useMarkdownExpand(): MarkdownExpandContextValue {
    const ctx = useContext(MarkdownExpandContext)
    if (!ctx) {
        return {
            expanded: null,
            setExpanded: () => {},
        }
    }
    return ctx
}
