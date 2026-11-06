'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
import { queryFromEditorSelection } from '@/components/studio/command-palette/parse-palette-query'
import type { PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
import { usePaletteSearch } from '@/components/studio/command-palette/use-palette-search'
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

type CommandPaletteProviderProps = {
    children: ReactNode
    coordinator: WorkspaceCoordinatorRefs
}

export function CommandPaletteProvider({ children, coordinator }: CommandPaletteProviderProps) {
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<PaletteMode>('all')
    const openRef = useRef(false)

    const { query, setQuery, resetSearch, groups, isSearchingText, textCapped, textUnreadableFiles, runItem, hasWorkspace } = usePaletteSearch(
        mode,
        open
    )

    const openPalette = useCallback(
        (nextMode: PaletteMode = 'all') => {
            setMode(nextMode)
            // Already open (e.g. F1 pressed inside the palette): switch mode but keep what the user typed.
            if (openRef.current) return

            // Like VS Code, only Find in Workspace starts from the editor selection.
            const seed = nextMode === 'text' ? queryFromEditorSelection(coordinator.getEditorSelectedText.current()) : null
            if (seed) setQuery(seed)
            openRef.current = true
            setOpen(true)
        },
        [coordinator, setQuery]
    )

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            openRef.current = nextOpen
            setOpen(nextOpen)
            if (!nextOpen) resetSearch()
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
            if (item.kind === 'text') {
                await runItem(item)
                coordinator.revealInEditor.current(item.path, item.line, item.column)
                return
            }
            await runItem(item)
        },
        [runItem, coordinator]
    )

    return (
        <CommandPaletteContext.Provider value={contextValue}>
            {children}
            <CommandPaletteDialog
                groups={groups}
                hasWorkspace={hasWorkspace}
                isSearchingText={isSearchingText}
                mode={mode}
                onModeChange={setMode}
                onOpenChange={handleOpenChange}
                onQueryChange={setQuery}
                onSelectItem={handleSelectItem}
                open={open}
                query={query}
                textCapped={textCapped}
                textUnreadableFiles={textUnreadableFiles}
            />
        </CommandPaletteContext.Provider>
    )
}
