'use client'

import { useEffect, useRef, useState } from 'react'
import { exportMarkdown, notifyExportSaved, type ExportMarkdownOptions } from '@/lib/markdown/export-pdf'
import type { ExportFormat } from '@/lib/markdown/export-document'
import { pdfPageNumberFormat, resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { notifyError } from '@/lib/notify'
import { getActivePdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import type { PdfExportMetadata, PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { isWindowsTauri } from '@/lib/tauri/platform'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { OptionSelect } from '@/components/ui/option-select'

type PdfExportDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    source: string
    tabName: string | undefined
    /** The document's file path, so the save dialog starts in its folder. */
    tabPath?: string
    format?: ExportFormat
    /**
     * Whether an export is running. Kept by the owner, not the dialog, so it outlives the dialog
     * (a tab switch can unmount it mid-export) and a second export can't start alongside the first.
     */
    exporting: boolean
    onExportingChange: (exporting: boolean) => void
}

export function PdfExportDialog({
    open,
    onOpenChange,
    source,
    tabName,
    tabPath,
    format = 'pdf',
    exporting,
    onExportingChange,
}: PdfExportDialogProps) {
    // Closing mid-export would leave the save picker popping up later with no dialog behind it.
    const handleOpenChange = (next: boolean) => {
        if (!next && exporting) return
        onOpenChange(next)
    }
    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogPopup className="max-w-lg">
                {/* The popup unmounts when closed, so the form's state starts fresh on every open. */}
                <PdfExportForm
                    key={format}
                    source={source}
                    tabName={tabName}
                    tabPath={tabPath}
                    initialFormat={format}
                    busy={exporting}
                    onBusyChange={onExportingChange}
                    onClose={() => onOpenChange(false)}
                />
            </DialogPopup>
        </Dialog>
    )
}

const FORMAT_OPTIONS: { label: string; value: ExportFormat }[] = [
    { label: 'PDF', value: 'pdf' },
    { label: 'Word', value: 'docx' },
]

/**
 * Only the Windows app stamps page numbers into a PDF. Elsewhere it goes through the print
 * dialog: the TOC has no page column, and footer numbers rely on the engine drawing CSS page
 * counters, which WebKit (macOS, Linux) doesn't. Empty when nothing the profile asks for is lost.
 */
function pageNumberNote(format: ExportFormat, profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    if (format !== 'pdf' || isWindowsTauri()) return ''
    const footer = pdfPageNumberFormat(profile, metadata) !== 'none'
    const toc = profile.frontMatter.toc
    if (footer && toc) return 'Outside the Windows app, footer page numbers may not print, and the table of contents shows no page numbers.'
    if (footer) return 'Outside the Windows app, footer page numbers may not print.'
    if (toc) return 'Outside the Windows app, the table of contents shows no page numbers.'
    return ''
}

function PdfExportForm({
    source,
    tabName,
    tabPath,
    initialFormat,
    busy,
    onBusyChange,
    onClose,
}: {
    source: string
    tabName: string | undefined
    tabPath: string | undefined
    initialFormat: ExportFormat
    busy: boolean
    onBusyChange: (busy: boolean) => void
    onClose: () => void
}) {
    const { settings } = useAppSettings()
    const pdf = settings.pdfExport
    // The choice here is for this export only; the default profile lives in Settings.
    const [profileId, setProfileId] = useState(pdf.activeProfileId)
    const profile = pdf.profiles.find((candidate) => candidate.id === profileId) ?? getActivePdfExportProfile(pdf)

    const [defaults] = useState(() => resolvePdfExportMetadata(source, tabName).metadata)
    const [title, setTitle] = useState(defaults.title)
    const [subtitle, setSubtitle] = useState(defaults.subtitle)
    const [author, setAuthor] = useState(defaults.author)
    const [date, setDate] = useState(defaults.date)
    const [format, setFormat] = useState<ExportFormat>(initialFormat)
    const [error, setError] = useState('')

    const overrides: ExportMarkdownOptions['overrides'] = { title, subtitle, author, date }
    const note = pageNumberNote(format, profile, { title, subtitle, author, date })

    // Whether this form is still on screen, so an export that outlives it reports a failure as a toast.
    const mounted = useRef(false)
    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
        }
    }, [])

    const runExport = async () => {
        onBusyChange(true)
        setError('')
        try {
            const result = await exportMarkdown(source, tabName, { format, profile, overrides, documentPath: tabPath })
            // Cancelling the save picker or a failure keeps the dialog, and the edits, so the user can retry.
            if (result.status === 'saved') {
                notifyExportSaved(result)
                // Safe even if this form went away mid-export: the export button stays disabled while
                // an export runs, so no newer dialog can have been opened since.
                onClose()
            } else if (result.status === 'failed') {
                // A form that went away mid-export has nowhere to show the error, so say it in a toast.
                if (mounted.current) setError(result.message)
                else notifyError('Export failed', undefined, { description: result.message })
            }
        } finally {
            onBusyChange(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle>Export document</DialogTitle>
                <DialogDescription>Choose a format, profile, and optional title metadata for this export.</DialogDescription>
                {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
            </DialogHeader>
            <DialogPanel className="space-y-4">
                <fieldset disabled={busy} className="min-w-0 space-y-4">
                    <Field>
                        <FieldLabel htmlFor="export-format">Format</FieldLabel>
                        <OptionSelect id="export-format" value={format} options={FORMAT_OPTIONS} onChange={setFormat} />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="export-profile">Profile</FieldLabel>
                        <OptionSelect
                            id="export-profile"
                            value={profile.id}
                            options={pdf.profiles.map((candidate) => ({ label: candidate.name, value: candidate.id }))}
                            onChange={setProfileId}
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="export-title">Title</FieldLabel>
                        <Input id="export-title" value={title} onChange={(event) => setTitle(event.target.value)} />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="export-subtitle">Subtitle</FieldLabel>
                        <Input id="export-subtitle" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="export-author">Author</FieldLabel>
                        <Input id="export-author" value={author} onChange={(event) => setAuthor(event.target.value)} />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="export-date">Date</FieldLabel>
                        <Input id="export-date" value={date} onChange={(event) => setDate(event.target.value)} />
                    </Field>
                </fieldset>
                {error ? (
                    <p role="alert" className="text-sm text-destructive-foreground">
                        Export failed: {error}
                    </p>
                ) : null}
            </DialogPanel>
            <DialogFooter>
                <p role="status" aria-live="polite" className="text-sm text-muted-foreground sm:me-auto sm:self-center">
                    {busy ? 'Exporting…' : ''}
                </p>
                <Button type="button" loading={busy} onClick={() => void runExport()}>
                    Export
                </Button>
            </DialogFooter>
        </>
    )
}
