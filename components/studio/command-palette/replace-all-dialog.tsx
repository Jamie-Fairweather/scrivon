'use client'

import type { ReactNode } from 'react'
import { describeSkip } from '@/components/studio/command-palette/replace-content'
import type { ReplaceAllState } from '@/components/studio/command-palette/use-palette-replace'
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
import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import { getBaseName } from '@/lib/tauri/fs'

type ReplaceAllDialogProps = {
    state: ReplaceAllState
    replacement: string
    onConfirm: () => void
    /** Stops the count, says no, or stops replacing before the next file (also Escape). */
    onCancel: () => void
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`

/** How many files of how many, as a bar and in words, for counting and replacing alike. */
function FilesProgress({ label, done, total }: { label: string; done: number; total: number }) {
    return (
        <Progress aria-label={label} className="mt-2" max={Math.max(1, total)} value={total > 0 ? done : null}>
            <ProgressTrack>
                <ProgressIndicator />
            </ProgressTrack>
            <span className="text-sm text-muted-foreground tabular-nums">
                {total > 0 ? `${count(done, 'file', 'files')} of ${total.toLocaleString('en-GB')}` : 'Starting…'}
            </span>
        </Progress>
    )
}

/**
 * Replace All's question and progress, over the palette: the true totals from a fresh count before anything
 * changes, what can't be undone, then files done of all of them, with Cancel (or Escape) to stop.
 */
export function ReplaceAllDialog({ state, replacement, onConfirm, onCancel }: ReplaceAllDialogProps) {
    const open = state.phase !== 'idle'
    const undoKey = isMacPlatform() ? '⌘Z' : 'Ctrl+Z'

    let title = ''
    let body: ReactNode = null
    if (state.phase === 'counting') {
        title = 'Counting matches…'
        body = <FilesProgress done={state.done} label="Files looked at" total={state.total} />
    } else if (state.phase === 'confirm') {
        const { plan } = state
        const onDisk = plan.files.filter((file) => file.source === 'disk').length
        const inTabs = plan.files.length - onDisk
        title = `Replace ${count(plan.totalMatches, 'match', 'matches')} in ${count(plan.files.length, 'file', 'files')}?`
        body = (
            <>
                <p>
                    {replacement ? (
                        <>
                            Each match becomes <span className="font-medium break-all text-foreground">{replacement}</span>.
                        </>
                    ) : (
                        'Each match is deleted.'
                    )}
                </p>
                {onDisk > 0 ? (
                    <p className="font-medium text-foreground">
                        {onDisk === plan.files.length ? 'These files aren’t' : `${count(onDisk, 'file isn’t', 'files aren’t')}`} open in a tab, so{' '}
                        {onDisk === 1 ? 'it is' : 'they are'} saved straight away, and {undoKey} can’t undo {onDisk === 1 ? 'it' : 'them'}.
                    </p>
                ) : null}
                {inTabs > 0 ? (
                    <p>
                        {count(inTabs, 'open file changes', 'open files change')} in {inTabs === 1 ? 'its tab' : 'their tabs'}, where {undoKey} undoes
                        it.
                    </p>
                ) : null}
                {plan.skipped.length > 0 ? (
                    <div>
                        <p>{count(plan.skipped.length, 'file is', 'files are')} left as they are:</p>
                        <ul className="mt-1 list-disc ps-5">
                            {plan.skipped.slice(0, 5).map((skip) => (
                                <li key={skip.path}>
                                    {getBaseName(skip.path)}: {describeSkip(skip)}
                                </li>
                            ))}
                            {plan.skipped.length > 5 ? <li>and {count(plan.skipped.length - 5, 'other', 'others')}</li> : null}
                        </ul>
                    </div>
                ) : null}
            </>
        )
    } else if (state.phase === 'running') {
        title = state.stopping ? 'Stopping…' : 'Replacing…'
        body = <FilesProgress done={state.done} label="Files replaced in" total={state.total} />
    } else if (state.phase === 'stopped') {
        title = 'Replace All stopped'
        body = <p>{state.message}</p>
    }

    return (
        <AlertDialog
            onOpenChange={(next) => {
                if (!next) onCancel()
            }}
            open={open}
        >
            <AlertDialogPopup>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription className="flex flex-col gap-2 wrap-anywhere" render={<div />}>
                        {body}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {state.phase === 'stopped' ? (
                        <AlertDialogClose render={<Button type="button" variant="default" />}>Close</AlertDialogClose>
                    ) : (
                        <Button disabled={state.phase === 'running' && state.stopping} onClick={onCancel} type="button" variant="ghost">
                            Cancel
                        </Button>
                    )}
                    {state.phase === 'confirm' ? (
                        <Button onClick={onConfirm} type="button" variant="destructive">
                            Replace All
                        </Button>
                    ) : null}
                </AlertDialogFooter>
            </AlertDialogPopup>
        </AlertDialog>
    )
}
