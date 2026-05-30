'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
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

    const { query, setQuery, resetSearch, groups, isSearchingText, textCapped, runItem, hasWorkspace } = usePaletteSearch(mode, open)

    const openPalette = useCallback(
        (nextMode: PaletteMode = 'all') => {
            const selectedText = coordinator.getEditorSelectedText.current()?.trim()
            if (selectedText) {
                setQuery(selectedText)
            }
            setMode(nextMode)
            setOpen(true)
        },
        [coordinator, setQuery]
    )

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
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
                onOpenChange={handleOpenChange}
                onQueryChange={setQuery}
                onSelectItem={handleSelectItem}
                open={open}
                query={query}
                textCapped={textCapped}
            />
        </CommandPaletteContext.Provider>
    )
}
