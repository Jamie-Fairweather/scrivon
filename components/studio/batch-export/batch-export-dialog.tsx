'use client'

import { useId } from 'react'
import { DIAGRAM_THEMES } from '@/components/studio/editor/export-commands'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { OptionSelect } from '@/components/ui/option-select'
import { Progress, ProgressIndicator, ProgressLabel, ProgressTrack } from '@/components/ui/progress'
import type { BatchExportResult, BatchOutcome, BatchProgress } from '@/lib/mermaid/batch-export'
import type { DiagramExportSettings, DiagramExportTheme } from '@/lib/settings/types'
import { getBaseName } from '@/lib/tauri/fs'
import { displayPath } from '@/lib/workspace/display-path'
import { cn } from '@/lib/utils'

/** SVG, or PNG at one of the export menu's scales. */
export type BatchImageChoice = 'svg' | 'png-1' | 'png-2' | 'png-4'

/** The choices kept for the session: the format and whether to go into subfolders. */
export type BatchSessionOptions = { image: BatchImageChoice; includeSubfolders: boolean }

const IMAGE_OPTIONS: { label: string; value: BatchImageChoice }[] = [
    { label: 'SVG', value: 'svg' },
    { label: 'PNG (1×)', value: 'png-1' },
    { label: 'PNG (2×)', value: 'png-2' },
    { label: 'PNG (4×)', value: 'png-4' },
]

const THEME_OPTIONS = DIAGRAM_THEMES.map(({ theme, name }) => ({ label: name, value: theme }))

/** The summary's counts and the first line of it, worked out by the export code (see batchHeadline). */
export type BatchSummary = { result: BatchExportResult; headline: string }

/** What the dialog shows: the options, the progress of a running export, or what it did. */
export type BatchDialogView =
    | { step: 'options'; folder: string }
    | { step: 'running'; folder: string; progress: BatchProgress; cancelling: boolean }
    | { step: 'summary'; folder: string; summary: BatchSummary }

export type BatchExportDialogProps = {
    open: boolean
    /** Kept as it was while the dialog closes, so its words stay put as it fades out. */
    view: BatchDialogView | null
    options: BatchSessionOptions
    onOptionsChange: (change: Partial<BatchSessionOptions>) => void
    /** The theme and background, shared with the export menu. */
    diagramOptions: DiagramExportSettings
    onDiagramOptionsChange: (change: Partial<DiagramExportSettings>) => void
    outputFolder: string | null
    onChooseFolder: () => void
    /** Why Export can't run although a folder is chosen (another export is running), or null. */
    blockedReason: string | null
    onExport: () => void
    /** Cancel in the progress dialog, and Escape there. */
    onCancelExport: () => void
    onShowInFolder: () => void
    onClose: () => void
    /** Where focus goes when the dialog closes. */
    finalFocus: () => HTMLElement | boolean
}

function OptionsView({
    folder,
    options,
    onOptionsChange,
    diagramOptions,
    onDiagramOptionsChange,
    outputFolder,
    onChooseFolder,
    blockedReason,
    onExport,
    onClose,
}: Omit<BatchExportDialogProps, 'open' | 'view' | 'onCancelExport' | 'onShowInFolder' | 'finalFocus'> & { folder: string }) {
    const id = useId()
    const hintId = `${id}-hint`
    const hint = blockedReason ?? (outputFolder ? null : 'Choose a folder to save the diagrams in.')
    return (
        <>
            <DialogHeader>
                <DialogTitle>Export diagrams</DialogTitle>
                <DialogDescription className="wrap-anywhere">
                    Saves every .mmd and .mermaid file in {getBaseName(folder)} as a picture. Files already in the output folder are never replaced.
                </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
                <Field>
                    <FieldLabel htmlFor={`${id}-format`}>Format</FieldLabel>
                    <OptionSelect
                        id={`${id}-format`}
                        value={options.image}
                        options={IMAGE_OPTIONS}
                        onChange={(image) => onOptionsChange({ image })}
                    />
                </Field>
                <Field>
                    <FieldLabel htmlFor={`${id}-theme`}>Diagram Theme</FieldLabel>
                    <OptionSelect<DiagramExportTheme>
                        id={`${id}-theme`}
                        value={diagramOptions.theme}
                        options={THEME_OPTIONS}
                        onChange={(theme) => onDiagramOptionsChange({ theme })}
                    />
                </Field>
                <SwitchSetting
                    label="Transparent Background"
                    checked={diagramOptions.transparent}
                    onChange={(transparent) => onDiagramOptionsChange({ transparent })}
                />
                <SwitchSetting
                    label="Include subfolders"
                    description="Keeps the subfolders in the output folder. Hidden folders such as .git and node_modules are left out."
                    checked={options.includeSubfolders}
                    onChange={(includeSubfolders) => onOptionsChange({ includeSubfolders })}
                />
                <Field>
                    <FieldLabel htmlFor={`${id}-output`}>Output folder</FieldLabel>
                    <div className="flex w-full items-center gap-2">
                        <Input
                            id={`${id}-output`}
                            readOnly
                            dir="auto"
                            value={outputFolder ? displayPath(outputFolder) : ''}
                            placeholder="No folder chosen"
                            title={outputFolder ?? undefined}
                        />
                        <Button type="button" variant="outline" className="shrink-0" onClick={onChooseFolder}>
                            Choose Folder…
                        </Button>
                    </div>
                </Field>
            </DialogPanel>
            <DialogFooter>
                <p id={hintId} className="text-sm text-muted-foreground sm:me-auto sm:self-center">
                    {hint}
                </p>
                <Button type="button" variant="ghost" onClick={onClose}>
                    Cancel
                </Button>
                <Button
                    type="button"
                    disabled={!outputFolder || blockedReason !== null}
                    aria-describedby={hint ? hintId : undefined}
                    onClick={onExport}
                >
                    Export
                </Button>
            </DialogFooter>
        </>
    )
}

/** The progress bar's words, which screen readers announce as they change. */
export function progressText(progress: BatchProgress, cancelling: boolean): string {
    if (cancelling) return progress.phase === 'saving' ? `Cancelling after diagram ${progress.current} of ${progress.total}…` : 'Cancelling…'
    if (progress.phase === 'listing') return 'Finding diagrams…'
    if (progress.phase === 'checking') return 'Checking for names already used…'
    return `Saving ${progress.current} of ${progress.total}`
}

function RunningView({
    folder,
    outputFolder,
    progress,
    cancelling,
    onCancelExport,
}: {
    folder: string
    outputFolder: string | null
    progress: BatchProgress
    cancelling: boolean
    onCancelExport: () => void
}) {
    const text = progressText(progress, cancelling)
    const saving = progress.phase === 'saving'
    return (
        <>
            <DialogHeader>
                <DialogTitle>Exporting diagrams</DialogTitle>
                <DialogDescription className="wrap-anywhere">
                    From {getBaseName(folder)}
                    {outputFolder ? ` to ${getBaseName(outputFolder)}` : ''}. Cancel stops after the diagram being saved.
                </DialogDescription>
            </DialogHeader>
            <DialogPanel>
                {/* No value while listing: the bar shows it is busy without saying how far. */}
                <Progress value={saving ? progress.current : null} max={saving ? progress.total : 100} getAriaValueText={() => text}>
                    <ProgressLabel aria-live="polite" aria-atomic className="font-normal">
                        {text}
                    </ProgressLabel>
                    <ProgressTrack>
                        <ProgressIndicator />
                    </ProgressTrack>
                </Progress>
            </DialogPanel>
            <DialogFooter>
                <Button type="button" variant="outline" autoFocus disabled={cancelling} onClick={onCancelExport}>
                    {cancelling ? 'Cancelling…' : 'Cancel'}
                </Button>
            </DialogFooter>
        </>
    )
}

function OutcomeList({ title, outcomes, tone }: { title: string; outcomes: BatchOutcome[]; tone?: 'failed' }) {
    const id = useId()
    if (outcomes.length === 0) return null
    return (
        <section aria-labelledby={id} className="space-y-1.5">
            <h3 id={id} className={cn('text-sm font-medium', tone === 'failed' && 'text-destructive-foreground')}>
                {title} ({outcomes.length})
            </h3>
            <ul className="space-y-1.5 text-sm" aria-labelledby={id}>
                {outcomes.map((outcome, index) => (
                    <li key={`${outcome.source}-${index}`} className="wrap-anywhere">
                        <OutcomeLine outcome={outcome} />
                    </li>
                ))}
            </ul>
        </section>
    )
}

function OutcomeLine({ outcome }: { outcome: BatchOutcome }) {
    const source = <span dir="auto">{displayPath(outcome.source)}</span>
    if (outcome.status === 'saved') {
        return (
            <>
                {source}
                <span aria-hidden className="px-1 text-muted-foreground">
                    →
                </span>
                <span className="sr-only"> saved as </span>
                <span dir="auto">{displayPath(outcome.output)}</span>
                {outcome.note ? <span className="block text-xs text-warning-foreground">{outcome.note}</span> : null}
            </>
        )
    }
    return (
        <>
            {source}
            <span className="block text-xs text-muted-foreground">{outcome.reason}</span>
            {outcome.status === 'failed' && outcome.leftover ? (
                <span className="block text-xs text-warning-foreground">
                    Couldn&apos;t remove the temporary file <span dir="auto">{displayPath(outcome.leftover)}</span>. You can delete it.
                </span>
            ) : null}
        </>
    )
}

/** The lines under the headline: what was left out, and why. */
function summaryNotes({ result }: BatchSummary): string[] {
    const notes: string[] = []
    if (result.truncated) notes.push('The folder has too many files and folders to list them all, so some diagrams may have been left out.')
    if (result.unreadable.length > 0) {
        const shown = result.unreadable.slice(0, 3).map(displayPath).join(', ')
        const more = result.unreadable.length > 3 ? ` and ${result.unreadable.length - 3} more` : ''
        notes.push(
            `Couldn't read ${result.unreadable.length === 1 ? 'a folder' : `${result.unreadable.length} folders`}, so any diagrams in it were left out: ${shown}${more}.`
        )
    }
    if (result.notTried > 0) notes.push(`${result.notTried} ${result.notTried === 1 ? 'diagram was' : 'diagrams were'} not exported.`)
    return notes
}

function SummaryView({ summary, onShowInFolder, onClose }: { summary: BatchSummary; onShowInFolder: () => void; onClose: () => void }) {
    const { result, headline } = summary
    const by = (status: BatchOutcome['status']) => result.outcomes.filter((outcome) => outcome.status === status)
    const notes = summaryNotes(summary)
    const title = result.error ? "Couldn't export" : result.cancelled ? 'Export cancelled' : 'Export finished'
    return (
        <>
            <DialogHeader>
                <DialogTitle>{title}</DialogTitle>
                {/* Read out as the summary replaces the progress bar. */}
                <DialogDescription role="status" className="wrap-anywhere">
                    {headline}
                </DialogDescription>
                {notes.map((note) => (
                    <p key={note} className="text-xs wrap-anywhere text-warning-foreground">
                        {note}
                    </p>
                ))}
            </DialogHeader>
            <DialogPanel className="space-y-4">
                <OutcomeList title="Saved" outcomes={by('saved')} />
                <OutcomeList title="Skipped" outcomes={by('skipped')} />
                <OutcomeList title="Failed" outcomes={by('failed')} tone="failed" />
            </DialogPanel>
            <DialogFooter>
                {result.error ? null : (
                    <Button type="button" variant="outline" onClick={onShowInFolder}>
                        Show in folder
                    </Button>
                )}
                <Button type="button" autoFocus onClick={onClose}>
                    Done
                </Button>
            </DialogFooter>
        </>
    )
}

/**
 * Export All Diagrams in Folder…: the options, then the progress of the export, then what it saved, skipped and
 * couldn't save. One dialog that changes as the export goes on, so focus stays in it until it closes.
 */
export function BatchExportDialog(props: BatchExportDialogProps) {
    const { open, view, onCancelExport, onClose, finalFocus, onShowInFolder, ...rest } = props
    const running = open && view?.step === 'running'
    return (
        <Dialog
            open={open}
            // A click outside never stops a running export; Escape does what Cancel does.
            disablePointerDismissal={running}
            onOpenChange={(next, details) => {
                if (next) return
                if (!running) onClose()
                else if (details.reason === 'escape-key') onCancelExport()
            }}
        >
            <DialogPopup showCloseButton={!running} finalFocus={finalFocus}>
                {view?.step === 'options' ? <OptionsView {...rest} onClose={onClose} folder={view.folder} /> : null}
                {view?.step === 'running' ? (
                    <RunningView
                        folder={view.folder}
                        outputFolder={props.outputFolder}
                        progress={view.progress}
                        cancelling={view.cancelling}
                        onCancelExport={onCancelExport}
                    />
                ) : null}
                {view?.step === 'summary' ? <SummaryView summary={view.summary} onShowInFolder={onShowInFolder} onClose={onClose} /> : null}
            </DialogPopup>
        </Dialog>
    )
}
