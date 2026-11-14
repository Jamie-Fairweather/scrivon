'use client'

import { useEffect, useRef, useState } from 'react'
import type { ExportMarkdownOptions } from '@/lib/markdown/export-pdf'
import type { ExportFormat } from '@/lib/markdown/export-document'
import { pdfPageNumberFormat, resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { notifyError } from '@/lib/notify'
import { getActivePdfExportProfile, pdfBodyHeightMm, PDF_MIN_BODY_HEIGHT_MM } from '@/lib/settings/pdf-export-profiles'
import type { PdfExportMetadata, PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { isWindowsTauri } from '@/lib/tauri/platform'
import { PdfExportPreview } from '@/components/studio/editor/pdf-export-preview'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { BetaBadge } from '@/components/ui/beta-badge'
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
    /** The document's file path, so the save dialog starts in its folder and its images are found from it. */
    tabPath?: string
    /** The open folder. Only images inside it are embedded. */
    workspaceRoot?: string | null
    format?: ExportFormat
    /** The user chose 'Load images' in this document's preview, so the export embeds its web images too. */
    allowRemoteImages?: boolean
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
    workspaceRoot = null,
    format = 'pdf',
    allowRemoteImages = false,
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
            {/* With the PDF preview, a wide screen gets two columns: the settings, and the PDF beside them. */}
            <DialogPopup
                className="max-w-lg md:has-[[data-slot=pdf-preview]]:grid md:has-[[data-slot=pdf-preview]]:h-[min(85vh,56rem)]
                    md:has-[[data-slot=pdf-preview]]:max-w-5xl md:has-[[data-slot=pdf-preview]]:grid-cols-[22rem_minmax(0,1fr)]
                    md:has-[[data-slot=pdf-preview]]:grid-rows-[auto_minmax(0,1fr)_auto]"
            >
                {/* The popup unmounts when closed, so the form's state starts fresh on every open. */}
                <PdfExportForm
                    key={format}
                    source={source}
                    tabName={tabName}
                    tabPath={tabPath}
                    workspaceRoot={workspaceRoot}
                    initialFormat={format}
                    allowRemoteImages={allowRemoteImages}
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

/**
 * The page-space warning from Settings, for the profile picked here: margins, header and footer
 * that leave little or no room for the text. The export still runs; Settings is where to fix it.
 */
function pageSpaceNote(profile: PdfExportProfile): string {
    const bodyHeightMm = pdfBodyHeightMm(profile)
    if (bodyHeightMm >= PDF_MIN_BODY_HEIGHT_MM) return ''
    if (bodyHeightMm <= 0) return 'Margins, header and footer are taller than the page, so there is no room left for the text.'
    return `Margins, header and footer leave only ${Math.floor(bodyHeightMm)} mm of page height for the text.`
}

/**
 * With the title page off, the subtitle, author and date fields change nothing on the page
 * unless a header or footer uses them, so say where they go. Word files, and PDFs from the
 * Windows app, also keep the author and subtitle in the file's properties.
 */
function titleFieldsNote(format: ExportFormat, profile: PdfExportProfile): string {
    if (profile.frontMatter.titlePage) return ''
    const note = 'Subtitle, author and date appear on the title page (off in this profile) and in {{…}} header or footer text.'
    const savedInFile = format === 'docx' || isWindowsTauri()
    return savedInFile ? `${note} Author and subtitle are also saved in the file's properties.` : note
}

/** How long to wait for a paint at most: a hidden window runs no animation frames. */
const PAINT_WAIT_MS = 100

/**
 * Resolves once the browser has painted, so a busy state set just before shows up. Building a
 * Word or PDF file can hold the main thread for seconds, and nothing repaints until it ends.
 */
function afterNextPaint(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, PAINT_WAIT_MS)
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0))
    })
}

/** Loaded when the user exports, so the export code and the diagram renderer it needs aren't part of every launch. */
const loadMarkdownExport = () => import('@/lib/markdown/export-pdf')

function PdfExportForm({
    source,
    tabName,
    tabPath,
    workspaceRoot,
    initialFormat,
    allowRemoteImages,
    busy,
    onBusyChange,
    onClose,
}: {
    source: string
    tabName: string | undefined
    tabPath: string | undefined
    workspaceRoot: string | null
    initialFormat: ExportFormat
    allowRemoteImages: boolean
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
    const spaceNote = pageSpaceNote(profile)
    const fieldsNote = titleFieldsNote(format, profile)
    // The preview prints through the Windows exporter, so it's only there for PDFs in the Windows app.
    const showPreview = format === 'pdf' && isWindowsTauri()

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
            // Let 'Exporting…' paint before the build takes over the main thread.
            await afterNextPaint()
            const { exportMarkdown, notifyExportSaved } = await loadMarkdownExport()
            const result = await exportMarkdown(source, tabName, {
                format,
                profile,
                overrides,
                documentPath: tabPath,
                workspaceRoot,
                allowRemoteImages,
            })
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
        } catch (err) {
            // exportMarkdown reports its own failures, so this is the export code failing to load.
            if (mounted.current) setError("Couldn't start the export. Try again.")
            else notifyError('Export failed', err)
        } finally {
            onBusyChange(false)
        }
    }

    return (
        <>
            <DialogHeader className="col-span-full">
                <DialogTitle className="flex items-center gap-2">
                    Export document
                    <BetaBadge />
                </DialogTitle>
                <DialogDescription>Choose a format, profile, and optional title metadata for this export.</DialogDescription>
                {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
                {spaceNote ? <p className="text-xs text-warning-foreground">{spaceNote}</p> : null}
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
                    {fieldsNote ? <p className="text-xs text-muted-foreground">{fieldsNote}</p> : null}
                </fieldset>
                {error ? (
                    <p role="alert" className="text-sm text-destructive-foreground">
                        Export failed: {error}
                    </p>
                ) : null}
            </DialogPanel>
            {showPreview ? (
                <PdfExportPreview
                    source={source}
                    tabName={tabName}
                    tabPath={tabPath}
                    workspaceRoot={workspaceRoot}
                    profile={profile}
                    title={title}
                    subtitle={subtitle}
                    author={author}
                    date={date}
                    allowRemoteImages={allowRemoteImages}
                    className="h-[40vh] shrink-0 px-6 pb-6 md:h-auto md:ps-0 md:pt-1"
                />
            ) : null}
            <DialogFooter className="col-span-full">
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
