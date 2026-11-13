'use client'

import { Check, Copy } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { Button } from '@/components/ui/button'
import type { BundledTheme } from 'shiki'
import { highlightFencedCode, highlightFencedCodeNow, previewCodeTheme } from '@/lib/markdown/shiki-highlighter'
import { notifyError } from '@/lib/notify'
import { overlayButtonClassName } from '@/lib/ui/button-classes'
import { cn } from '@/lib/utils'

const HIGHLIGHT_IDLE_MS = 400
const MAX_HIGHLIGHT_CACHE_ENTRIES = 200
/** Upper bound on the code and colours kept, in characters, so a few huge blocks can't fill memory. */
const MAX_HIGHLIGHT_CACHE_CHARS = 4_000_000

const WRAPPER_CLASS =
    'overflow-x-auto rounded-lg border border-border bg-muted/40 text-xs [&_code]:font-mono [&_pre]:m-0 [&_pre]:!bg-transparent [&_pre]:p-3'
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

/** Highlighted code by its cache key, kept for the session and shared by every block. */
export type HighlightCache = {
    get: (key: string) => string | undefined
    has: (key: string) => boolean
    set: (key: string, html: string) => void
    delete: (key: string) => void
}

/**
 * A cache that drops its oldest entries once it holds more than `maxEntries`, or more than `maxChars` of keys
 * (which hold the code) and HTML together. An entry bigger than that on its own isn't kept at all.
 */
export function createHighlightCache(maxEntries = MAX_HIGHLIGHT_CACHE_ENTRIES, maxChars = MAX_HIGHLIGHT_CACHE_CHARS): HighlightCache {
    const entries = new Map<string, string>()
    let chars = 0

    const remove = (key: string) => {
        const html = entries.get(key)
        if (html === undefined) return
        entries.delete(key)
        chars -= key.length + html.length
    }

    return {
        get: (key) => entries.get(key),
        has: (key) => entries.has(key),
        set(key, html) {
            remove(key)
            const size = key.length + html.length
            if (size > maxChars) return
            entries.set(key, html)
            chars += size
            for (const oldest of entries.keys()) {
                if (entries.size <= maxEntries && chars <= maxChars) break
                remove(oldest)
            }
        },
        delete: remove,
    }
}

const globalHighlightCache = createHighlightCache()

/**
 * How many mounted blocks show each cache key. The same snippet can appear twice, and the preview matches blocks to
 * the document's code blocks by position, so adding or removing one hands the blocks after it their neighbours'
 * code: a block's old entry may still be another block's current one.
 */
const shownKeyCounts = new Map<string, number>()

/** Counts a block as showing `key`; returns the function that stops counting it. */
function showKey(key: string): () => void {
    shownKeyCounts.set(key, (shownKeyCounts.get(key) ?? 0) + 1)
    return () => {
        const count = (shownKeyCounts.get(key) ?? 0) - 1
        if (count > 0) shownKeyCounts.set(key, count)
        else shownKeyCounts.delete(key)
    }
}

function highlightCacheKey(theme: BundledTheme, language: string | undefined, code: string): string {
    return `${theme}\0${language ?? ''}\0${code}`
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
    /** The shared cache's entry for the code the block shows, so its earlier versions don't pile up as it's edited. */
    const claimedRef = useRef<{ key: string; theme: BundledTheme } | null>(null)
    const { themeId, isLight } = useAppTheme()
    const theme = previewCodeTheme(themeId, isLight)
    const cacheKey = highlightCacheKey(theme, language, code)
    const [idleHighlight, setIdleHighlight] = useState<IdleHighlight | null>(() => {
        const html = globalHighlightCache.get(cacheKey)
        return html ? { code, language, theme, html } : null
    })

    // A layout effect, so every block in an update is counted before any of them drops an entry below.
    useLayoutEffect(() => showKey(cacheKey), [cacheKey])

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
        // The block's entry stays when it goes (its tab may be shown again) and when only the theme changes (it may
        // be switched back). It's dropped once the block shows other code, unless another block still shows it.
        const claim = () => {
            const previous = claimedRef.current
            if (previous && previous.key !== cacheKey && previous.theme === theme && !shownKeyCounts.has(previous.key)) {
                globalHighlightCache.delete(previous.key)
            }
            claimedRef.current = { key: cacheKey, theme }
        }
        const remember = (html: string) => {
            claim()
            globalHighlightCache.set(cacheKey, html)
        }

        if (globalHighlightCache.has(cacheKey)) {
            claim()
            return
        }

        const now = nowHighlightRef.current
        if (isHighlightOf(now, code, language, theme)) {
            // Already in colour: shared once typing pauses.
            const timer = window.setTimeout(() => remember(now.html), HIGHLIGHT_IDLE_MS)
            return () => window.clearTimeout(timer)
        }

        let cancelled = false
        // Typing waits for a pause. The same code already in colour (only the theme or language changed) doesn't.
        const delay = highlightedCodeRef.current === code ? 0 : HIGHLIGHT_IDLE_MS
        const timer = window.setTimeout(() => {
            void highlightFencedCode(code, language, theme)
                .then((html) => {
                    if (cancelled) return
                    remember(html)
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
    }, [cacheKey, code, language, theme])

    // Code reads left to right, even in a right-to-left list item or quote.
    return (
        <div dir="ltr" className={cn('group/code relative mb-4', className)}>
            <div ref={containerRef} className={WRAPPER_CLASS} />
            <CodeBlockToolbar code={code} language={language} />
        </div>
    )
}

/** How long the Copy button says "Copied". */
const COPIED_MS = 2000

/** The block's language and a Copy button, in its top corner. They show while the block is pointed at or has focus. */
function CodeBlockToolbar({ code, language }: { code: string; language?: string }) {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<number | undefined>(undefined)
    useEffect(() => () => window.clearTimeout(timerRef.current), [])

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(code)
        } catch (error) {
            notifyError("Couldn't copy the code", error)
            return
        }
        setCopied(true)
        window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => setCopied(false), COPIED_MS)
    }

    // English app text, even in a document in another language, so screen readers read it in the right voice.
    return (
        <div
            lang="en"
            className="absolute top-1.5 right-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-focus-within/code:opacity-100
                group-hover/code:opacity-100"
        >
            {language && (
                <span data-code-language className="rounded-sm bg-background/90 px-1 font-mono text-[11px] text-muted-foreground">
                    {language}
                </span>
            )}
            <Button
                variant="outline"
                size="xs"
                className={overlayButtonClassName}
                aria-label={copied ? 'Copied' : 'Copy code'}
                title={copied ? 'Copied' : 'Copy code'}
                onClick={() => void copy()}
            >
                {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
                {copied ? 'Copied' : 'Copy'}
            </Button>
            {/* Read out by screen readers, which don't always say a button's new name. */}
            <span role="status" className="sr-only">
                {copied ? 'Copied' : ''}
            </span>
        </div>
    )
}
