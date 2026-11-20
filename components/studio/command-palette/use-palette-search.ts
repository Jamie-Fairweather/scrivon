'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { notifyError } from '@/lib/notify'
import { getBaseName, readStamp, readWorkspaceFile } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { getRecentFiles } from '@/lib/tauri/store'
import type { OutlineHeading } from '@/lib/markdown/document-outline'
import { documentKind } from '@/lib/workspace/file-types'
import { flattenSupportedFilePaths } from '@/lib/workspace/flatten-file-tree'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { foldText } from '@/components/studio/command-palette/fold-text'
import { goToLineHint, goToLineItem, headingItems, helpItems, type PaletteFile } from '@/components/studio/command-palette/palette-prefixes'
import { parsePaletteQuery, type PaletteQueryKind } from '@/components/studio/command-palette/parse-palette-query'
import { isThemePick, matchesCommandName, searchActions } from '@/components/studio/command-palette/search-actions'
import {
    createContentCache,
    DEBOUNCE_MS,
    meetsTextQueryMinimum,
    searchWorkspaceContent,
    textHitToPaletteItem,
    type SearchStop,
    type SearchWorkspaceContentResult,
} from '@/components/studio/command-palette/search-content'
import { compileTextQuery, PLAIN_SEARCH_OPTIONS, type WorkspaceSearchOptions } from '@/components/studio/command-palette/text-matcher'
import { resolveRecentFiles, searchFiles, searchOpenTabs, searchRecentFiles } from '@/components/studio/command-palette/search-files'
import type { ActionPaletteItem, PaletteGroup, PaletteItem, PaletteMode, TextPaletteItem } from '@/components/studio/command-palette/types'
import { useCommands } from '@/components/studio/commands/command-registry'
import { jumpToHeading } from '@/components/studio/outline/jump-to-heading'
import { useMarkdownOutline } from '@/components/studio/outline/use-markdown-outline'
import { useDocumentTabs, useStudioLayout, useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

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

/** The results of ':', '@' and '?', which work on the open file rather than the folder. */
function buildPrefixGroups(
    kind: Exclude<PaletteQueryKind, 'search' | 'commands'>,
    query: string,
    file: PaletteFile | null,
    headings: OutlineHeading[] | null
): PaletteGroup[] {
    if (kind === 'line') {
        const item = file ? goToLineItem(file, query) : null
        return item ? [{ id: 'line', label: 'Go to Line', items: [item] }] : NO_GROUPS
    }
    if (kind === 'heading') {
        const items = file && headings ? headingItems(headings, file.path, query) : []
        return items.length > 0 ? [{ id: 'headings', label: 'Headings', items }] : NO_GROUPS
    }
    const items = helpItems(query)
    return items.length > 0 ? [{ id: 'help', label: 'Prefixes', items }] : NO_GROUPS
}

/** What ':', '@' and '?' say when they list nothing. Null for a search or commands, whose messages the dialog has. */
function prefixHint(kind: PaletteQueryKind, file: PaletteFile | null, isMarkdown: boolean, headings: OutlineHeading[] | null): string | null {
    switch (kind) {
        case 'line':
            return goToLineHint(file)
        case 'heading':
            if (!file) return 'Open a Markdown file to jump to its headings.'
            if (!isMarkdown) return 'Only Markdown files have headings.'
            if (headings === null) return 'Reading headings…'
            if (headings.length === 0) return 'No headings yet. Start a line with # to add one.'
            return 'No matching headings.'
        case 'help':
            return 'No matching prefixes.'
        default:
            return null
    }
}

/** What the footer and the status say when a regex search stopped early. */
function stopMessage(stop: SearchStop): string {
    if (stop.reason === 'unavailable') return "Regular expression search isn't available."
    return `Search stopped: the regular expression took too long on ${getBaseName(stop.path)}. Try a simpler pattern.`
}

/**
 * The palette's results for `query` in `mode`. `searchOptions` are Find in Workspace's saved options
 * (Match Case, Match Whole Word, Use Regular Expression). They only apply to a Text-mode search, not to the
 * default list or a '>' commands query, where the search is the plain one.
 */
export function usePaletteSearch(mode: PaletteMode, enabled: boolean, searchOptions: WorkspaceSearchOptions = PLAIN_SEARCH_OPTIONS) {
    const { workspaceRoot, tree, recentWorkspaces, openWorkspace } = useWorkspaceSession()
    const { tabs, activeTab, openFile, setActiveTab } = useDocumentTabs()
    const { layout, setEditorOpen } = useStudioLayout()
    const editorOpen = layout.editorOpen
    const coordinator = useWorkspaceCoordinator()

    const [query, setQuery] = useState('')
    const [recentFilesState, setRecentFilesState] = useState<{ root: string; paths: string[] } | null>(null)
    const [textHits, setTextHits] = useState<TextPaletteItem[]>([])
    const [textCapped, setTextCapped] = useState(false)
    const [textUnreadableFiles, setTextUnreadableFiles] = useState(0)
    const [textTruncatedFiles, setTextTruncatedFiles] = useState(0)
    const [textLongLinesSkipped, setTextLongLinesSkipped] = useState(0)
    const [textStop, setTextStop] = useState<SearchStop | null>(null)
    const [lastResolvedSearchKey, setLastResolvedSearchKey] = useState<string | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    // What the search effect last ran for, so a change of options (or mode) with the same typed query skips the typing pause.
    // `typed` is the query with its spaces trimmed, as typed: turning Use Regular Expression on or off keeps or trims the
    // spaces of the pattern, but nothing new was typed. An invalid pattern is recorded too, though it starts no search.
    const lastStartedRef = useRef<{ query: string; typed: string; mode: PaletteMode; optionsKey: string; immediate: boolean } | null>(null)
    // File text read by earlier searches in this palette session (cleared on close and folder change).
    const [contentCache] = useState(() => createContentCache())

    // The options apply to a Find in Workspace search only; everywhere else the search is the plain one.
    const searchOptionsApply = mode === 'text' && parsePaletteQuery(query, mode).kind === 'search'
    const { matchCase, wholeWord, useRegex } = searchOptionsApply ? searchOptions : PLAIN_SEARCH_OPTIONS
    const effectiveOptions = useMemo((): WorkspaceSearchOptions => ({ matchCase, wholeWord, useRegex }), [matchCase, wholeWord, useRegex])
    const optionsKey = `${Number(matchCase)}${Number(wholeWord)}${Number(useRegex)}`

    // A regular expression keeps its spaces (' +$').
    const parsedQueryState = useMemo(() => parsePaletteQuery(query, mode, { keepSpaces: useRegex }), [query, mode, useRegex])
    const wantsTextSearch =
        enabled &&
        Boolean(workspaceRoot) &&
        parsedQueryState.kind === 'search' &&
        mode !== 'files' &&
        meetsTextQueryMinimum(parsedQueryState.query, mode)
    // Compiled before any search starts: an invalid pattern starts none.
    const compiledQuery = useMemo(
        () => (wantsTextSearch ? compileTextQuery(parsedQueryState.query, effectiveOptions) : null),
        [wantsTextSearch, parsedQueryState.query, effectiveOptions]
    )
    const queryError = compiledQuery && !compiledQuery.ok ? compiledQuery.error : null
    const textMatcher = compiledQuery?.ok ? compiledQuery.matcher : null
    const shouldSearchText = textMatcher !== null
    // Text results (and their footer notes) only count for the query, mode and options they were found
    // for, so hits for something the user has typed past are never opened by a quick Enter.
    const searchKey = shouldSearchText ? JSON.stringify([mode, parsedQueryState.query, optionsKey]) : null
    const textResolved = searchKey !== null && lastResolvedSearchKey === searchKey
    const isSearchingText = shouldSearchText && !textResolved

    // An invalid pattern leaves no hits behind, not even greyed out until the next search finishes. Its last
    // results are forgotten too, so going back to that search (Backspace, or an option switched back) shows it
    // running again rather than a finished, empty result with the old footer notes.
    if (queryError && (textHits.length > 0 || lastResolvedSearchKey !== null)) {
        setTextHits([])
        setLastResolvedSearchKey(null)
    }

    // '@' reads the open Markdown file's headings, as the Outline panel does, only while it is typed.
    const isMarkdown = activeTab !== null && documentKind(activeTab.name) === 'markdown'
    const wantsHeadings = enabled && parsedQueryState.kind === 'heading' && isMarkdown
    const headings = useMarkdownOutline(wantsHeadings ? activeTab.id : null, wantsHeadings ? activeTab.content : null)

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
        lastStartedRef.current = null
        setQuery('')
        setLastResolvedSearchKey(null)
        setTextHits([])
        setTextCapped(false)
        setTextUnreadableFiles(0)
        setTextTruncatedFiles(0)
        setTextLongLinesSkipped(0)
        setTextStop(null)
    }, [contentCache])

    // Every app command, from the same list the menu bar reads.
    const commands = useCommands()
    const allActions = useMemo(() => commands.map(commandToPaletteItem), [commands])

    const filePaths = useMemo(() => (workspaceRoot ? flattenSupportedFilePaths(tree) : []), [workspaceRoot, tree])
    const liveRecentFiles = useMemo(() => resolveRecentFiles(recentFiles, filePaths), [recentFiles, filePaths])

    const groups = useMemo((): PaletteGroup[] => {
        // `enabled` stays true until the close animation ends, so the fading list keeps its results.
        if (!enabled) return NO_GROUPS
        const { kind, query: parsedQuery } = parsedQueryState
        const result: PaletteGroup[] = []

        if (kind === 'commands') {
            const actionItems = searchActions(allActions, parsedQuery)
            if (actionItems.length > 0) {
                result.push({ id: 'actions', label: 'Commands', items: actionItems })
            }
            return result
        }

        if (kind !== 'search') return buildPrefixGroups(kind, parsedQuery, activeTab, headings)

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
    }, [
        enabled,
        parsedQueryState,
        allActions,
        workspaceRoot,
        recentWorkspaces,
        tabs,
        activeTab,
        headings,
        liveRecentFiles,
        filePaths,
        textGroup,
        mode,
    ])

    // Only worked out when the list is empty: ':' counts the open file's lines for it.
    const emptyHint = groups.length === 0 ? prefixHint(parsedQueryState.kind, activeTab, isMarkdown, headings) : null

    // The query as typed, without the spaces a regular expression keeps: what the search effect compares.
    const typedQuery = parsePaletteQuery(query, mode).query

    useEffect(() => {
        const parsedQuery = parsedQueryState.query
        if (!textMatcher || searchKey === null) {
            abortRef.current?.abort()
            // Remembered, so an option switched over an invalid pattern searches at once.
            if (enabled) lastStartedRef.current = { query: parsedQuery, typed: typedQuery, mode, optionsKey, immediate: false }
            return
        }

        const root = workspaceRoot ?? ''
        const controller = new AbortController()
        abortRef.current?.abort()
        abortRef.current = controller

        // Typing waits for a pause. Switching an option or the mode for the same typed query searches at once.
        // The same search started again (an edit to an open file, or Strict Mode running effects twice) keeps its own timing.
        const previous = lastStartedRef.current
        const sameSearch = previous !== null && previous.query === parsedQuery && previous.optionsKey === optionsKey && previous.mode === mode
        const switched = previous !== null && previous.typed === typedQuery && (previous.optionsKey !== optionsKey || previous.mode !== mode)
        const immediate = sameSearch ? previous.immediate : switched
        lastStartedRef.current = { query: parsedQuery, typed: typedQuery, mode, optionsKey, immediate }

        const timeout = window.setTimeout(
            () => {
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
                            matcher: textMatcher,
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
                    setTextLongLinesSkipped(result?.longLinesSkipped ?? 0)
                    setTextStop(result?.stopped ?? null)
                    setLastResolvedSearchKey(searchKey)
                })()
            },
            immediate ? 0 : DEBOUNCE_MS
        )

        return () => {
            window.clearTimeout(timeout)
            controller.abort()
        }
        // searchKey stands for the query, the mode and the options together, so any of them runs the search again.
    }, [searchKey, textMatcher, parsedQueryState.query, typedQuery, mode, optionsKey, enabled, tabs, filePaths, contentCache, workspaceRoot])

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
                // Text hits and lines show the editor and move it, which also puts the keyboard there.
                case 'text':
                    setEditorOpen(true)
                    await openFile(item.path)
                    coordinator.revealInEditor.current(item.path, item.line, item.column, item.length)
                    break
                case 'line':
                    setEditorOpen(true)
                    coordinator.revealInEditor.current(item.path, item.line, item.column)
                    break
                case 'heading':
                    jumpToHeading(coordinator, item.path, { id: item.headingId, line: item.line }, editorOpen)
                    break
            }
        },
        [setActiveTab, openFile, openWorkspace, setEditorOpen, coordinator, editorOpen]
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
        /** Lines a regex search skipped for being too long. */
        textLongLinesSkipped: textResolved ? textLongLinesSkipped : 0,
        /** Why the last regex search stopped early, when it did. Its hits stay listed. */
        textStopMessage: textResolved && textStop ? stopMessage(textStop) : null,
        /** Why the query can't be searched (an invalid regular expression), or null. */
        queryError,
        /** Whether Find in Workspace's options apply now (Text mode, searching): the dialog shows them only then. */
        searchOptionsApply,
        runItem,
        hasWorkspace: Boolean(workspaceRoot),
        /** What to show instead of results when ':', '@' or '?' lists nothing. */
        emptyHint,
    }
}
