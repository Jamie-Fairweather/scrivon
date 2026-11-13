'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError } from '@/lib/notify'
import { getBaseName, readStamp, readWorkspaceFile } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { getRecentFiles } from '@/lib/tauri/store'
import { flattenSupportedFilePaths } from '@/lib/workspace/flatten-file-tree'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { foldText } from '@/components/studio/command-palette/fold-text'
import { parsePaletteQuery } from '@/components/studio/command-palette/parse-palette-query'
import { isThemePick, matchesCommandName, searchActions } from '@/components/studio/command-palette/search-actions'
import {
    createContentCache,
    DEBOUNCE_MS,
    meetsTextQueryMinimum,
    searchWorkspaceContent,
    textHitToPaletteItem,
    type SearchWorkspaceContentResult,
} from '@/components/studio/command-palette/search-content'
import { resolveRecentFiles, searchFiles, searchOpenTabs, searchRecentFiles } from '@/components/studio/command-palette/search-files'
import type { ActionPaletteItem, PaletteGroup, PaletteItem, PaletteMode, TextPaletteItem } from '@/components/studio/command-palette/types'
import { useCommands } from '@/components/studio/commands/command-registry'
import { useDocumentTabs, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

function buildWorkspaceItems(recentWorkspaces: string[], query: string): PaletteGroup | null {
    // Folded like the other matchers, so a name stored the macOS way (or with Turkish İ) is found as typed.
    // Each word may match anywhere, in any order ('code scrivon' finds C:\code\scrivon), but as typed rather
    // than letter by letter, which would match most folders on the letters of their full paths.
    const terms = foldText(query).split(/\s+/).filter(Boolean)
    const filtered = recentWorkspaces
        .map((path) => ({
            kind: 'workspace' as const,
            value: `workspace:${path}`,
            searchText: `${getBaseName(path)} ${path}`,
            path,
            name: getBaseName(path),
        }))
        .filter((item) => {
            const text = foldText(item.searchText)
            return terms.every((term) => text.includes(term))
        })

    if (filtered.length === 0) return null
    return { id: 'workspaces', label: 'Workspaces', items: filtered }
}

/** What a closed palette shows: nothing, so editor keystrokes don't re-rank every file. */
const NO_GROUPS: PaletteGroup[] = []

/** How many commands the default (no '>') results show next to files. */
export const MAX_MIXED_COMMANDS = 5

/**
 * The best few commands for the default results, so F1 finds commands without typing '>'.
 * Only runnable commands whose name has every typed word, so a word typed to find a file or text
 * doesn't pull in a command that would run on Enter. Commands that can't run, examples, and (with
 * no folder open) recent folders are left to the '>' list, which shows why a command can't run.
 * The themes show once something is typed, such as a theme's name.
 */
function buildMixedCommandGroup(actions: ActionPaletteItem[], query: string, hasWorkspace: boolean): PaletteGroup | null {
    const items = searchActions(actions, query)
        .filter(
            (action) =>
                !action.disabled &&
                !action.value.startsWith('action:example:') &&
                (hasWorkspace || !action.value.startsWith('action:recent-workspace:')) &&
                (query ? matchesCommandName(action, query) : !isThemePick(action))
        )
        .slice(0, MAX_MIXED_COMMANDS)
    if (items.length === 0) return null
    return { id: 'actions', label: 'Commands', items }
}

export function usePaletteSearch(mode: PaletteMode, enabled: boolean) {
    const { workspaceRoot, tree, recentWorkspaces, openWorkspace } = useWorkspaceSession()
    const { tabs, openFile, setActiveTab } = useDocumentTabs()
    const { setEditorOpen } = useStudioLayout()

    const [query, setQuery] = useState('')
    const [recentFilesState, setRecentFilesState] = useState<{ root: string; paths: string[] } | null>(null)
    const [textHits, setTextHits] = useState<TextPaletteItem[]>([])
    const [textCapped, setTextCapped] = useState(false)
    const [textUnreadableFiles, setTextUnreadableFiles] = useState(0)
    const [textTruncatedFiles, setTextTruncatedFiles] = useState(0)
    const [lastResolvedTextQuery, setLastResolvedTextQuery] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    // File text read by earlier searches in this palette session (cleared on close and folder change).
    const [contentCache] = useState(() => createContentCache())

    const parsedQueryState = useMemo(() => parsePaletteQuery(query), [query])
    const shouldSearchText =
        enabled && Boolean(workspaceRoot) && !parsedQueryState.actionsOnly && mode !== 'files' && meetsTextQueryMinimum(parsedQueryState.query, mode)
    // Text results (and their footer notes) only count for the query they were found for, so
    // hits for something the user has typed past are never opened by a quick Enter.
    const textResolved = shouldSearchText && lastResolvedTextQuery === parsedQueryState.query
    const isSearchingText = shouldSearchText && !textResolved

    // While a new search runs, the last hits stay in place (so the list doesn't jump on every key)
    // but can't be opened until the new hits replace them.
    const textGroup = useMemo((): PaletteGroup | null => {
        if (!shouldSearchText || textHits.length === 0) return null
        const items = textResolved ? textHits : textHits.map((item) => ({ ...item, disabled: true }))
        return { id: 'text', label: 'Text', items }
    }, [shouldSearchText, textResolved, textHits])

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
        setTextHits([])
        setTextCapped(false)
        setTextUnreadableFiles(0)
        setTextTruncatedFiles(0)
    }, [contentCache])

    // Every app command, from the same list the menu bar reads.
    const commands = useCommands()
    const allActions = useMemo(() => commands.map(commandToPaletteItem), [commands])

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

        const commandGroup = mode === 'all' ? buildMixedCommandGroup(allActions, parsedQuery, Boolean(workspaceRoot)) : null

        if (!workspaceRoot) {
            // Recent folders lead, so typing a folder's name and pressing Enter opens it.
            const workspaceGroup = buildWorkspaceItems(recentWorkspaces, parsedQuery)
            if (workspaceGroup) result.push(workspaceGroup)
            if (commandGroup) result.push(commandGroup)
            return result
        }

        if (mode === 'all' || mode === 'files') {
            const tabItems = searchOpenTabs(tabs, workspaceRoot, parsedQuery, isExampleTabId)
            if (tabItems.length > 0) {
                result.push({ id: 'tabs', label: 'Open Editors', items: tabItems })
            }
            // Files leaves out what Open Editors and Recent Files already list.
            const shownPaths = tabItems.map((item) => item.path)

            // Recent Files gives way once the query is long enough to search file contents.
            if (!meetsTextQueryMinimum(parsedQuery, mode)) {
                const openPaths = new Set(tabs.filter((t) => !isExampleTabId(t.id)).map((t) => t.path))
                const recentItems = searchRecentFiles(liveRecentFiles, workspaceRoot, parsedQuery, openPaths)
                if (recentItems.length > 0) {
                    result.push({ id: 'recent', label: 'Recent Files', items: recentItems })
                }
                shownPaths.push(...recentItems.map((item) => item.path))
            }

            // With nothing typed, commands follow the open and recent files: easy to find, while
            // Enter still goes back to the file the user was in.
            if (commandGroup && !parsedQuery) result.push(commandGroup)

            const fileItems = searchFiles(filePaths, workspaceRoot, parsedQuery, shownPaths)
            if (fileItems.length > 0) {
                result.push({ id: 'files', label: 'Files', items: fileItems })
            }
        }

        if (textGroup) result.push(textGroup)

        // While typing, commands come last, so a matching file name or text hit is what Enter opens.
        if (commandGroup && parsedQuery) result.push(commandGroup)

        return result
    }, [enabled, parsedQueryState, allActions, workspaceRoot, recentWorkspaces, tabs, liveRecentFiles, filePaths, textGroup, mode])

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
                        getFileStamp: isTauri() ? readStamp : undefined,
                        cache: contentCache,
                        signal: controller.signal,
                    })
                } catch (err) {
                    if (!controller.signal.aborted) notifyError("Couldn't search file contents", err, { id: 'palette-text-search' })
                }

                if (controller.signal.aborted) return

                // Always resolve the query, even after a failure, so the spinner stops.
                setTextHits(result ? result.hits.map((hit) => textHitToPaletteItem(hit, root)) : [])
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
