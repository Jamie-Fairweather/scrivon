'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
import type { PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
import { usePaletteSearch } from '@/components/studio/command-palette/use-palette-search'
import { useCommandPaletteShortcut } from '@/components/studio/hooks/use-command-palette-shortcut'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
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
    const { isDesktop } = useWorkspaceSession()
    const [open, setOpen] = useState(false)
    const [mode, setMode] = useState<PaletteMode>('all')

    const { query, setQuery, resetSearch, groups, textCapped, runItem, hasWorkspace } = usePaletteSearch(mode, open)

    const openPalette = useCallback((nextMode: PaletteMode = 'all') => {
        setMode(nextMode)
        setOpen(true)
    }, [])

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

    useCommandPaletteShortcut(isDesktop, openPalette)

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
