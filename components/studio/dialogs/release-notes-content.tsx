'use client'

import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'

const markdownComponents: Components = {
    h2: ({ children }) => <h3 className="mb-2 text-sm font-semibold text-foreground">{children}</h3>,
    h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</h4>,
    p: ({ children }) => <p className="mb-2 text-sm text-muted-foreground">{children}</p>,
    ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 ps-4 text-sm text-muted-foreground">{children}</ul>,
    li: ({ children }) => <li className="break-words">{children}</li>,
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
            <ReactMarkdown components={markdownComponents}>{notes}</ReactMarkdown>
        </div>
    )
}
