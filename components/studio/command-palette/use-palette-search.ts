'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError } from '@/lib/notify'
import { getBaseName, getWorkspaceFileSize, readWorkspaceFile } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { getRecentFiles } from '@/lib/tauri/store'
import { flattenSupportedFilePaths } from '@/lib/workspace/flatten-file-tree'
import { buildCommandRegistry, themeToggleTarget, type ThemeToggle } from '@/components/studio/command-palette/command-registry'
import { parsePaletteQuery } from '@/components/studio/command-palette/parse-palette-query'
import { searchActions } from '@/components/studio/command-palette/search-actions'
import {
    createContentCache,
    DEBOUNCE_MS,
    MIN_QUERY_LENGTH,
    searchWorkspaceContent,
    textHitToPaletteItem,
    type SearchWorkspaceContentResult,
} from '@/components/studio/command-palette/search-content'
import { resolveRecentFiles, searchFiles, searchOpenTabs, searchRecentFiles } from '@/components/studio/command-palette/search-files'
import type { ActionPaletteItem, PaletteGroup, PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import {
    useCanvasFit,
    useDocumentSave,
    useDocumentTabs,
    useStudioLayout,
    useWorkspaceSession,
} from '@/components/studio/workspace/workspace-provider'

function buildWorkspaceItems(recentWorkspaces: string[], query: string): PaletteGroup | null {
    const filtered = recentWorkspaces
        .map((path) => ({
            kind: 'workspace' as const,
            value: `workspace:${path}`,
            searchText: `${getBaseName(path)} ${path}`,
            path,
            name: getBaseName(path),
        }))
        .filter((item) => !query || item.searchText.toLowerCase().includes(query.toLowerCase()))

    if (filtered.length === 0) return null
    return { id: 'workspaces', label: 'Workspaces', items: filtered }
}

/** What a closed palette shows: nothing, so editor keystrokes don't re-rank every file. */
const NO_GROUPS: PaletteGroup[] = []

/** How many commands the default (no '>') results show next to files. */
export const MAX_MIXED_COMMANDS = 5

/**
 * The best few commands for the default results, so F1 finds commands without typing '>'.
 * With nothing typed only runnable commands are suggested. While typing, a matching command that
 * can't run stays in place with its reason, rather than letting a weaker match take its spot and
 * run on Enter. With no folder open, recent folders already have their own group.
 */
function buildMixedCommandGroup(actions: ActionPaletteItem[], query: string, hasWorkspace: boolean): PaletteGroup | null {
    const items = searchActions(actions, query)
        .filter((action) => (query || !action.disabled) && (hasWorkspace || !action.value.startsWith('action:recent-workspace:')))
        .slice(0, MAX_MIXED_COMMANDS)
    if (items.length === 0) return null
    return { id: 'actions', label: 'Commands', items }
}

export function usePaletteSearch(mode: PaletteMode, enabled: boolean) {
    const { isDesktop, workspaceRoot, tree, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace } = useWorkspaceSession()
    const { tabs, activeTabId, openFile, openExample, setActiveTab, closeTab, closeOtherTabs, closeAllTabs } = useDocumentTabs()
    const { autosaveEnabled, setAutosaveEnabled, flushSave, flushAllSaves } = useDocumentSave()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOnly } = useStudioLayout()
    const { requestCanvasFit } = useCanvasFit()
    const { themeId, isLight, setThemeId } = useAppTheme()
    const { settings, openSettings } = useAppSettings()

    const [query, setQuery] = useState('')
    const [recentFilesState, setRecentFilesState] = useState<{ root: string; paths: string[] } | null>(null)
    const [textItems, setTextItems] = useState<PaletteGroup | null>(null)
    const [textCapped, setTextCapped] = useState(false)
    const [textUnreadableFiles, setTextUnreadableFiles] = useState(0)
    const [textTruncatedFiles, setTextTruncatedFiles] = useState(0)
    const [lastResolvedTextQuery, setLastResolvedTextQuery] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    // File text read by earlier searches in this palette session (cleared on close and folder change).
    const [contentCache] = useState(() => createContentCache())

    const parsedQueryState = useMemo(() => parsePaletteQuery(query), [query])
    const shouldSearchText =
        enabled && Boolean(workspaceRoot) && !parsedQueryState.actionsOnly && mode !== 'files' && parsedQueryState.query.length >= MIN_QUERY_LENGTH
    // Text results (and their footer notes) only count for the query they were found for, so
    // hits for something the user has typed past are never shown or opened by a quick Enter.
    const textResolved = shouldSearchText && lastResolvedTextQuery === parsedQueryState.query
    const isSearchingText = shouldSearchText && !textResolved

    const recentFiles = useMemo(() => (recentFilesState?.root === workspaceRoot ? recentFilesState.paths : []), [recentFilesState, workspaceRoot])

    useEffect(() => {
        if (!enabled || !workspaceRoot) return
        void getRecentFiles(workspaceRoot)
            .then((paths) => setRecentFilesState({ root: workspaceRoot, paths }))
            .catch(() => setRecentFilesState({ root: workspaceRoot, paths: [] }))
    }, [enabled, workspaceRoot])

    useEffect(() => {
        contentCache.clear()
    }, [contentCache, workspaceRoot])

    const resetSearch = useCallback(() => {
        abortRef.current?.abort()
        contentCache.clear()
        setQuery('')
        setLastResolvedTextQuery(null)
        setTextItems(null)
        setTextCapped(false)
        setTextUnreadableFiles(0)
        setTextTruncatedFiles(0)
    }, [contentCache])

    // Kept for the app session, so switching light/dark twice lands back on the user's theme.
    const [lastThemeToggle, setLastThemeToggle] = useState<ThemeToggle | null>(null)
    const toggleLightDark = useCallback(() => {
        const target = themeToggleTarget(themeId, lastThemeToggle)
        setLastThemeToggle({ from: themeId, to: target })
        setThemeId(target)
    }, [themeId, lastThemeToggle, setThemeId])

    const hasDirtyTabs = useMemo(() => tabs.some((t) => t.isDirty && !isExampleTabId(t.id)), [tabs])

    const allActions = useMemo(
        () =>
            buildCommandRegistry({
                isDesktop,
                workspaceRoot,
                recentWorkspaces,
                activeTabId,
                hasDirtyTabs,
                autosaveEnabled,
                explorerOpen: layout.explorerOpen,
                editorOpen: layout.editorOpen,
                keybinds: settings.keybinds,
                pickAndOpenWorkspace,
                openWorkspace,
                closeWorkspace,
                flushSave,
                flushAllSaves,
                setAutosaveEnabled,
                setExplorerOpen,
                setEditorOpen,
                setPreviewOnly,
                requestCanvasFit,
                closeTab,
                closeOtherTabs,
                closeAllTabs,
                openExample,
                openSettings,
                isLight,
                toggleLightDark,
            }),
        [
            isDesktop,
            workspaceRoot,
            recentWorkspaces,
            activeTabId,
            hasDirtyTabs,
            autosaveEnabled,
            layout.explorerOpen,
            layout.editorOpen,
            settings.keybinds,
            pickAndOpenWorkspace,
            openWorkspace,
            closeWorkspace,
            flushSave,
            flushAllSaves,
            setAutosaveEnabled,
            setExplorerOpen,
            setEditorOpen,
            setPreviewOnly,
            requestCanvasFit,
            closeTab,
            closeOtherTabs,
            closeAllTabs,
            openExample,
            openSettings,
            isLight,
            toggleLightDark,
        ]
    )

    const filePaths = useMemo(() => (workspaceRoot ? flattenSupportedFilePaths(tree) : []), [workspaceRoot, tree])
    const liveRecentFiles = useMemo(() => resolveRecentFiles(recentFiles, filePaths), [recentFiles, filePaths])

    const groups = useMemo((): PaletteGroup[] => {
        // `enabled` stays true until the close animation ends, so the fading list keeps its results.
        if (!enabled) return NO_GROUPS
        const { actionsOnly, query: parsedQuery } = parsedQueryState
        const result: PaletteGroup[] = []

        if (actionsOnly) {
            const actionItems = searchActions(allActions, parsedQuery)
            if (actionItems.length > 0) {
                result.push({ id: 'actions', label: 'Commands', items: actionItems })
            }
            return result
        }

        // Commands lead when nothing is typed (or no folder is open) so they're easy to find,
        // and follow the file results while typing so a file name still comes first.
        const commandGroup = mode === 'all' ? buildMixedCommandGroup(allActions, parsedQuery, Boolean(workspaceRoot)) : null
        const commandsFirst = !parsedQuery || !workspaceRoot
        if (commandGroup && commandsFirst) result.push(commandGroup)

        if (!workspaceRoot) {
            const workspaceGroup = buildWorkspaceItems(recentWorkspaces, parsedQuery)
            if (workspaceGroup) result.push(workspaceGroup)
            return result
        }

        if (mode === 'all' || mode === 'files') {
            const tabItems = searchOpenTabs(tabs, workspaceRoot, parsedQuery, isExampleTabId)
            if (tabItems.length > 0) {
                result.push({ id: 'tabs', label: 'Open Editors', items: tabItems })
            }
            // Files leaves out what Open Editors and Recent Files already list.
            const shownPaths = tabItems.map((item) => item.path)

            if (!parsedQuery || parsedQuery.length < MIN_QUERY_LENGTH) {
                const openPaths = new Set(tabs.filter((t) => !isExampleTabId(t.id)).map((t) => t.path))
                const recentItems = searchRecentFiles(liveRecentFiles, workspaceRoot, parsedQuery, openPaths)
                if (recentItems.length > 0) {
                    result.push({ id: 'recent', label: 'Recent Files', items: recentItems })
                }
                shownPaths.push(...recentItems.map((item) => item.path))
            }

            const fileItems = searchFiles(filePaths, workspaceRoot, parsedQuery, shownPaths)
            if (fileItems.length > 0) {
                result.push({ id: 'files', label: 'Files', items: fileItems })
            }
        }

        if (commandGroup && !commandsFirst) result.push(commandGroup)

        if (textResolved && textItems && (mode === 'all' || mode === 'text')) {
            result.push(textItems)
        }

        return result
    }, [enabled, parsedQueryState, allActions, workspaceRoot, recentWorkspaces, tabs, liveRecentFiles, filePaths, textItems, mode, textResolved])

    useEffect(() => {
        if (!shouldSearchText) {
            abortRef.current?.abort()
            return
        }

        const parsedQuery = parsedQueryState.query
        const root = workspaceRoot ?? ''
        const controller = new AbortController()
        abortRef.current?.abort()
        abortRef.current = controller

        const timeout = window.setTimeout(() => {
            void (async () => {
                const openBuffers = new Map<string, string>()
                for (const tab of tabs) {
                    if (!isExampleTabId(tab.id)) {
                        openBuffers.set(tab.path, tab.content)
                    }
                }

                let result: SearchWorkspaceContentResult | null = null
                try {
                    result = await searchWorkspaceContent({
                        query: parsedQuery,
                        paths: filePaths,
                        openBuffers,
                        readFile: isTauri() ? readWorkspaceFile : async () => '',
                        getFileSize: isTauri() ? getWorkspaceFileSize : undefined,
                        cache: contentCache,
                        signal: controller.signal,
                    })
                } catch (err) {
                    if (!controller.signal.aborted) notifyError("Couldn't search file contents", err, { id: 'palette-text-search' })
                }

                if (controller.signal.aborted) return

                // Always resolve the query, even after a failure, so the spinner stops.
                const items = result ? result.hits.map((hit) => textHitToPaletteItem(hit, root)) : []
                setTextItems(items.length > 0 ? { id: 'text', label: 'Text', items } : null)
                setTextCapped(result?.capped ?? false)
                setTextUnreadableFiles(result?.unreadableFiles ?? 0)
                setTextTruncatedFiles(result?.truncatedFiles ?? 0)
                setLastResolvedTextQuery(parsedQuery)
            })()
        }, DEBOUNCE_MS)

        return () => {
            window.clearTimeout(timeout)
            controller.abort()
        }
    }, [shouldSearchText, parsedQueryState.query, tabs, filePaths, contentCache, workspaceRoot])

    const runItem = useCallback(
        async (item: PaletteItem) => {
            switch (item.kind) {
                case 'action':
                    await item.run()
                    break
                case 'tab':
                    await setActiveTab(item.path)
                    break
                case 'file':
                case 'recent':
                    await openFile(item.path)
                    break
                case 'workspace':
                    await openWorkspace(item.path)
                    break
                case 'text':
                    setEditorOpen(true)
                    await openFile(item.path)
                    break
            }
        },
        [setActiveTab, openFile, openWorkspace, setEditorOpen]
    )

    return {
        query,
        setQuery,
        resetSearch,
        groups,
        isSearchingText,
        textCapped: textResolved && textCapped,
        textUnreadableFiles: textResolved ? textUnreadableFiles : 0,
        textTruncatedFiles: textResolved ? textTruncatedFiles : 0,
        runItem,
        hasWorkspace: Boolean(workspaceRoot),
    }
}
