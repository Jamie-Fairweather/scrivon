'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { highlightFencedCode, type ShikiTheme } from '@/lib/markdown/shiki-highlighter'
import { cn } from '@/lib/utils'

const HIGHLIGHT_IDLE_MS = 400
const MAX_HIGHLIGHT_CACHE_ENTRIES = 200

const WRAPPER_CLASS =
    'mb-4 overflow-x-auto rounded-lg border border-border bg-muted/40 text-xs [&_code]:font-mono [&_pre]:m-0 [&_pre]:!bg-transparent [&_pre]:p-3'
const PLAIN_PRE_CLASS = 'm-0 bg-transparent p-3'
const PLAIN_CODE_CLASS = 'font-mono text-xs text-foreground'

type FencedCodeBlockProps = {
    blockId: string
    code: string
    language?: string
    className?: string
}

type IdleHighlight = {
    code: string
    language?: string
    theme: ShikiTheme
    html: string
}

type BlockDisplay = {
    mode: 'plain' | 'highlight'
    code: string
    language?: string
    theme: ShikiTheme
    html?: string
}

const globalHighlightCache = new Map<string, string>()
const blockDisplayCache = new Map<string, BlockDisplay>()
const containerByBlockId = new Map<string, HTMLDivElement>()

function highlightCacheKey(theme: ShikiTheme, language: string | undefined, code: string): string {
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

function resolveHighlightHtml(code: string, language: string | undefined, theme: ShikiTheme, idleHighlight: IdleHighlight | null): string | null {
    const exact = globalHighlightCache.get(highlightCacheKey(theme, language, code))
    if (exact) return exact

    if (idleHighlight && idleHighlight.code === code && idleHighlight.language === language && idleHighlight.theme === theme) {
        return idleHighlight.html
    }

    return null
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

export function clearFencedCodeBlockContainers(): void {
    containerByBlockId.clear()
    blockDisplayCache.clear()
}

export function FencedCodeBlock({ blockId, code, language, className }: FencedCodeBlockProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const { isLight } = useAppTheme()
    const theme: ShikiTheme = isLight ? 'github-light' : 'github-dark'
    const [idleHighlight, setIdleHighlight] = useState<IdleHighlight | null>(() => {
        const html = globalHighlightCache.get(highlightCacheKey(theme, language, code))
        return html ? { code, language, theme, html } : null
    })

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) return

        containerByBlockId.set(blockId, container)

        const html = resolveHighlightHtml(code, language, theme, idleHighlight)
        if (html) {
            writeHighlightedHtml(container, html)
            blockDisplayCache.set(blockId, { mode: 'highlight', code, language, theme, html })
        } else {
            writePlainCode(container, code)
            blockDisplayCache.set(blockId, { mode: 'plain', code, language, theme })
        }

        return () => {
            containerByBlockId.delete(blockId)
            blockDisplayCache.delete(blockId)
        }
    }, [blockId, code, language, theme, idleHighlight])

    useEffect(() => {
        if (globalHighlightCache.has(highlightCacheKey(theme, language, code))) {
            return
        }

        let cancelled = false
        const timer = window.setTimeout(() => {
            void highlightFencedCode(code, language, theme)
                .then((html) => {
                    if (cancelled) return
                    setBoundedHighlightCache(highlightCacheKey(theme, language, code), html)
                    setIdleHighlight({ code, language, theme, html })
                })
                .catch(() => {
                    if (!cancelled) setIdleHighlight(null)
                })
        }, HIGHLIGHT_IDLE_MS)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [blockId, code, language, theme])

    return <div ref={containerRef} className={cn(WRAPPER_CLASS, className)} />
}
