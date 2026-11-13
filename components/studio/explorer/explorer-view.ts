'use client'

import { useSyncExternalStore } from 'react'

/** What the explorer shows, shared so the palette can change it: which panel, and requests to show the open file. */

const STORAGE_EXPLORER_PANEL = 'mermaid-studio-explorer-panel'

export type ExplorerPanel = 'files' | 'examples'

const listeners = new Set<() => void>()
let revealRequests = 0

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange)
    return () => listeners.delete(onStoreChange)
}

function notify(): void {
    for (const listener of listeners) listener()
}

function getPanelSnapshot(): ExplorerPanel {
    const stored = sessionStorage.getItem(STORAGE_EXPLORER_PANEL)
    return stored === 'examples' ? 'examples' : 'files'
}

const getPanelServerSnapshot = (): ExplorerPanel => 'files'

/** The explorer panel showing: the folder's files or the examples. Kept for the session. */
export function useExplorerPanel(): ExplorerPanel {
    return useSyncExternalStore(subscribe, getPanelSnapshot, getPanelServerSnapshot)
}

export function setExplorerPanel(value: ExplorerPanel): void {
    sessionStorage.setItem(STORAGE_EXPLORER_PANEL, value)
    notify()
}

/** Asks the file tree to show the open file again: it opens the folders that hold it and scrolls to it. */
export function requestRevealActiveFile(): void {
    revealRequests++
    notify()
}

const getRevealSnapshot = () => revealRequests
const getRevealServerSnapshot = () => 0

/** Goes up by one with each requestRevealActiveFile. */
export function useRevealActiveFileRequests(): number {
    return useSyncExternalStore(subscribe, getRevealSnapshot, getRevealServerSnapshot)
}
