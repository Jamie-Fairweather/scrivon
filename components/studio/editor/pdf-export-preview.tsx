'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PdfPreviewOptions } from '@/lib/markdown/export-pdf-preview'
import { createPdfPreviewStore } from '@/lib/markdown/pdf-preview-store'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { cn } from '@/lib/utils'

/** How long after the last change the preview is made again. */
export const PREVIEW_DELAY_MS = 800

/** Loaded with the first preview, like the export code, so it isn't part of every launch. */
const loadPreview = () => import('@/lib/markdown/export-pdf-preview')

type PdfExportPreviewProps = {
    source: string
    tabName: string | undefined
    profile: PdfExportProfile
    title: string
    subtitle: string
    author: string
    date: string
    allowRemoteImages: boolean
    className?: string
}

/**
 * The PDF the export would save, page numbers included, made again shortly after the
 * profile or the title fields change. Windows app only: it prints through the same code.
 */
export function PdfExportPreview({ source, tabName, profile, title, subtitle, author, date, allowRemoteImages, className }: PdfExportPreviewProps) {
    const [store] = useState(() => createPdfPreviewStore(PREVIEW_DELAY_MS))
    const { url, pageNumberWarning, updating, error } = useSyncExternalStore(store.subscribe, store.getState, store.getState)
    // Settings can hand over a fresh profile object with the same values; only a real change counts.
    const profileKey = JSON.stringify(profile)

    useEffect(() => {
        const options: PdfPreviewOptions = {
            profile: JSON.parse(profileKey) as PdfExportProfile,
            overrides: { title, subtitle, author, date },
            allowRemoteImages,
        }
        store.request(async () => (await loadPreview()).previewMarkdownPdf(source, tabName, options))
    }, [store, source, tabName, profileKey, title, subtitle, author, date, allowRemoteImages])

    useEffect(() => () => store.clear(), [store])

    return (
        <section aria-label="PDF preview" data-slot="pdf-preview" className={cn('flex min-h-0 min-w-0 flex-col gap-2', className)}>
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">Preview</h3>
                <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
                    {updating ? 'Updating…' : ''}
                </p>
            </div>
            {pageNumberWarning ? <p className="text-xs text-warning-foreground">{pageNumberWarning}</p> : null}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted">
                {url ? (
                    // The PDF opens without its page list, which leaves too little room for the page.
                    <iframe title="PDF preview" src={`${url}#navpanes=0`} className={cn('size-full transition-opacity', updating && 'opacity-60')} />
                ) : (
                    <p className="flex size-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                        {error ? `Preview failed: ${error}` : 'Making the preview…'}
                    </p>
                )}
            </div>
        </section>
    )
}
