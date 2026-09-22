'use client'

import { useState } from 'react'
import { buildMarkdownExportHtml, exportMarkdownToPdf } from '@/lib/markdown/export-pdf'
import { resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { getActivePdfExportProfile, setActivePdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import type { PdfExportMetadataOverrides } from '@/lib/settings/pdf-export-types'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'

type PdfExportDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    source: string
    tabName: string | undefined
}

export function PdfExportDialog({ open, onOpenChange, source, tabName }: PdfExportDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogPopup className="max-w-lg">
                {/* The popup unmounts when closed, so the form's state starts fresh on every open. */}
                <PdfExportForm source={source} tabName={tabName} onClose={() => onOpenChange(false)} />
            </DialogPopup>
        </Dialog>
    )
}

function PdfExportForm({ source, tabName, onClose }: { source: string; tabName: string | undefined; onClose: () => void }) {
    const { settings, updateSettings } = useAppSettings()
    const pdf = settings.pdfExport
    const active = getActivePdfExportProfile(pdf)

    const [defaults] = useState(() => resolvePdfExportMetadata(source, tabName).metadata)
    const [title, setTitle] = useState(defaults.title)
    const [subtitle, setSubtitle] = useState(defaults.subtitle)
    const [author, setAuthor] = useState(defaults.author)
    const [date, setDate] = useState(defaults.date)
    const [previewHtml, setPreviewHtml] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    const overrides: PdfExportMetadataOverrides = {
        title,
        subtitle,
        author,
        date,
    }

    const runExport = async () => {
        setBusy(true)
        try {
            await exportMarkdownToPdf(source, tabName, { profile: active, overrides })
            onClose()
        } finally {
            setBusy(false)
        }
    }

    const runPreview = async () => {
        setBusy(true)
        try {
            const { html } = await buildMarkdownExportHtml(source, tabName, { profile: active, overrides })
            setPreviewHtml(html)
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle>Export PDF</DialogTitle>
                <DialogDescription>Choose a profile and optional title metadata for this export.</DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-4">
                <Field>
                    <FieldLabel htmlFor="export-profile">Profile</FieldLabel>
                    <Select
                        items={pdf.profiles.map((profile) => ({ label: profile.name, value: profile.id }))}
                        value={pdf.activeProfileId}
                        onValueChange={(value) => {
                            if (!value) return
                            updateSettings((current) => ({
                                ...current,
                                pdfExport: setActivePdfExportProfile(current.pdfExport, value),
                            }))
                        }}
                    >
                        <SelectTrigger id="export-profile">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                            {pdf.profiles.map((profile) => (
                                <SelectItem key={profile.id} value={profile.id}>
                                    {profile.name}
                                </SelectItem>
                            ))}
                        </SelectPopup>
                    </Select>
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
                {previewHtml ? (
                    <iframe title="PDF export preview" className="h-64 w-full rounded-md border border-border bg-white" srcDoc={previewHtml} />
                ) : null}
            </DialogPanel>
            <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void runPreview()}>
                    Preview
                </Button>
                <Button type="button" disabled={busy} onClick={() => void runExport()}>
                    Export
                </Button>
            </DialogFooter>
        </>
    )
}
