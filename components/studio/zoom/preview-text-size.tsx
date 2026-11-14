'use client'

import { useEffect } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { DEFAULT_PREVIEW_FONT_SIZE } from '@/lib/zoom/preview-text-size'

/**
 * Sets --preview-text-scale on the page for the Markdown preview's text size setting: 1 is the 14px it
 * always had. The preview's text and spacing grow by it (`.preview-text` in app/globals.css).
 */
export function PreviewTextSize() {
    const { previewFontSize } = useAppSettings().settings.appearance

    useEffect(() => {
        document.documentElement.style.setProperty('--preview-text-scale', String(previewFontSize / DEFAULT_PREVIEW_FONT_SIZE))
    }, [previewFontSize])

    return null
}
