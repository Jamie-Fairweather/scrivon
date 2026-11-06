'use client'

import { useMemo, type ComponentProps, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { nextFencedCodeBlockOrdinal, nextMermaidBlockOrdinal, resetMarkdownBlockOrdinals } from '@/components/studio/markdown/markdown-block-ordinals'
import type { Element } from 'hast'
import type { Root } from 'mdast'
import type { Components, ExtraProps } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { EmbeddedMermaidBlock } from '@/components/studio/markdown/embedded-mermaid-block'
import { FencedCodeBlock } from '@/components/studio/markdown/fenced-code-block'
import { markdownUrlTransform } from '@/components/studio/markdown/markdown-links'
import { markdownPreviewBody } from '@/components/studio/markdown/markdown-preview-body'
import { collectPdfExportOutline } from '@/lib/markdown/export-outline'
import { inlineLinkClassName } from '@/lib/ui/link-classes'
import { cn } from '@/lib/utils'

type MarkdownPreviewProps = {
    source: string
    tabId: string | null
    onExpandBlock: (blockId: string, ordinal: number, source: string) => void
    /** Called with the link's href when a link is clicked. The webview's own navigation is always prevented. */
    onLinkClick: (href: string) => void
    className?: string
}

type CodeComponentProps = ComponentProps<'code'> & {
    node?: Element
}

function extractText(children: ReactNode): string {
    if (typeof children === 'string') return children
    if (Array.isArray(children)) return children.map(extractText).join('')
    return String(children ?? '')
}

/** Gives headings the same ids PDF and Word export use, so `#section` links have something to jump to. */
function remarkHeadingIds() {
    return (tree: Root) => {
        collectPdfExportOutline(tree)
    }
}

const remarkPlugins = [remarkGfm, remarkHeadingIds]

/** Drops react-markdown's `node` prop so everything else (ids, classes, aria and data attributes) reaches the element. */
function withoutNode<P extends ExtraProps>(props: P): Omit<P, 'node'> {
    const rest = { ...props }
    delete rest.node
    return rest
}

function hasClass(className: string | undefined, name: string): boolean {
    return className?.split(/\s+/).includes(name) ?? false
}

/** Hides the bullet and moves the checkbox into its place (the list's start padding). */
const TASK_LIST_ITEM_CLASS = 'list-none [&_input]:-ms-5 [&_input]:me-1 [&_input]:align-middle'

type TableCellProps = {
    children?: ReactNode
    node?: { properties?: { align?: string | null } }
}

function cellAlignStyle(align: string | null | undefined): CSSProperties | undefined {
    if (align === 'center' || align === 'right' || align === 'left') return { textAlign: align }
    return undefined
}

export function mermaidBlockId(tabId: string | null, fallbackIndex: number): string {
    return `${tabId ?? 'none'}:${fallbackIndex}:mermaid`
}

function fencedCodeBlockId(tabId: string | null, fallbackIndex: number, lang?: string): string {
    return `${tabId ?? 'none'}:${fallbackIndex}:code${lang ? `:${lang}` : ''}`
}

const staticMarkdownComponents: Components = {
    h1: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h1 {...rest} className={cn('mt-6 mb-4 text-2xl font-semibold tracking-tight text-foreground first:mt-0', className)} />
    },
    h2: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h2 {...rest} className={cn('mt-6 mb-3 text-xl font-semibold text-foreground', className)} />
    },
    h3: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h3 {...rest} className={cn('mt-4 mb-2 text-lg font-semibold text-foreground', className)} />
    },
    h4: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h4 {...rest} className={cn('mt-3 mb-2 text-base font-semibold text-foreground', className)} />
    },
    p: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <p {...rest} className={cn('mb-3 text-sm leading-relaxed text-foreground/90', className)} />
    },
    ul: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <ul {...rest} className={cn('mb-3 list-disc space-y-1 ps-5 text-sm text-foreground/90', className)} />
    },
    // `start` comes through, so a list that resumes at 3 is numbered from 3.
    ol: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <ol {...rest} className={cn('mb-3 list-decimal space-y-1 ps-5 text-sm text-foreground/90', className)} />
    },
    li: (props) => {
        const { className, ...rest } = withoutNode(props)
        // A task item shows its checkbox where the bullet would be, not as well as it.
        return <li {...rest} className={cn('break-words', hasClass(className, 'task-list-item') && TASK_LIST_ITEM_CLASS, className)} />
    },
    blockquote: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <blockquote {...rest} className={cn('mb-3 border-l-2 border-border ps-4 text-sm text-muted-foreground italic', className)} />
    },
    hr: () => <hr className="my-6 border-border" />,
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
}

export function MarkdownPreview({ source, tabId, onExpandBlock, onLinkClick, className }: MarkdownPreviewProps) {
    resetMarkdownBlockOrdinals()

    const components = useMemo((): Components => {
        return {
            ...staticMarkdownComponents,
            a(props) {
                const { className: linkClassName, href, ...rest } = withoutNode(props)
                const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    // Routed by the app: left to the webview, relative and #anchor links would open
                    // a dead http://tauri.localhost page in the system browser.
                    event.preventDefault()
                    if (href) onLinkClick(href)
                }
                return <a {...rest} href={href} onClick={onClick} className={cn(inlineLinkClassName, linkClassName)} />
            },
            code(props: CodeComponentProps) {
                const { className: codeClassName, children } = props
                const match = /language-([^\s]+)/i.exec(codeClassName ?? '')
                const lang = match?.[1]?.toLowerCase()
                const text = extractText(children)
                const isBlock = lang === 'mermaid' || text.includes('\n')

                if (lang === 'mermaid' && isBlock) {
                    const ordinal = nextMermaidBlockOrdinal()
                    const blockId = mermaidBlockId(tabId, ordinal)
                    return (
                        <EmbeddedMermaidBlock
                            key={blockId}
                            blockId={blockId}
                            ordinal={ordinal}
                            source={text.replace(/\n$/, '')}
                            tabId={tabId}
                            onExpand={onExpandBlock}
                        />
                    )
                }

                if (!isBlock) {
                    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
                }

                const blockId = fencedCodeBlockId(tabId, nextFencedCodeBlockOrdinal(), lang)
                return <FencedCodeBlock key={blockId} blockId={blockId} code={text.replace(/\n$/, '')} language={lang} />
            },
        }
    }, [onExpandBlock, onLinkClick, tabId])

    const body = useMemo(() => markdownPreviewBody(source), [source])

    return (
        <div className={cn('flex min-h-full justify-center px-6 py-8', className)}>
            <article className="w-full max-w-3xl min-w-0">
                <ReactMarkdown remarkPlugins={remarkPlugins} components={components} urlTransform={markdownUrlTransform}>
                    {body}
                </ReactMarkdown>
            </article>
        </div>
    )
}
