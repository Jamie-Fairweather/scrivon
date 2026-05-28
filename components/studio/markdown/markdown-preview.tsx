'use client'

import { useMemo, useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import type { Components } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { EmbeddedMermaidBlock } from '@/components/studio/markdown/embedded-mermaid-block'
import { FencedCodeBlock } from '@/components/studio/markdown/fenced-code-block'
import { cn } from '@/lib/utils'

type MarkdownPreviewProps = {
    source: string
    tabId: string | null
    onExpandBlock: (blockId: string, source: string) => void
    className?: string
}

function extractText(children: ReactNode): string {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(extractText).join('')
    return String(children ?? '')
}

const remarkPlugins = [remarkGfm]

type TableCellProps = {
    children?: ReactNode
    node?: { properties?: { align?: string | null } }
}

function cellAlignStyle(align: string | null | undefined): CSSProperties | undefined {
    if (align === 'center' || align === 'right' || align === 'left') return { textAlign: align }
    return undefined
}

export function MarkdownPreview({ source, tabId, onExpandBlock, className }: MarkdownPreviewProps) {
    const blockIndexRef = useRef(0)

    const components = useMemo((): Components => {
        return {
            h1: ({ children }) => <h1 className="mt-6 mb-4 text-2xl font-semibold tracking-tight text-foreground first:mt-0">{children}</h1>,
            h2: ({ children }) => <h2 className="mt-6 mb-3 text-xl font-semibold text-foreground">{children}</h2>,
            h3: ({ children }) => <h3 className="mt-4 mb-2 text-lg font-semibold text-foreground">{children}</h3>,
            h4: ({ children }) => <h4 className="mt-3 mb-2 text-base font-semibold text-foreground">{children}</h4>,
            p: ({ children }) => <p className="mb-3 text-sm leading-relaxed text-foreground/90">{children}</p>,
            ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 ps-5 text-sm text-foreground/90">{children}</ul>,
            ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 ps-5 text-sm text-foreground/90">{children}</ol>,
            li: ({ children }) => <li className="break-words">{children}</li>,
            blockquote: ({ children }) => (
                <blockquote className="mb-3 border-l-2 border-border ps-4 text-sm text-muted-foreground italic">{children}</blockquote>
            ),
            hr: () => <hr className="my-6 border-border" />,
            a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-4 hover:underline">
                    {children}
                </a>
            ),
            table: ({ children }) => (
                <div className="mb-4 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-sm">{children}</table>
                </div>
            ),
            thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
            tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
            tr: ({ children }) => <tr className="border-border">{children}</tr>,
            th: ({ children, node }: TableCellProps) => (
                <th className="px-3 py-2 font-medium text-foreground" style={cellAlignStyle(node?.properties?.align)}>
                    {children}
                </th>
            ),
            td: ({ children, node }: TableCellProps) => (
                <td className="px-3 py-2 text-foreground/90" style={cellAlignStyle(node?.properties?.align)}>
                    {children}
                </td>
            ),
            pre: ({ children }) => <>{children}</>,
            code(props: ComponentProps<'code'>) {
                const { className: codeClassName, children } = props
                const match = /language-(\w+)/.exec(codeClassName ?? '')
                const lang = match?.[1]
                const text = extractText(children)
                const isBlock = lang === 'mermaid' || text.includes('\n')

                if (lang === 'mermaid' && isBlock) {
                    const blockId = String(blockIndexRef.current++)
                    return <EmbeddedMermaidBlock blockId={blockId} source={text.replace(/\n$/, '')} tabId={tabId} onExpand={onExpandBlock} />
                }

                if (!isBlock) {
                    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
                }

                return <FencedCodeBlock code={text.replace(/\n$/, '')} language={lang} />
            },
        }
    }, [tabId, onExpandBlock])

    blockIndexRef.current = 0

    return (
        <div className={cn('flex min-h-full justify-center px-6 py-8', className)}>
            <article className="w-full max-w-3xl min-w-0">
                <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
                    {source}
                </ReactMarkdown>
            </article>
        </div>
    )
}
