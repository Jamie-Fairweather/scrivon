'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
import { queryFromEditorSelection } from '@/components/studio/command-palette/parse-palette-query'
import type { PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
import { usePaletteSearch } from '@/components/studio/command-palette/use-palette-search'
import { focusEditorFor } from '@/components/studio/editor/editor-focus'
import { DialogErrorBoundary } from '@/components/studio/shell/dialog-error-boundary'
import { notifyError } from '@/lib/notify'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

type CommandPaletteContextValue = {
    open: () => void
    openMode: (mode: PaletteMode) => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
    const ctx = useContext(CommandPaletteContext)
    if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider')
    return ctx
}

/**
 * True while the code editor has keyboard focus. Monaco keeps its selection after the user clicks
 * into the explorer or preview, so only a selection in the editor being worked in seeds the query.
 */
function editorHasFocus(): boolean {
    return document.activeElement?.closest('.monaco-editor') != null
}

type CommandPaletteProviderProps = {
    children: ReactNode
    coordinator: WorkspaceCoordinatorRefs
}

export function CommandPaletteProvider({ children, coordinator }: CommandPaletteProviderProps) {
    const [open, setOpen] = useState(false)
    // Stays true until the close animation ends, so the fading palette keeps showing its results.
    const [mounted, setMounted] = useState(false)
    const [mode, setMode] = useState<PaletteMode>('all')
    const openRef = useRef(false)

    const { query, setQuery, resetSearch, groups, isSearchingText, textCapped, textUnreadableFiles, textTruncatedFiles, runItem, hasWorkspace } =
        usePaletteSearch(mode, mounted)

    const openPalette = useCallback(
        (nextMode: PaletteMode = 'all') => {
            setMode(nextMode)
            // Already open (e.g. F1 pressed inside the palette): switch mode but keep what the user typed.
            if (openRef.current) return

            // Reopened while still fading out: start fresh rather than from the last query.
            resetSearch()
            // Like VS Code, only Find in Workspace starts from the editor selection.
            const seed = nextMode === 'text' && editorHasFocus() ? queryFromEditorSelection(coordinator.getEditorSelectedText.current()) : null
            if (seed) setQuery(seed)
            openRef.current = true
            setMounted(true)
            setOpen(true)
        },
        [coordinator, resetSearch, setQuery]
    )

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        openRef.current = nextOpen
        setOpen(nextOpen)
        if (nextOpen) setMounted(true)
    }, [])

    // Clear the search only once the close animation has finished, so the list doesn't jump while it fades.
    const handleOpenChangeComplete = useCallback(
        (nextOpen: boolean) => {
            if (nextOpen) return
            setMounted(false)
            resetSearch()
        },
        [resetSearch]
    )

    const contextValue = useMemo<CommandPaletteContextValue>(
        () => ({
            open: () => openPalette('all'),
            openMode: openPalette,
        }),
        [openPalette]
    )

    const handleSelectItem = useCallback(
        async (item: PaletteItem) => {
            await runItem(item)
            // A text hit selects the match, which also focuses the editor. A file or tab picked here is
            // there to be worked on, so the editor takes the keyboard as soon as it shows the file.
            if (item.kind === 'text') coordinator.revealInEditor.current(item.path, item.line, item.column, item.length)
            else if (item.kind === 'tab' || item.kind === 'file' || item.kind === 'recent') focusEditorFor(item.path)
        },
        [runItem, coordinator]
    )

    // The palette draws names and lines from the user's files. If that fails, only the palette closes: the
    // studio's own error screen would take the editor (and its unsaved text) down with it. A crashed palette
    // never finishes closing by itself, so the search is cleared here, or reopening would crash on it again.
    const handlePaletteCrash = useCallback(
        (error: Error) => {
            handleOpenChange(false)
            handleOpenChangeComplete(false)
            notifyError("Couldn't show the command palette", error, {
                description: "Something went wrong while drawing it. Your open files weren't affected.",
            })
        },
        [handleOpenChange, handleOpenChangeComplete]
    )

    return (
        <CommandPaletteContext.Provider value={contextValue}>
            {children}
            <DialogErrorBoundary open={open} onCrash={handlePaletteCrash}>
                <CommandPaletteDialog
                    groups={groups}
                    hasWorkspace={hasWorkspace}
                    isSearchingText={isSearchingText}
                    mode={mode}
                    onModeChange={setMode}
                    onOpenChange={handleOpenChange}
                    onOpenChangeComplete={handleOpenChangeComplete}
                    onQueryChange={setQuery}
                    onSelectItem={handleSelectItem}
                    open={open}
                    query={query}
                    textCapped={textCapped}
                    textTruncatedFiles={textTruncatedFiles}
                    textUnreadableFiles={textUnreadableFiles}
                />
            </DialogErrorBoundary>
        </CommandPaletteContext.Provider>
    )
}
