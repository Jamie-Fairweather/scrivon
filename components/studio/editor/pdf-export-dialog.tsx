'use client'

import { useState } from 'react'
import { exportMarkdown, type ExportMarkdownOptions } from '@/lib/markdown/export-pdf'
import type { ExportFormat } from '@/lib/markdown/export-document'
import { resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { getActivePdfExportProfile } from '@/lib/settings/pdf-export-profiles'
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
    format?: ExportFormat
}

export function PdfExportDialog({ open, onOpenChange, source, tabName, format = 'pdf' }: PdfExportDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPopup className="max-w-lg">
                {/* The popup unmounts when closed, so the form's state starts fresh on every open. */}
                <PdfExportForm key={format} source={source} tabName={tabName} initialFormat={format} onClose={() => onOpenChange(false)} />
            </DialogPopup>
        </Dialog>
    )
}

const FORMAT_OPTIONS: { label: string; value: ExportFormat }[] = [
    { label: 'PDF', value: 'pdf' },
    { label: 'Word', value: 'docx' },
]

function PdfExportForm({
    source,
    tabName,
    initialFormat,
    onClose,
}: {
    source: string
    tabName: string | undefined
    initialFormat: ExportFormat
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
    const [busy, setBusy] = useState(false)

    const overrides: ExportMarkdownOptions['overrides'] = { title, subtitle, author, date }

    const runExport = async () => {
        setBusy(true)
        try {
            await exportMarkdown(source, tabName, { format, profile, overrides })
            onClose()
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle>Export document</DialogTitle>
                <DialogDescription>Choose a format, profile, and optional title metadata for this export.</DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
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
            </DialogPanel>
            <DialogFooter>
                <Button type="button" disabled={busy} onClick={() => void runExport()}>
                    Export
                </Button>
            </DialogFooter>
        </>
    )
}
