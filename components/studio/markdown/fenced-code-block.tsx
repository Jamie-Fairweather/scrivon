'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import type { BundledTheme } from 'shiki'
import { highlightFencedCode, highlightFencedCodeNow, previewCodeTheme } from '@/lib/markdown/shiki-highlighter'
import { cn } from '@/lib/utils'

const HIGHLIGHT_IDLE_MS = 400
const MAX_HIGHLIGHT_CACHE_ENTRIES = 200

const WRAPPER_CLASS =
    'mb-4 overflow-x-auto rounded-lg border border-border bg-muted/40 text-xs [&_code]:font-mono [&_pre]:m-0 [&_pre]:!bg-transparent [&_pre]:p-3'
const PLAIN_PRE_CLASS = 'm-0 bg-transparent p-3'
const PLAIN_CODE_CLASS = 'font-mono text-xs text-foreground'

type FencedCodeBlockProps = {
    code: string
    language?: string
    className?: string
}

type IdleHighlight = {
    code: string
    language?: string
    theme: BundledTheme
    html: string
}

const globalHighlightCache = new Map<string, string>()

function highlightCacheKey(theme: BundledTheme, language: string | undefined, code: string): string {
    return `${theme}\0${language ?? ''}\0${code}`
}

function setBoundedHighlightCache(key: string, html: string): void {
    if (globalHighlightCache.has(key)) {
        globalHighlightCache.delete(key)
    }
    globalHighlightCache.set(key, html)
    if (globalHighlightCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
        const oldest = globalHighlightCache.keys().next().value
        if (oldest !== undefined) globalHighlightCache.delete(oldest)
    }
}

function resolveHighlightHtml(code: string, language: string | undefined, theme: BundledTheme, idleHighlight: IdleHighlight | null): string | null {
    const exact = globalHighlightCache.get(highlightCacheKey(theme, language, code))
    if (exact) return exact

    return isHighlightOf(idleHighlight, code, language, theme) ? idleHighlight.html : null
}

function isHighlightOf(highlight: IdleHighlight | null, code: string, language: string | undefined, theme: BundledTheme): highlight is IdleHighlight {
    return highlight !== null && highlight.code === code && highlight.language === language && highlight.theme === theme
}

function writePlainCode(container: HTMLDivElement, code: string): void {
    if (container.dataset.mode === 'plain') {
        const codeEl = container.querySelector('pre > code')
        if (codeEl && codeEl.textContent !== code) {
            codeEl.textContent = code
        }
        return
    }

    container.dataset.mode = 'plain'
    container.replaceChildren()

    const pre = document.createElement('pre')
    pre.className = PLAIN_PRE_CLASS

    const codeEl = document.createElement('code')
    codeEl.className = PLAIN_CODE_CLASS
    codeEl.textContent = code

    pre.appendChild(codeEl)
    container.appendChild(pre)
}

function writeHighlightedHtml(container: HTMLDivElement, html: string): void {
    if (container.dataset.mode === 'highlight' && container.innerHTML === html) return

    container.dataset.mode = 'highlight'
    container.innerHTML = html
}

export function FencedCodeBlock({ code, language, className }: FencedCodeBlockProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    /** The code the container shows in colour, or null while it shows plain text. */
    const highlightedCodeRef = useRef<string | null>(null)
    /**
     * Colours highlighted on the spot as the block is typed in. They stay with the block until typing pauses, so a
     * burst of keystrokes doesn't push every other block's colours out of the shared cache.
     */
    const nowHighlightRef = useRef<IdleHighlight | null>(null)
    const { themeId, isLight } = useAppTheme()
    const theme = previewCodeTheme(themeId, isLight)
    const [idleHighlight, setIdleHighlight] = useState<IdleHighlight | null>(() => {
        const html = globalHighlightCache.get(highlightCacheKey(theme, language, code))
        return html ? { code, language, theme, html } : null
    })

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) return

        let html = resolveHighlightHtml(code, language, theme, idleHighlight)
        if (!html) {
            // Highlighted on the spot when Shiki is ready for it, so the block keeps its colours while typed in.
            html = highlightFencedCodeNow(code, language, theme)
            if (html) nowHighlightRef.current = { code, language, theme, html }
        }
        if (html) {
            writeHighlightedHtml(container, html)
            highlightedCodeRef.current = code
        } else if (highlightedCodeRef.current !== code) {
            // New code that can't be coloured yet shows as plain text, rather than the old code staying on screen.
            writePlainCode(container, code)
            highlightedCodeRef.current = null
        }
        // Otherwise the same code stays in its old colours (another theme or language) until the new ones are ready.
    }, [code, language, theme, idleHighlight])

    useEffect(() => {
        const key = highlightCacheKey(theme, language, code)
        if (globalHighlightCache.has(key)) {
            return
        }

        const now = nowHighlightRef.current
        if (isHighlightOf(now, code, language, theme)) {
            // Already in colour: shared once typing pauses.
            const timer = window.setTimeout(() => setBoundedHighlightCache(key, now.html), HIGHLIGHT_IDLE_MS)
            return () => window.clearTimeout(timer)
        }

        let cancelled = false
        // Typing waits for a pause. The same code already in colour (only the theme or language changed) doesn't.
        const delay = highlightedCodeRef.current === code ? 0 : HIGHLIGHT_IDLE_MS
        const timer = window.setTimeout(() => {
            void highlightFencedCode(code, language, theme)
                .then((html) => {
                    if (cancelled) return
                    setBoundedHighlightCache(key, html)
                    setIdleHighlight({ code, language, theme, html })
                })
                .catch(() => {
                    if (!cancelled) setIdleHighlight(null)
                })
        }, delay)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [code, language, theme])

    return <div ref={containerRef} className={cn(WRAPPER_CLASS, className)} />
}
