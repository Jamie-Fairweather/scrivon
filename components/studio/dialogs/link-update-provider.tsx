'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { relativePath } from '@/components/studio/command-palette/search-files'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { notifySuccess, notifyWarning, type NotifyOptions } from '@/lib/notify'
import { recordFileVersion } from '@/lib/tauri/file-history'
import { getBaseName, getParentPath, readStamp, readWorkspaceTextFile, samePath, writeWorkspaceFile } from '@/lib/tauri/fs'
import { displayPath } from '@/lib/workspace/display-path'
import type { LinkRewrite } from '@/lib/workspace/link-rewrite'
import {
    applyLinkUpdates,
    describeBlockedOnly,
    describeLinkSkip,
    describeLinkUpdateOutcome,
    scanLinkUpdates,
    uncheckedNote,
    type LinkMove,
    type LinkUpdateNotice,
    type LinkUpdateScan,
} from '@/lib/workspace/link-update'

/** More links than anyone reads in a dialog: the rest are counted. Every one is still updated. */
const MAX_LISTED_LINKS = 200

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`
}

function notify(notice: LinkUpdateNotice): void {
    const options: NotifyOptions = notice.description ? { description: notice.description } : {}
    if (notice.kind === 'success') notifySuccess(notice.title, options)
    else notifyWarning(notice.title, { ...options, timeout: 10_000 })
}

/** The files and links the dialog lists: the first MAX_LISTED_LINKS links, in order. */
function listedRewrites(files: LinkUpdateScan['files']): Array<{ file: LinkUpdateScan['files'][number]; shown: LinkRewrite[] }> {
    const listing: Array<{ file: LinkUpdateScan['files'][number]; shown: LinkRewrite[] }> = []
    let room = MAX_LISTED_LINKS
    for (const file of files) {
        if (room <= 0) break
        const shown = file.rewrites.slice(0, room)
        room -= shown.length
        listing.push({ file, shown })
    }
    return listing
}

/** Lets the explorer finish showing the move (and putting focus on the moved row) before anything else happens. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export type LinkUpdateDialogProps = {
    open: boolean
    scan: LinkUpdateScan | null
    onAnswer: (update: boolean) => void
    /** Where focus goes when the dialog closes. */
    finalFocus?: () => HTMLElement | boolean
}

/** The question after a rename or move: each file that would change, with each link's old and new address. */
export function LinkUpdateDialog({ open, scan, onAnswer, finalFocus }: LinkUpdateDialogProps) {
    const move = scan?.move
    const renamed = move ? samePath(getParentPath(move.oldPath), getParentPath(move.newPath)) : false
    const name = move ? getBaseName(move.oldPath) : ''
    const links = scan?.files.reduce((sum, file) => sum + file.rewrites.length, 0) ?? 0
    const files = scan?.files.length ?? 0
    const unchecked = scan ? uncheckedNote(scan) : null
    const listing = scan ? listedRewrites(scan.files) : []
    const listed = listing.reduce((sum, entry) => sum + entry.shown.length, 0)

    return (
        <AlertDialog open={open} onOpenChange={(next) => !next && onAnswer(false)}>
            <AlertDialogPopup className="max-w-xl" finalFocus={finalFocus}>
                <AlertDialogHeader>
                    <AlertDialogTitle>Update links?</AlertDialogTitle>
                    {/* A div, so the notes below are part of what a screen reader reads out with the title. */}
                    <AlertDialogDescription className="flex flex-col gap-2 wrap-anywhere" render={<div />}>
                        <p>
                            {renamed ? 'Renaming' : 'Moving'} <span className="font-medium text-foreground">{displayPath(name)}</span> breaks{' '}
                            {plural(links, 'link')} in {plural(files, 'file')}. Update {links === 1 ? 'it' : 'them'} to the new place?
                        </p>
                        {scan && scan.blocked.length > 0 ? (
                            <p>
                                {scan.blocked
                                    .map(
                                        (skip) =>
                                            `${displayPath(relativePath(move!.root, skip.path))} links to it too, but won't change: ${describeLinkSkip(skip)}.`
                                    )
                                    .join(' ')}
                            </p>
                        ) : null}
                        {unchecked ? <p>{unchecked}</p> : null}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {scan ? (
                    <div
                        className="mx-6 mb-6 max-h-72 min-h-0 overflow-auto rounded-lg border bg-muted/40 p-3 text-sm focus-visible:ring-2
                            focus-visible:ring-ring focus-visible:outline-none"
                        // Focusable, so the list can be scrolled from the keyboard.
                        tabIndex={0}
                        role="region"
                        aria-label="Links to update"
                    >
                        <ul className="flex flex-col gap-3">
                            {listing.map(({ file, shown }) => {
                                return (
                                    <li key={file.path}>
                                        <p className="font-medium wrap-anywhere text-foreground">
                                            {displayPath(relativePath(scan.move.root, file.path))}
                                        </p>
                                        <ul className="mt-1 flex flex-col gap-1">
                                            {shown.map((rewrite) => (
                                                <li
                                                    key={rewrite.span.start}
                                                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-muted-foreground"
                                                >
                                                    <span className="text-xs">Line {rewrite.line}:</span>
                                                    <code className="rounded bg-muted px-1 font-mono text-xs wrap-anywhere text-foreground">
                                                        {rewrite.oldAddress}
                                                    </code>
                                                    <span aria-hidden="true">→</span>
                                                    <span className="sr-only">becomes</span>
                                                    <code className="rounded bg-muted px-1 font-mono text-xs wrap-anywhere text-foreground">
                                                        {rewrite.newAddress}
                                                    </code>
                                                </li>
                                            ))}
                                        </ul>
                                    </li>
                                )
                            })}
                        </ul>
                        {links > listed ? <p className="mt-3 text-muted-foreground">And {plural(links - listed, 'more link')}.</p> : null}
                    </div>
                ) : null}
                <AlertDialogFooter>
                    <AlertDialogClose render={<Button type="button" variant="ghost" />} onClick={() => onAnswer(false)}>
                        Don&apos;t Update
                    </AlertDialogClose>
                    <AlertDialogClose render={<Button type="button" />} onClick={() => onAnswer(true)}>
                        Update Links
                    </AlertDialogClose>
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    )
}

type Pending = { scan: LinkUpdateScan; answer: (update: boolean) => void; returnFocus: Element | null }

/**
 * Offers to update links after a rename or move: registers the coordinator's offerLinkUpdates, which the workspace
 * session calls once a move is done. It scans the folder's Markdown files, asks when the move broke any links, and
 * makes the changes it was allowed to. One offer at a time: a move made while one is open waits its turn.
 */
export function LinkUpdateHost({ coordinator, children }: { coordinator: WorkspaceCoordinatorRefs; children?: ReactNode }) {
    const { settings } = useAppSettings()
    const { workspaceRoot } = useWorkspaceSession()
    const offerRef = useRef(settings.workspace.offerLinkUpdates)
    const keepHistoryRef = useRef(settings.fileHistory.enabled)
    const rootRef = useRef(workspaceRoot)
    useEffect(() => {
        offerRef.current = settings.workspace.offerLinkUpdates
        keepHistoryRef.current = settings.fileHistory.enabled
        rootRef.current = workspaceRoot
    }, [settings.workspace.offerLinkUpdates, settings.fileHistory.enabled, workspaceRoot])

    // The last question stays (closed) after it is answered, so the dialog keeps its text while it fades out and
    // knows where focus goes back to.
    const [shown, setShown] = useState<Pending | null>(null)
    const [open, setOpen] = useState(false)
    const pendingRef = useRef<Pending | null>(null)
    const queueRef = useRef<Promise<void>>(Promise.resolve())

    const isOpen = useCallback((root: string) => rootRef.current !== null && samePath(rootRef.current, root), [])

    const offerOne = useCallback(
        async (move: LinkMove) => {
            if (!offerRef.current) return
            await nextTask()
            if (!isOpen(move.root)) return
            const getTabs = () => coordinator.getTabs.current()
            const scan = await scanLinkUpdates({ move, getTabs, readTextFile: readWorkspaceTextFile, readStamp })
            if (!isOpen(move.root) || !offerRef.current) return
            if (scan.files.length === 0) {
                // Nothing to ask about, but the user should know why links to it still break.
                if (scan.blocked.length > 0) notify(describeBlockedOnly(scan))
                return
            }

            const update = await new Promise<boolean>((resolve) => {
                const next: Pending = {
                    scan,
                    returnFocus: typeof document === 'undefined' ? null : document.activeElement,
                    answer: (answer) => {
                        if (pendingRef.current !== next) return
                        pendingRef.current = null
                        setOpen(false)
                        resolve(answer)
                    },
                }
                pendingRef.current = next
                setShown(next)
                setOpen(true)
            })
            if (!update || !isOpen(move.root)) return

            const outcome = await applyLinkUpdates({
                scan,
                getTabs,
                applyTabEdits: (tabId, edits) => coordinator.applyTabEdits.current(tabId, edits),
                readTextFile: readWorkspaceTextFile,
                writeTextFile: writeWorkspaceFile,
                // The old text is kept in Local History, when it is on, so a file written here can still be got back.
                keepVersion: keepHistoryRef.current ? (path, text) => recordFileVersion(path, text, 'before-first-write') : undefined,
                onWritten: (path) => coordinator.fileSaved.current(path),
            })
            notify(describeLinkUpdateOutcome(outcome, scan))
        },
        [coordinator, isOpen]
    )

    const offerLinkUpdates = useCallback(
        (move: LinkMove) => {
            const run = queueRef.current.then(() => offerOne(move))
            queueRef.current = run.catch((err: unknown) => console.warn("Couldn't update links", err))
            return run
        },
        [offerOne]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { offerLinkUpdates })
    }, [coordinator, offerLinkUpdates])

    // Another folder opened (or the folder closed) while asking: its files aren't the ones to change.
    useEffect(() => {
        const current = pendingRef.current
        if (current && (workspaceRoot === null || !samePath(workspaceRoot, current.scan.move.root))) current.answer(false)
    }, [workspaceRoot])

    const returnFocus = shown?.returnFocus
    const finalFocus = useCallback(() => (returnFocus instanceof HTMLElement && returnFocus.isConnected ? returnFocus : true), [returnFocus])

    return (
        <>
            {children}
            <LinkUpdateDialog
                open={open}
                scan={shown?.scan ?? null}
                onAnswer={(update) => pendingRef.current?.answer(update)}
                finalFocus={finalFocus}
            />
        </>
    )
}

export function LinkUpdateProvider({ children }: { children: ReactNode }) {
    const coordinator = useWorkspaceCoordinator()
    return <LinkUpdateHost coordinator={coordinator}>{children}</LinkUpdateHost>
}
