'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

export type ExpandedMermaidBlock = {
    blockId: string
    /** Position among the document's Mermaid blocks, used to follow the block's live source while expanded. */
    ordinal: number
    /** The block's current source; kept in step with the document, and what diagram export uses. */
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

/**
 * Preview state for each tab that has to outlive the preview itself, which unmounts while a diagram tab (or no
 * tab) is showing.
 */
export type MarkdownPreviewMemory = {
    /** Last preview scroll position of each tab. */
    scrollTopByTab: Map<string, number>
    /** Tabs whose web images the user chose to load. Kept until Scrivon closes. */
    remoteImageTabs: ReadonlySet<string>
    allowRemoteImages: (tabId: string) => void
}

const MarkdownExpandContext = createContext<MarkdownExpandContextValue | null>(null)
const MarkdownPreviewMemoryContext = createContext<MarkdownPreviewMemory | null>(null)

function usePreviewMemoryState(): MarkdownPreviewMemory {
    const [scrollTopByTab] = useState(() => new Map<string, number>())
    const [remoteImageTabs, setRemoteImageTabs] = useState<ReadonlySet<string>>(() => new Set())
    const allowRemoteImages = useCallback((tabId: string) => setRemoteImageTabs((tabs) => (tabs.has(tabId) ? tabs : new Set(tabs).add(tabId))), [])
    return useMemo(() => ({ scrollTopByTab, remoteImageTabs, allowRemoteImages }), [scrollTopByTab, remoteImageTabs, allowRemoteImages])
}

/**
 * Holds the expanded Markdown diagram for the active tab. The expanded block belongs to the tab it was opened
 * in, so switching tabs closes it. Children are never remounted on a tab switch: they hold the editor, its undo
 * history and the per-tab canvas zoom. Also holds each tab's {@link MarkdownPreviewMemory}.
 */
export function MarkdownExpandProvider({ tabId, children }: { tabId: string | null; children: ReactNode }) {
    const [state, setState] = useState<ExpandedState | null>(null)
    const memory = usePreviewMemoryState()

    if (state && state.tabId !== tabId) setState(null)

    const expanded = state && state.tabId === tabId ? state.block : null

    const setExpanded = useCallback((block: ExpandedMermaidBlock | null) => setState(block ? { tabId, block } : null), [tabId])

    const value = useMemo(() => ({ expanded, setExpanded }), [expanded, setExpanded])

    return (
        <MarkdownPreviewMemoryContext.Provider value={memory}>
            <MarkdownExpandContext.Provider value={value}>{children}</MarkdownExpandContext.Provider>
        </MarkdownPreviewMemoryContext.Provider>
    )
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

/** The provider's {@link MarkdownPreviewMemory}; outside one, memory that lasts as long as the calling component. */
export function useMarkdownPreviewMemory(): MarkdownPreviewMemory {
    const ctx = useContext(MarkdownPreviewMemoryContext)
    const own = usePreviewMemoryState()
    return ctx ?? own
}
