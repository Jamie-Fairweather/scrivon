'use client'

import { useEffect, useRef, useState } from 'react'
import { sameOutline, type OutlineHeading } from '@/lib/markdown/document-outline'
import { createOutlineReader, type OutlineReader } from '@/lib/markdown/outline-reader'

/**
 * The headings of a Markdown document, read off the UI thread as it changes (see createOutlineReader). `key`
 * names the document. Null while there is no document, and while a document's first read is still running, so
 * another document's headings never show for it. While typing, the last headings show until the new ones are in.
 */
export function useMarkdownOutline(key: string | null, source: string | null): OutlineHeading[] | null {
    const [result, setResult] = useState<{ key: string; headings: OutlineHeading[] } | null>(null)
    const readerRef = useRef<OutlineReader | null>(null)

    useEffect(() => {
        const reader = createOutlineReader((readKey, headings) =>
            // Kept as it was when nothing changed, so the list isn't drawn again for every keystroke.
            setResult((previous) => (previous?.key === readKey && sameOutline(previous.headings, headings) ? previous : { key: readKey, headings }))
        )
        readerRef.current = reader
        return () => {
            reader.dispose()
            readerRef.current = null
        }
    }, [])

    useEffect(() => {
        if (key !== null && source !== null) readerRef.current?.read(key, source)
    }, [key, source])

    return key !== null && source !== null && result?.key === key ? result.headings : null
}
