'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { getBaseName, getWorkspaceFileSize, readWorkspaceFile } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { getRecentFiles } from '@/lib/tauri/store'
import { flattenSupportedFilePaths } from '@/lib/workspace/flatten-file-tree'
import { buildCommandRegistry, createToggleLightDark } from '@/components/studio/command-palette/command-registry'
import { parsePaletteQuery } from '@/components/studio/command-palette/parse-palette-query'
import { searchActions } from '@/components/studio/command-palette/search-actions'
import { DEBOUNCE_MS, MIN_QUERY_LENGTH, searchWorkspaceContent, textHitToPaletteItem } from '@/components/studio/command-palette/search-content'
import { searchFiles, searchOpenTabs, searchRecentFiles } from '@/components/studio/command-palette/search-files'
import type { PaletteGroup, PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
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

export function usePaletteSearch(mode: PaletteMode, enabled: boolean) {
    const { isDesktop, workspaceRoot, tree, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace } = useWorkspaceSession()
    const { tabs, activeTabId, openFile, openExample, setActiveTab, closeTab, closeOtherTabs, closeAllTabs } = useDocumentTabs()
    const { autosaveEnabled, setAutosaveEnabled, flushSave, flushAllSaves } = useDocumentSave()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOnly } = useStudioLayout()
    const { requestCanvasFit } = useCanvasFit()
    const { isLight, setThemeId } = useAppTheme()
    const { settings, openSettings } = useAppSettings()

    const [query, setQuery] = useState('')
    const [recentFilesState, setRecentFilesState] = useState<{ root: string; paths: string[] } | null>(null)
    const [textItems, setTextItems] = useState<PaletteGroup | null>(null)
    const [textCapped, setTextCapped] = useState(false)
    const [lastResolvedTextQuery, setLastResolvedTextQuery] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const parsedQueryState = useMemo(() => parsePaletteQuery(query), [query])
    const shouldSearchText =
        enabled && Boolean(workspaceRoot) && !parsedQueryState.actionsOnly && mode !== 'files' && parsedQueryState.query.length >= MIN_QUERY_LENGTH
    const isSearchingText = shouldSearchText && lastResolvedTextQuery !== parsedQueryState.query

    const recentFiles = useMemo(() => (recentFilesState?.root === workspaceRoot ? recentFilesState.paths : []), [recentFilesState, workspaceRoot])

    useEffect(() => {
        if (!enabled || !workspaceRoot) return
        void getRecentFiles(workspaceRoot).then((paths) => setRecentFilesState({ root: workspaceRoot, paths }))
    }, [enabled, workspaceRoot])

    const resetSearch = useCallback(() => {
        abortRef.current?.abort()
        setQuery('')
        setLastResolvedTextQuery(null)
        setTextItems(null)
        setTextCapped(false)
    }, [])

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
                toggleLightDark: createToggleLightDark(isLight, setThemeId),
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
            setThemeId,
        ]
    )

    const filePaths = useMemo(() => (workspaceRoot ? flattenSupportedFilePaths(tree) : []), [workspaceRoot, tree])

    const groups = useMemo((): PaletteGroup[] => {
        const { actionsOnly, query: parsedQuery } = parsedQueryState
        const result: PaletteGroup[] = []

        if (actionsOnly) {
            const actionItems = searchActions(allActions, parsedQuery)
            if (actionItems.length > 0) {
                result.push({ id: 'actions', label: 'Actions', items: actionItems })
            }
            return result
        }

        if (!workspaceRoot) {
            const workspaceGroup = buildWorkspaceItems(recentWorkspaces, parsedQuery)
            if (workspaceGroup) result.push(workspaceGroup)
            return result
        }

        if (mode === 'all' || mode === 'files') {
            const tabItems = searchOpenTabs(tabs, parsedQuery, isExampleTabId)
            if (tabItems.length > 0) {
                result.push({ id: 'tabs', label: 'Open Editors', items: tabItems })
            }

            if (!parsedQuery || parsedQuery.length < MIN_QUERY_LENGTH) {
                const openPaths = new Set(tabs.filter((t) => !isExampleTabId(t.id)).map((t) => t.path))
                const recentItems = searchRecentFiles(recentFiles, workspaceRoot, parsedQuery, openPaths)
                if (recentItems.length > 0) {
                    result.push({ id: 'recent', label: 'Recent Files', items: recentItems })
                }
            }

            const fileItems = searchFiles(filePaths, workspaceRoot, parsedQuery)
            if (fileItems.length > 0) {
                result.push({ id: 'files', label: 'Files', items: fileItems })
            }
        }

        if (shouldSearchText && textItems && (mode === 'all' || mode === 'text')) {
            result.push(textItems)
        }

        return result
    }, [parsedQueryState, allActions, workspaceRoot, recentWorkspaces, tabs, recentFiles, filePaths, textItems, mode, shouldSearchText])

    useEffect(() => {
        if (!shouldSearchText) {
            abortRef.current?.abort()
            return
        }

        const parsedQuery = parsedQueryState.query
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

                const result = await searchWorkspaceContent({
                    query: parsedQuery,
                    paths: filePaths,
                    openBuffers,
                    readFile: isTauri() ? readWorkspaceFile : async () => '',
                    getFileSize: isTauri() ? getWorkspaceFileSize : undefined,
                    signal: controller.signal,
                })

                if (controller.signal.aborted) return

                const items = result.hits.map(textHitToPaletteItem)
                setTextItems(items.length > 0 ? { id: 'text', label: 'Text', items } : null)
                setTextCapped(result.capped)
                setLastResolvedTextQuery(parsedQuery)
            })()
        }, DEBOUNCE_MS)

        return () => {
            window.clearTimeout(timeout)
            controller.abort()
        }
    }, [shouldSearchText, parsedQueryState.query, tabs, filePaths])

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
        textCapped: shouldSearchText && textCapped,
        runItem,
        hasWorkspace: Boolean(workspaceRoot),
    }
}
