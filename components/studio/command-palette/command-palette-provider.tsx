'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CommandPaletteDialog } from '@/components/studio/command-palette/command-palette-dialog'
import { queryForMode, queryFromEditorSelection } from '@/components/studio/command-palette/parse-palette-query'
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
    const ctx = useOptionalCommandPalette()
    if (!ctx) throw new Error('useCommandPalette must be used within CommandPaletteProvider')
    return ctx
}

/**
 * The palette, or null when there is no CommandPaletteProvider above. For parts that work without
 * it and only offer the palette as a shortcut, such as the editor's right-click 'Command Palette'.
 */
export function useOptionalCommandPalette(): CommandPaletteContextValue | null {
    return useContext(CommandPaletteContext)
}

/** The menu bar and its menus, where focus goes on the way to a menu command. */
const MENUS = '[role="menubar"], [role="menu"]'

function inEditor(el: unknown): boolean {
    return el instanceof Element && el.closest('.monaco-editor') != null
}

/**
 * True while the code editor has keyboard focus, or had it just before the menu bar took it, so Edit → Find
 * in Workspace… works like its keys. Monaco keeps its selection after the user clicks into the explorer or
 * preview, so only a selection in the editor being worked in seeds the query.
 */
function useEditorHasFocus(): () => boolean {
    const editorBeforeMenusRef = useRef(false)

    useEffect(() => {
        const onFocusIn = (e: FocusEvent) => {
            if (!(e.target instanceof Element) || !e.target.closest(MENUS)) return
            const from = e.relatedTarget
            // Moving between menus keeps what was there before them.
            if (from instanceof Element && from.closest(MENUS)) return
            editorBeforeMenusRef.current = inEditor(from)
        }
        document.addEventListener('focusin', onFocusIn)
        return () => document.removeEventListener('focusin', onFocusIn)
    }, [])

    return useCallback(() => {
        const active = document.activeElement
        return active?.closest(MENUS) ? editorBeforeMenusRef.current : inEditor(active)
    }, [])
}

type CommandPaletteProviderProps = {
    children: ReactNode
    coordinator: WorkspaceCoordinatorRefs
}

export function CommandPaletteProvider({ children, coordinator }: CommandPaletteProviderProps) {
    const [open, setOpen] = useState(false)
    // Stays true until the close animation ends, so the fading palette keeps showing its results.
    const [mounted, setMounted] = useState(false)
    const [mode, setModeState] = useState<PaletteMode>('all')
    const modeRef = useRef<PaletteMode>('all')
    const openRef = useRef(false)
    const editorHasFocus = useEditorHasFocus()

    const {
        query,
        setQuery,
        resetSearch,
        groups,
        isSearchingText,
        textCapped,
        textUnreadableFiles,
        textTruncatedFiles,
        runItem,
        hasWorkspace,
        emptyHint,
    } = usePaletteSearch(mode, mounted)

    // Keeps a Find in Workspace search for '@media' a search when the Text filter is removed, not a jump to a heading.
    const setMode = useCallback(
        (nextMode: PaletteMode) => {
            const from = modeRef.current
            modeRef.current = nextMode
            setModeState(nextMode)
            setQuery((current) => queryForMode(current, from, nextMode))
        },
        [setQuery]
    )

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
        [coordinator, editorHasFocus, resetSearch, setQuery, setMode]
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
            // A file or tab picked here is there to be worked on, so the editor takes the keyboard as soon as it
            // shows the file. (Text hits and lines move the editor in runItem, which focuses it too.)
            if (item.kind === 'tab' || item.kind === 'file' || item.kind === 'recent') focusEditorFor(item.path)
        },
        [runItem]
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
                    emptyHint={emptyHint}
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
