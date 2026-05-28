'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export type ExpandedMermaidBlock = {
    blockId: string
    source: string
    canvasKey: string
}

type MarkdownExpandContextValue = {
    expanded: ExpandedMermaidBlock | null
    setExpanded: (block: ExpandedMermaidBlock | null) => void
}

const MarkdownExpandContext = createContext<MarkdownExpandContextValue | null>(null)

export function MarkdownExpandProvider({ tabId, children }: { tabId: string | null; children: ReactNode }) {
    const [expanded, setExpanded] = useState<ExpandedMermaidBlock | null>(null)

    const value = useMemo(() => ({ expanded, setExpanded }), [expanded])

    return (
        <MarkdownExpandContext.Provider key={tabId ?? 'none'} value={value}>
            {children}
        </MarkdownExpandContext.Provider>
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
