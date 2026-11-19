'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { FileHistoryDiff } from '@/components/studio/dialogs/file-history-diff'
import { focusEditorNow } from '@/components/studio/editor/editor-focus'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentTabActions, useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { errorMessage, notifyError } from '@/lib/notify'
import {
    isTooLargeForHistory,
    listFileVersions,
    readFileVersion,
    recordFileVersion,
    type FileVersion,
    type FileVersionKind,
} from '@/lib/tauri/file-history'
import { isTauri } from '@/lib/tauri/platform'
import { formatFileSize } from '@/lib/workspace/document-tab'
import { wholeTextRange } from '@/lib/workspace/text-edits'
import type { DocumentTab } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

type FileHistoryContextValue = {
    /** Opens File History for an open tab, making it the active tab first. */
    showFileHistory: (tabId: string) => Promise<void>
}

const FileHistoryContext = createContext<FileHistoryContextValue | null>(null)

export function useFileHistory(): FileHistoryContextValue {
    const ctx = useContext(FileHistoryContext)
    if (!ctx) throw new Error('useFileHistory must be used within FileHistoryProvider')
    return ctx
}

const KIND_LABELS: Record<FileVersionKind, string> = {
    manual: 'Saved',
    autosave: 'Autosaved',
    'before-first-write': 'On disk before your edits',
    'before-overwrite': 'Saved by another program',
    'before-restore': 'Before a restore',
}

/** When a version was saved, the way people read it ("19 Nov 2026, 14:32"). */
export function formatVersionTime(ms: number): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

/** What a row of the list says, and what a screen reader reads for it. */
export function describeVersion(version: FileVersion): { time: string; details: string } {
    return { time: formatVersionTime(version.savedMs), details: `${formatFileSize(version.size)} · ${KIND_LABELS[version.kind] ?? 'Saved'}` }
}

/** Why the list is empty, for a file with no versions to show. */
function emptyReason(tab: DocumentTab, historyEnabled: boolean): string {
    if (!isTauri()) return 'File history is kept only in the desktop app.'
    if (tab.largeFile || isTooLargeForHistory(tab.content)) return "Scrivon doesn't keep versions of files over 5 MB, and this one is bigger."
    if (!historyEnabled) return 'File history is off, so no versions are kept. You can turn it on in Settings → General.'
    return 'No versions yet. Scrivon keeps one each time you save this file.'
}

type Listing = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; versions: FileVersion[] }

type FileHistoryBodyProps = {
    tab: DocumentTab
    /** Called after a version was put into the editor, with what to announce. */
    onRestored: (announcement: string) => void
}

/** The list of versions, the comparison and Restore. Drawn only while the dialog is open. */
function FileHistoryBody({ tab, onRestored }: FileHistoryBodyProps) {
    const coordinator = useWorkspaceCoordinator()
    const { settings } = useAppSettings()
    const [listing, setListing] = useState<Listing>({ state: 'loading' })
    const [selected, setSelected] = useState(0)
    const [texts, setTexts] = useState<ReadonlyMap<string, string | { failed: string }>>(new Map())
    const [restoring, setRestoring] = useState(false)
    const listRef = useRef<HTMLDivElement>(null)
    // Read at the moment Restore runs, so the text kept first is the editor's text then.
    const tabRef = useRef(tab)
    useEffect(() => {
        tabRef.current = tab
    }, [tab])

    const path = tab.path
    useEffect(() => {
        let cancelled = false
        listFileVersions(path)
            .then((versions) => {
                if (!cancelled) setListing({ state: 'ready', versions })
            })
            .catch((err: unknown) => {
                if (!cancelled) setListing({ state: 'failed', message: errorMessage(err, "Couldn't read the file history.") })
            })
        return () => {
            cancelled = true
        }
    }, [path])

    const versions = listing.state === 'ready' ? listing.versions : []
    const version = versions[selected]
    const versionText = version ? texts.get(version.id) : undefined

    useEffect(() => {
        if (!version || texts.has(version.id)) return
        let cancelled = false
        readFileVersion(path, version.id)
            .then((text) => {
                if (!cancelled) setTexts((prev) => new Map(prev).set(version.id, text))
            })
            .catch((err: unknown) => {
                if (!cancelled) setTexts((prev) => new Map(prev).set(version.id, { failed: errorMessage(err, "Couldn't read this version.") }))
            })
        return () => {
            cancelled = true
        }
    }, [path, version, texts])

    // The list takes the keyboard once it has versions, so the arrow keys work straight away.
    const hasVersions = versions.length > 0
    useEffect(() => {
        if (hasVersions) listRef.current?.focus()
    }, [hasVersions])

    const optionId = (index: number) => `file-history-version-${index}`
    useEffect(() => {
        document.getElementById(optionId(selected))?.scrollIntoView?.({ block: 'nearest' })
    }, [selected])

    const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const last = versions.length - 1
        const next =
            event.key === 'ArrowDown'
                ? Math.min(last, selected + 1)
                : event.key === 'ArrowUp'
                  ? Math.max(0, selected - 1)
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? last
                      : null
        if (next === null || last < 0) return
        event.preventDefault()
        setSelected(next)
    }

    const loadedText = typeof versionText === 'string' ? versionText : null
    const sameAsEditor = loadedText !== null && loadedText === tab.content
    const restoreOffReason = tab.readOnly
        ? 'This file is read-only, so a version can’t be put back into it.'
        : sameAsEditor
          ? 'This version is the same as the text in the editor.'
          : null
    const canRestore = version !== undefined && loadedText !== null && restoreOffReason === null && !restoring

    const restore = async () => {
        if (!version || loadedText === null) return
        setRestoring(true)
        const time = formatVersionTime(version.savedMs)
        // Autosave waits, so nothing is written while the text is swapped. A save already running finishes first.
        const release = await coordinator.holdSaves.current(tab.path, false)
        let restored = false
        try {
            const now = tabRef.current
            if (now.readOnly) return
            // The text in the editor is kept first, so putting a version back never loses anything.
            if (settings.fileHistory.enabled) await recordFileVersion(now.path, now.content, 'before-restore')
            // One edit over the whole text: one undo step, which Ctrl+Z takes back. The tab shows as unsaved.
            restored = coordinator.applyTabEdits.current(now.id, [{ range: wholeTextRange(now.content), text: loadedText }])
            if (!restored) notifyError(`Couldn't restore ${tab.name}`, undefined, { description: 'The file was closed, or can only be read now.' })
        } catch (err) {
            notifyError(`Couldn't restore ${tab.name}`, err, {
                description: `${errorMessage(err, 'Something went wrong.')} The text in the editor was left as it is.`,
            })
        } finally {
            release((held) => (held === tabRef.current.id ? held : null))
            setRestoring(false)
        }
        if (restored) onRestored(`Restored the version from ${time}`)
    }

    const listMessage =
        listing.state === 'loading'
            ? 'Loading versions…'
            : listing.state === 'failed'
              ? listing.message
              : versions.length === 0
                ? emptyReason(tab, settings.fileHistory.enabled)
                : null

    return (
        <>
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 pb-4 sm:flex-row">
                <div className="flex min-h-0 shrink-0 flex-col sm:w-64">
                    <p id="file-history-list-label" className="mb-2 text-sm font-medium">
                        Saved versions
                    </p>
                    {listMessage !== null ? (
                        <p className="text-sm text-muted-foreground" role="status">
                            {listMessage}
                        </p>
                    ) : (
                        <div
                            ref={listRef}
                            role="listbox"
                            tabIndex={0}
                            aria-labelledby="file-history-list-label"
                            aria-activedescendant={optionId(selected)}
                            onKeyDown={onListKeyDown}
                            className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border p-1 outline-none focus-visible:ring-2
                                focus-visible:ring-ring"
                        >
                            {versions.map((item, index) => {
                                const { time, details } = describeVersion(item)
                                return (
                                    <div
                                        key={item.id}
                                        id={optionId(index)}
                                        role="option"
                                        aria-selected={index === selected}
                                        onClick={() => setSelected(index)}
                                        className={cn(
                                            'cursor-default rounded-sm px-2 py-1.5 text-sm',
                                            index === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                                        )}
                                    >
                                        <span className="block">{time}</span>
                                        <span
                                            className={cn('block text-xs', index === selected ? 'text-accent-foreground' : 'text-muted-foreground')}
                                        >
                                            {details}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
                <div className="flex min-h-64 min-w-0 flex-1 flex-col">
                    {version ? (
                        <>
                            <div className="mb-2 flex justify-between gap-4 text-sm font-medium" aria-hidden>
                                <span>Version from {formatVersionTime(version.savedMs)}</span>
                                <span>In the editor now</span>
                            </div>
                            <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border" data-slot="file-history-diff">
                                {loadedText !== null ? (
                                    <FileHistoryDiff
                                        fileName={tab.name}
                                        original={loadedText}
                                        modified={tab.content}
                                        originalLabel={`Version from ${formatVersionTime(version.savedMs)}, read-only`}
                                        modifiedLabel="Text in the editor now, read-only"
                                    />
                                ) : (
                                    <p className="p-4 text-sm text-muted-foreground" role="status">
                                        {typeof versionText === 'object' ? versionText.failed : 'Loading this version…'}
                                    </p>
                                )}
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                                In the comparison, F7 and Shift+F7 go through the changes one by one.
                            </p>
                        </>
                    ) : null}
                </div>
            </div>
            <DialogFooter>
                {version && restoreOffReason ? (
                    <p className="me-auto self-center text-sm text-muted-foreground" id="file-history-restore-off">
                        {restoreOffReason}
                    </p>
                ) : null}
                <DialogClose render={<Button type="button" variant="outline" />}>Close</DialogClose>
                <Button
                    type="button"
                    disabled={!canRestore}
                    loading={restoring}
                    aria-describedby={version && restoreOffReason ? 'file-history-restore-off' : undefined}
                    onClick={() => void restore()}
                >
                    Restore
                </Button>
            </DialogFooter>
        </>
    )
}

/**
 * File → Show File History…: the versions of the open file kept in the app's data folder
 * (lib/tauri/file-history.ts), a comparison of the chosen one with the editor's text, and Restore, which puts it
 * into the editor as an unsaved edit that Ctrl+Z takes back.
 */
export function FileHistoryProvider({ children }: { children: ReactNode }) {
    const { setActiveTab } = useDocumentTabActions()
    const [tabId, setTabId] = useState<string | null>(null)
    const [open, setOpen] = useState(false)
    // Each opening starts afresh, so a list from an earlier one is never shown for a moment.
    const [opening, setOpening] = useState(0)
    const [announcement, setAnnouncement] = useState('')

    const showFileHistory = useCallback(
        async (id: string) => {
            // The dialog works on the tab on screen, so the comparison is with what the editor shows.
            await setActiveTab(id)
            setTabId(id)
            setOpening((n) => n + 1)
            setAnnouncement('')
            setOpen(true)
        },
        [setActiveTab]
    )

    const onRestored = useCallback((text: string) => {
        setAnnouncement(text)
        setOpen(false)
    }, [])

    const value = useMemo(() => ({ showFileHistory }), [showFileHistory])

    return (
        <FileHistoryContext.Provider value={value}>
            {children}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogPopup
                    className="h-[min(85vh,760px)] max-w-5xl"
                    // Back to the editor, which shows the file (and, after a restore, the restored text).
                    finalFocus={() => (focusEditorNow() ? false : true)}
                >
                    {tabId !== null ? <FileHistoryDialogContent key={opening} tabId={tabId} onRestored={onRestored} /> : null}
                </DialogPopup>
            </Dialog>
            <div aria-live="polite" role="status" className="sr-only" data-slot="file-history-announcement">
                {announcement}
            </div>
        </FileHistoryContext.Provider>
    )
}

function FileHistoryDialogContent({ tabId, onRestored }: { tabId: string; onRestored: (announcement: string) => void }) {
    const { tabs } = useDocumentTabs()
    const tab = tabs.find((t) => t.id === tabId)
    return (
        <>
            <DialogHeader>
                <DialogTitle className="wrap-anywhere">File History: {tab?.name ?? 'closed file'}</DialogTitle>
                <DialogDescription>
                    Each time you save, Scrivon keeps a copy of the file in its own data folder. Pick a version to compare it with the text in the
                    editor, and Restore to put it back as an unsaved change.
                </DialogDescription>
            </DialogHeader>
            {tab ? (
                <FileHistoryBody tab={tab} onRestored={onRestored} />
            ) : (
                <p className="px-6 pb-6 text-sm text-muted-foreground">The file was closed.</p>
            )}
        </>
    )
}
