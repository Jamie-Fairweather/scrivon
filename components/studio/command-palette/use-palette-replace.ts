'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { recordFileVersion } from '@/lib/tauri/file-history'
import { getBaseName, readStamp, readWorkspaceTextFile, writeWorkspaceFile } from '@/lib/tauri/fs'
import type { TextEdit } from '@/lib/workspace/text-edits'
import {
    applyWorkspaceReplace,
    computeReplacements,
    describeOutcome,
    describeSkip,
    findOpenTab,
    planWorkspaceReplace,
    tabSkipReason,
    type ReplaceNotice,
    type ReplacePlan,
    type ReplaceSkipReason,
    type ReplaceTab,
} from '@/components/studio/command-palette/replace-content'
import { replacementEdits } from '@/components/studio/command-palette/replace-text'
import type { TextMatcher } from '@/components/studio/command-palette/text-matcher'
import type { TextPaletteItem } from '@/components/studio/command-palette/types'

import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

/** Where Replace All is: counting the matches, asking, replacing, or stopped by a pattern that took too long. */
export type ReplaceAllState =
    | { phase: 'idle' }
    | { phase: 'counting'; done: number; total: number }
    /** The count, and the query and replacement it was made with, which are what Replace All then uses. */
    | { phase: 'confirm'; plan: ReplacePlan; matcher: TextMatcher; replacement: string }
    | { phase: 'running'; done: number; total: number; stopping: boolean }
    | { phase: 'stopped'; message: string }

const IDLE: ReplaceAllState = { phase: 'idle' }

/** How long to wait for the editor to take a tab that was just opened, before its text is changed some other way. */
const EDITOR_WAIT_FRAMES = 30

/** The notice when one file was left alone. */
function skipped(path: string, reason: ReplaceSkipReason): ReplaceNotice {
    return { message: `Nothing was replaced in ${getBaseName(path)}: ${describeSkip({ reason })}.`, details: [] }
}

function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
        else setTimeout(resolve, 16)
    })
}

export type UsePaletteReplaceOptions = {
    /** Whether the Replace box shows. Nothing is replaced while it doesn't. */
    active: boolean
    /** The query the listed results were found for, or null while they are out of date (or there are none). */
    matcher: TextMatcher | null
    replacement: string
    /** The workspace's files, in the order the results list them. */
    filePaths: readonly string[]
    /** Searches again, so the results never show a match that was already replaced. */
    refresh: () => void
    /** Stands for the query and its options: a change of either clears the last notice. */
    queryKey: string
    /** The open tabs, the editor and the open path: getTabs, openFile, applyTabEdits and fileSaved. */
    coordinator: Pick<WorkspaceCoordinatorRefs, 'getTabs' | 'openFile' | 'applyTabEdits' | 'fileSaved'>
    /** Shows the editor, so a file opened to be changed gets a buffer whose undo takes the change back. */
    showEditor: () => void
    /** Whether Local History is on: a file written by Replace All then keeps its old text there first. */
    keepHistory: boolean
}

/**
 * Replace in Workspace's actions: replace one match, every match in one file, or Replace All. Replace one and
 * Replace in File never write to disk: a file that isn't open is opened in a tab and changed there, as an
 * unsaved edit Ctrl+Z takes back. Replace All counts afresh, asks, then writes files that aren't open (the
 * rest change in their tabs), with progress and a way to stop. After each, the results are searched again.
 */
export function usePaletteReplace({
    active,
    matcher,
    replacement,
    filePaths,
    refresh,
    queryKey,
    coordinator,
    showEditor,
    keepHistory,
}: UsePaletteReplaceOptions) {
    const [busy, setBusy] = useState(false)
    const busyRef = useRef(false)
    const [notice, setNotice] = useState<ReplaceNotice | null>(null)
    const [replaceAll, setReplaceAll] = useState<ReplaceAllState>(IDLE)
    const abortRef = useRef<AbortController | null>(null)

    // A notice is about the last replace: a new query, options or replacement makes it old news.
    const noticeKey = JSON.stringify([queryKey, replacement, active])
    const [noticeFor, setNoticeFor] = useState(noticeKey)
    if (noticeFor !== noticeKey) {
        setNoticeFor(noticeKey)
        setNotice(null)
    }

    // Closing the box (or the palette) stops a Replace All that is counting or waiting to be confirmed.
    useEffect(() => {
        if (!active) abortRef.current?.abort()
    }, [active])
    if (!active && (replaceAll.phase === 'counting' || replaceAll.phase === 'confirm' || replaceAll.phase === 'stopped')) setReplaceAll(IDLE)

    const getTabs = useCallback((): readonly ReplaceTab[] => coordinator.getTabs.current(), [coordinator])

    /**
     * Changes an open tab as one undo step. A tab opened a moment ago may not have reached the editor yet, which
     * then turns the edit down: it is tried again on the next frames.
     */
    const editTab = useCallback(
        async (tabId: string, edits: readonly TextEdit[]): Promise<boolean> => {
            for (let frame = 0; ; frame++) {
                if (coordinator.applyTabEdits.current(tabId, edits)) return true
                const tab = getTabs().find((t) => t.id === tabId)
                if (!tab || tab.readOnly || frame >= EDITOR_WAIT_FRAMES) return false
                await nextFrame()
            }
        },
        [coordinator, getTabs]
    )

    /** The open tab for `path`, opening the file first if it isn't (through the normal open path), or why it can't change. */
    const tabFor = useCallback(
        async (path: string): Promise<ReplaceTab | ReplaceSkipReason> => {
            let tab = findOpenTab(getTabs(), path)
            if (!tab) {
                // Shown in the editor, so the change is an undo step there.
                showEditor()
                await coordinator.openFile.current(path)
                tab = findOpenTab(getTabs(), path)
                if (!tab) return 'not-opened'
                // Lets the editor make the tab's buffer before it is edited, so Ctrl+Z can take the change back.
                await nextFrame()
                await nextFrame()
                tab = findOpenTab(getTabs(), path) ?? tab
            }
            return tabSkipReason(tab, isExampleTabId) ?? tab
        },
        [coordinator, getTabs, showEditor]
    )

    const run = useCallback(
        async (task: () => Promise<ReplaceNotice>) => {
            if (busyRef.current) return
            busyRef.current = true
            setBusy(true)
            try {
                setNotice(await task())
            } catch (err) {
                setNotice({ message: "Couldn't replace.", details: [err instanceof Error ? err.message : String(err)] })
            } finally {
                busyRef.current = false
                setBusy(false)
                refresh()
            }
        },
        [refresh]
    )

    /** Replaces in the file's tab: only the match at `at` when given, otherwise every match in the file. */
    const replaceInTab = useCallback(
        async (path: string, at: { line: number; column: number; length: number } | null): Promise<ReplaceNotice> => {
            if (!matcher) return { message: 'The results are out of date. Try again once they are searched.', details: [] }
            const tab = await tabFor(path)
            if (typeof tab === 'string') return skipped(path, tab)
            const computed = await computeReplacements(tab.content, { matcher, replacement })
            if (!computed.ok) return skipped(path, computed.reason === 'aborted' ? 'changed' : computed.reason)
            const chosen = at
                ? computed.replacements.filter((r) => r.lineIndex === at.line - 1 && r.start === at.column - 1 && r.length === at.length)
                : computed.replacements
            if (chosen.length === 0) {
                const message = at
                    ? `That match in ${getBaseName(path)} has changed since it was found.`
                    : `No matches to replace in ${getBaseName(path)}.`
                return { message, details: [] }
            }
            // The tab's text may have moved on while a regex was worked out in the worker.
            const now = findOpenTab(getTabs(), path)
            if (!now || now.id !== tab.id || now.content !== tab.content) return skipped(path, 'changed')
            if (!(await editTab(tab.id, replacementEdits(tab.content, chosen)))) return skipped(path, 'read-only')
            // The true number replaced, however many the results listed, and any long lines a regex left alone.
            return describeOutcome({
                replaced: [{ path, count: chosen.length, route: 'buffer' }],
                replacedMatches: chosen.length,
                skipped: [],
                longLinesSkipped: at ? 0 : computed.longLinesSkipped,
                cancelled: false,
            })
        },
        [matcher, replacement, tabFor, getTabs, editTab]
    )

    const replaceMatch = useCallback(
        (item: TextPaletteItem) => {
            if (!active || item.disabled) return Promise.resolve()
            return run(() => replaceInTab(item.path, item))
        },
        [active, run, replaceInTab]
    )

    const replaceFile = useCallback(
        (path: string) => {
            if (!active) return Promise.resolve()
            return run(() => replaceInTab(path, null))
        },
        [active, run, replaceInTab]
    )

    /** Counts every match afresh, with no cap, then asks before anything is replaced. */
    const startReplaceAll = useCallback(async () => {
        if (!active || !matcher || busyRef.current || replaceAll.phase !== 'idle') return
        const controller = new AbortController()
        abortRef.current = controller
        setNotice(null)
        setReplaceAll({ phase: 'counting', done: 0, total: 0 })
        const result = await planWorkspaceReplace({
            matcher,
            replacement,
            paths: filePaths,
            tabs: getTabs(),
            isExample: isExampleTabId,
            readTextFile: readWorkspaceTextFile,
            getFileStamp: readStamp,
            signal: controller.signal,
            onProgress: (done, total) => {
                if (!controller.signal.aborted) setReplaceAll({ phase: 'counting', done, total })
            },
        }).catch((err: unknown) => ({ type: 'failed' as const, err }))
        if (controller.signal.aborted) return
        if (result.type === 'failed') {
            setReplaceAll(IDLE)
            setNotice({ message: "Couldn't count the matches.", details: [result.err instanceof Error ? result.err.message : String(result.err)] })
            return
        }
        if (result.type === 'aborted') return setReplaceAll(IDLE)
        if (result.type === 'stopped') {
            const message =
                result.reason === 'timed-out'
                    ? `The regular expression took too long on ${getBaseName(result.path)}, so nothing was replaced. Try a simpler pattern.`
                    : "Regular expressions aren't available, so nothing was replaced."
            return setReplaceAll({ phase: 'stopped', message })
        }
        if (result.plan.files.length === 0) {
            setReplaceAll(IDLE)
            setNotice(
                describeOutcome({
                    replaced: [],
                    replacedMatches: 0,
                    skipped: result.plan.skipped,
                    longLinesSkipped: result.plan.longLinesSkipped,
                    cancelled: false,
                })
            )
            return
        }
        setReplaceAll({ phase: 'confirm', plan: result.plan, matcher, replacement })
    }, [active, matcher, replacement, filePaths, getTabs, replaceAll.phase])

    /** Replaces what was counted. Files that aren't open are saved straight away; open tabs change in their buffers. */
    const confirmReplaceAll = useCallback(async () => {
        if (replaceAll.phase !== 'confirm' || busyRef.current) return
        const { plan, matcher, replacement } = replaceAll
        const controller = new AbortController()
        abortRef.current = controller
        busyRef.current = true
        setBusy(true)
        const total = plan.files.length
        setReplaceAll({ phase: 'running', done: 0, total, stopping: false })
        try {
            const outcome = await applyWorkspaceReplace({
                plan,
                matcher,
                replacement,
                getTabs,
                isExample: isExampleTabId,
                applyTabEdits: editTab,
                readTextFile: readWorkspaceTextFile,
                writeTextFile: writeWorkspaceFile,
                // The old text is kept in Local History, when it is on, so a file written here can still be got back.
                keepVersion: keepHistory ? (path, text) => recordFileVersion(path, text, 'before-first-write') : undefined,
                onWritten: (path) => coordinator.fileSaved.current(path),
                signal: controller.signal,
                onProgress: (done) => setReplaceAll((state) => (state.phase === 'running' ? { ...state, done } : state)),
            })
            setNotice(describeOutcome(outcome, total))
        } catch (err) {
            setNotice({ message: "Couldn't finish Replace All.", details: [err instanceof Error ? err.message : String(err)] })
        } finally {
            busyRef.current = false
            setBusy(false)
            setReplaceAll(IDLE)
            refresh()
        }
    }, [replaceAll, getTabs, editTab, keepHistory, coordinator, refresh])

    /** Stops counting, or says no to the question, or stops replacing before the next file. */
    const cancelReplaceAll = useCallback(() => {
        abortRef.current?.abort()
        setReplaceAll((state) => (state.phase === 'running' ? { ...state, stopping: true } : IDLE))
    }, [])

    const dismissNotice = useCallback(() => setNotice(null), [])

    return {
        busy,
        notice,
        dismissNotice,
        replaceMatch,
        replaceFile,
        replaceAll,
        startReplaceAll,
        confirmReplaceAll,
        cancelReplaceAll,
    }
}
