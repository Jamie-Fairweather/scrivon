'use client'

import { memo, useEffect, useMemo, type ComponentProps, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import type { Element } from 'hast'
import { ImageOff } from 'lucide-react'
import type { Root } from 'mdast'
import type { Components, ExtraProps } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { EmbeddedMermaidBlock } from '@/components/studio/markdown/embedded-mermaid-block'
import { FencedCodeBlock } from '@/components/studio/markdown/fenced-code-block'
import { fencedCodeBlockOrdinal, mermaidBlockOrdinal, rehypeFencedBlockOrdinals } from '@/components/studio/markdown/markdown-block-ordinals'
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
    /** Whether images from the web are loaded. When not, each one shows as a placeholder with its alt text. */
    loadRemoteImages: boolean
    /** Called when a blocked web image appears; the function it returns is called when that image goes away. */
    onRemoteImageBlocked: () => () => void
    className?: string
}

type CodeComponentProps = ComponentProps<'code'> & {
    node?: Element
}

/** The fence's language, from react-markdown's `language-*` class, in lower case. */
function codeLanguage(className: string | undefined): string | undefined {
    return /language-([^\s]+)/i.exec(className ?? '')?.[1]?.toLowerCase()
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
const rehypePlugins = [rehypeFencedBlockOrdinals]

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

/** `https://`, `http://` and `//host/` (which the webview fetches over http): loading one contacts another site. */
const REMOTE_IMAGE_URL = /^(?:https?:)?\/\//i

type BlockedRemoteImageProps = {
    src: string
    alt?: string
    onBlocked: () => () => void
}

/** Stands in for a web image, so opening a document doesn't tell the image's site that it was opened. */
function BlockedRemoteImage({ src, alt, onBlocked }: BlockedRemoteImageProps) {
    useEffect(() => onBlocked(), [onBlocked])
    const label = alt?.trim() || 'Image'
    return (
        <span
            role="img"
            aria-label={`Blocked web image: ${label}`}
            title={src}
            className="inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-border px-1.5 py-0.5 align-middle text-xs
                text-muted-foreground"
        >
            <ImageOff className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{label}</span>
        </span>
    )
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
    h5: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h5 {...rest} className={cn('mt-3 mb-2 text-sm font-semibold text-foreground', className)} />
    },
    h6: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h6 {...rest} className={cn('mt-3 mb-2 text-xs font-semibold text-muted-foreground', className)} />
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
    // Each fenced block draws its own frame (the code override), so the <pre> adds nothing.
    pre: ({ children }) => <>{children}</>,
}

/**
 * Every render parses the whole document again, so this is memoised: the parent re-renders on each keystroke
 * (before the preview text catches up), on autosave and while the splitter is dragged, and none of those change
 * what the preview shows. Callers keep the callback props stable.
 */
export const MarkdownPreview = memo(function MarkdownPreview({
    source,
    tabId,
    onExpandBlock,
    onLinkClick,
    loadRemoteImages,
    onRemoteImageBlocked,
    className,
}: MarkdownPreviewProps) {
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
                // A middle click would otherwise open the link in a new webview window inside the app.
                const onAuxClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (event.button !== 1) return
                    onClick(event)
                }
                return <a {...rest} href={href} onClick={onClick} onAuxClick={onAuxClick} className={cn(inlineLinkClassName, linkClassName)} />
            },
            img(props) {
                const { src, alt, ...rest } = withoutNode(props)
                const remote = typeof src === 'string' && REMOTE_IMAGE_URL.test(src)
                if (remote && !loadRemoteImages) return <BlockedRemoteImage src={src} alt={alt} onBlocked={onRemoteImageBlocked} />
                // Inline, so a row of badges stays on one line, and never wider than the page.
                return (
                    // eslint-disable-next-line @next/next/no-img-element -- a document's own images, in a static export
                    <img
                        {...rest}
                        src={src}
                        alt={alt}
                        referrerPolicy={remote ? 'no-referrer' : undefined}
                        className={cn('inline-block h-auto max-w-full align-middle', rest.className)}
                    />
                )
            },
            code(props: CodeComponentProps) {
                const { className: codeClassName, children, node } = props
                const text = extractText(children)
                // Numbered on the syntax tree (rehypeFencedBlockOrdinals): every fenced block, even an empty one, has
                // a number and inline code has none. Counting here would go wrong when React renders a block twice.
                const ordinal = mermaidBlockOrdinal(node)

                if (ordinal !== null) {
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

                const codeOrdinal = fencedCodeBlockOrdinal(node)
                if (codeOrdinal === null) {
                    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
                }

                const lang = codeLanguage(codeClassName)
                const blockId = fencedCodeBlockId(tabId, codeOrdinal, lang)
                return <FencedCodeBlock key={blockId} code={text.replace(/\n$/, '')} language={lang} />
            },
        }
    }, [loadRemoteImages, onExpandBlock, onLinkClick, onRemoteImageBlocked, tabId])

    const body = useMemo(() => markdownPreviewBody(source), [source])

    return (
        <div className={cn('flex min-h-full justify-center px-6 py-8', className)}>
            {/* break-words: a long URL or path wraps instead of making the whole preview scroll sideways. */}
            <article className="w-full max-w-3xl min-w-0 break-words">
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={components}
                    urlTransform={markdownUrlTransform}
                >
                    {body}
                </ReactMarkdown>
            </article>
        </div>
    )
})
