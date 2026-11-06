'use client'

import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

const remarkPlugins = [remarkGfm]

const versionHeadingClass = 'mt-4 mb-2 text-sm font-semibold text-foreground first:mt-0'

const markdownComponents: Components = {
    h1: ({ children }) => <h3 className={versionHeadingClass}>{children}</h3>,
    h2: ({ children }) => <h3 className={versionHeadingClass}>{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h4>,
    p: ({ children }) => <p className="mb-2 text-sm text-muted-foreground">{children}</p>,
    ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 ps-4 text-sm text-muted-foreground">{children}</ul>,
    ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 ps-4 text-sm text-muted-foreground">{children}</ol>,
    li: ({ children }) => <li className="break-words">{children}</li>,
    blockquote: ({ children }) => <blockquote className="mb-2 border-l-2 border-border ps-3 text-sm text-muted-foreground">{children}</blockquote>,
    code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground">{children}</code>,
    pre: ({ children }) => (
        <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]">
            {children}
        </pre>
    ),
    table: ({ children }) => (
        <div className="mb-2 overflow-x-auto rounded-md border">
            <table className="w-full border-collapse text-xs text-muted-foreground">{children}</table>
        </div>
    ),
    th: ({ children }) => <th className="border-b px-2 py-1 text-start font-medium text-foreground">{children}</th>,
    td: ({ children }) => <td className="border-t px-2 py-1">{children}</td>,
    a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-4 hover:underline">
            {children}
        </a>
    ),
}

type ReleaseNotesContentProps = {
    notes: string
    className?: string
}

export function ReleaseNotesContent({ notes, className }: ReleaseNotesContentProps) {
    return (
        <div className={cn('min-w-0 text-sm break-words', className)}>
            <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                {notes}
            </ReactMarkdown>
        </div>
    )
}
