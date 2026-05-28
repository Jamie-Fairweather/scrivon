'use client'

import { useEffect, useState } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { highlightFencedCode } from '@/lib/markdown/shiki-highlighter'
import { cn } from '@/lib/utils'

type FencedCodeBlockProps = {
    code: string
    language?: string
    className?: string
}

type HighlightResult = {
    code: string
    language?: string
    theme: 'github-light' | 'github-dark'
    html: string
}

export function FencedCodeBlock({ code, language, className }: FencedCodeBlockProps) {
    const { isLight } = useAppTheme()
    const theme = isLight ? 'github-light' : 'github-dark'
    const [result, setResult] = useState<HighlightResult | null>(null)

    const html = result && result.code === code && result.language === language && result.theme === theme ? result.html : null

    useEffect(() => {
        let cancelled = false

        void highlightFencedCode(code, language, theme)
            .then((next) => {
                if (!cancelled) setResult({ code, language, theme, html: next })
            })
            .catch(() => {
                if (!cancelled) setResult(null)
            })

        return () => {
            cancelled = true
        }
    }, [code, language, theme])

    if (!html) {
        return (
            <pre className={cn('mb-4 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3', className)}>
                <code className="font-mono text-xs text-foreground">{code}</code>
            </pre>
        )
    }

    return (
        <div
            className={cn(
                `mb-4 overflow-x-auto rounded-lg border border-border bg-muted/40 text-xs [&_code]:font-mono [&_pre]:m-0 [&_pre]:!bg-transparent
                [&_pre]:p-3`,
                className
            )}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    )
}
