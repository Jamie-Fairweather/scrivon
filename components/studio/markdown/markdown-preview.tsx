'use client'

import { createContext, memo, useContext, useEffect, useMemo, type ComponentProps, type MouseEvent } from 'react'
import type { Element } from 'hast'
import { ImageOff } from 'lucide-react'
import type { Root } from 'mdast'
import type { Components, ExtraProps } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import type { PluggableList } from 'unified'
import { EmbeddedMermaidBlock } from '@/components/studio/markdown/embedded-mermaid-block'
import { FencedCodeBlock } from '@/components/studio/markdown/fenced-code-block'
import {
    codeBlockText,
    fencedCodeBlockOrdinal,
    mermaidBlockKey,
    mermaidBlockOrdinal,
    mermaidBlockText,
    rehypeFencedBlockOrdinals,
    rehypeMermaidBlockIds,
} from '@/components/studio/markdown/markdown-block-ordinals'
import { markdownUrlTransform } from '@/components/studio/markdown/markdown-links'
import { markdownBodyFirstLine, markdownPreviewBody, markdownPreviewLang } from '@/components/studio/markdown/markdown-preview-body'
import { rehypeSourceLines, sourceLineProps } from '@/components/studio/markdown/source-lines'
import { collectPdfExportOutline } from '@/lib/markdown/export-outline'
import { previewHtmlPlugins, previewRemarkRehypeOptions } from '@/lib/markdown/html-sanitize-schema'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'
import { blockDirection } from '@/lib/markdown/text-direction'
import { isWebImageUrl } from '@/lib/markdown/web-images'
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

/**
 * Gives headings the same ids PDF and Word export use, so `#section` links have something to jump to. In the
 * preview the sanitizer then adds GitHub's `user-content-` prefix (see previewSanitizeSchema).
 */
function remarkHeadingIds() {
    return (tree: Root) => {
        collectPdfExportOutline(tree)
    }
}

const remarkPlugins: PluggableList = [...markdownRemarkPlugins, remarkHeadingIds]

/** Drops react-markdown's `node` prop so everything else (ids, classes, aria and data attributes) reaches the element. */
function withoutNode<P extends ExtraProps>(props: P): Omit<P, 'node'> {
    const rest = { ...props }
    delete rest.node
    return rest
}

function hasClass(className: string | undefined, name: string): boolean {
    return className?.split(/\s+/).includes(name) ?? false
}

/** Hides the bullet and moves the checkbox into its place (the item's start margin). */
const TASK_LIST_ITEM_CLASS = 'list-none [&_input]:-ms-5 [&_input]:me-1 [&_input]:align-middle'

/** Whether loading this image would contact another site. Without a page to read it against, assume so. */
function isRemoteImage(src: unknown): src is string {
    if (typeof src !== 'string') return false
    return typeof document === 'undefined' || isWebImageUrl(src, document.baseURI)
}

type BlockedRemoteImageProps = {
    src: string
    alt?: string
    onBlocked: () => () => void
}

/** Stands in for a web image, so opening a document doesn't tell the image's site that it was opened. */
function BlockedRemoteImage({ src, alt, onBlocked }: BlockedRemoteImageProps) {
    useEffect(() => onBlocked(), [onBlocked])
    const ownAlt = alt?.trim()
    const label = ownAlt || 'Image'
    return (
        <span
            role="img"
            // All Scrivon's English words when the image has no alt text, so a screen reader reads them in an English
            // voice inside a document in another language; with the document's own alt text, the document's language.
            lang={ownAlt ? undefined : 'en'}
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

type RemoteImages = {
    /** Whether web images are shown. */
    load: boolean
    onBlocked: () => () => void
}

const RemoteImagesContext = createContext<RemoteImages>({ load: false, onBlocked: () => () => {} })

/** An `<img height>` as a CSS length: `80` or `80px` in pixels, `50%` as written, or undefined for anything else. */
function imageHeightLength(height: unknown): string | undefined {
    if (typeof height === 'number') return Number.isFinite(height) && height >= 0 ? `${height}px` : undefined
    if (typeof height !== 'string') return undefined
    const value = height.trim()
    if (/^\d+(\.\d+)?(px)?$/i.test(value)) return `${parseFloat(value)}px`
    return /^\d+(\.\d+)?%$/.test(value) ? value : undefined
}

/**
 * A document's image. It reads the web-image choice from context rather than props, so the preview's components
 * stay the same when the choice changes, and diagrams and code blocks aren't rebuilt.
 */
function PreviewImage(props: ComponentProps<'img'> & ExtraProps) {
    const { load, onBlocked } = useContext(RemoteImagesContext)
    const { src, alt, ...rest } = withoutNode(props)
    const remote = isRemoteImage(src)
    if (remote && !load) return <BlockedRemoteImage src={src} alt={alt} onBlocked={onBlocked} />
    // Tailwind's base styles give every image `height: auto`, which beats an HTML height attribute, so a logo sized
    // only by its height would show at full size. Only an inline style outranks it; the width then follows the
    // picture's shape. (The sanitizer drops a document's own style attributes.)
    const hasWidth = rest.width !== undefined && rest.width !== null && rest.width !== ''
    const height = hasWidth ? undefined : imageHeightLength(rest.height)
    // Inline, so a row of badges stays on one line, and never wider than the page.
    return (
        // eslint-disable-next-line @next/next/no-img-element -- a document's own images, in a static export
        <img
            {...rest}
            src={src}
            alt={alt}
            referrerPolicy={remote ? 'no-referrer' : undefined}
            style={height ? { ...rest.style, height, width: 'auto' } : rest.style}
            className={cn('inline-block h-auto max-w-full align-middle', height && 'object-contain', rest.className)}
        />
    )
}

/** A diagram's block id: its tab, and the lasting id rehypeMermaidBlockIds gave it, which moves with the block. */
function mermaidBlockId(tabId: string | null, key: string): string {
    return `${tabId ?? 'none'}:${key}:mermaid`
}

function fencedCodeBlockId(tabId: string | null, fallbackIndex: number, lang?: string): string {
    return `${tabId ?? 'none'}:${fallbackIndex}:code${lang ? `:${lang}` : ''}`
}

/**
 * Text blocks take their direction from their own first letters (dir="auto", before any dir the HTML sets), so an
 * Arabic or Hebrew paragraph reads right to left with its full stop and bullet on the correct side.
 */
const staticMarkdownComponents: Components = {
    h1: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h1 dir="auto" {...rest} className={cn('mt-6 mb-4 text-2xl font-semibold tracking-tight text-foreground first:mt-0', className)} />
    },
    h2: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h2 dir="auto" {...rest} className={cn('mt-6 mb-3 text-xl font-semibold text-foreground', className)} />
    },
    h3: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h3 dir="auto" {...rest} className={cn('mt-4 mb-2 text-lg font-semibold text-foreground', className)} />
    },
    h4: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h4 dir="auto" {...rest} className={cn('mt-3 mb-2 text-base font-semibold text-foreground', className)} />
    },
    h5: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h5 dir="auto" {...rest} className={cn('mt-3 mb-2 text-sm font-semibold text-foreground', className)} />
    },
    h6: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <h6 dir="auto" {...rest} className={cn('mt-3 mb-2 text-xs font-semibold text-muted-foreground', className)} />
    },
    p: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <p dir="auto" {...rest} className={cn('mb-3 text-sm leading-relaxed text-foreground/90', className)} />
    },
    ul: (props) => {
        const { className, ...rest } = withoutNode(props)
        // Disc, then circle inside one list, then square inside two, counting numbered lists too, as the PDF (the
        // browser's own rule) and Word show them. The ancestor selectors outrank the list's own list-disc.
        return (
            <ul
                {...rest}
                className={cn(
                    'mb-3 list-disc space-y-1 text-sm text-foreground/90 [:is(ul,ol)_&]:list-[circle] [:is(ul,ol)_:is(ul,ol)_&]:list-[square]',
                    className
                )}
            />
        )
    },
    // `start` comes through, so a list that resumes at 3 is numbered from 3.
    ol: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <ol {...rest} className={cn('mb-3 list-decimal space-y-1 text-sm text-foreground/90', className)} />
    },
    // The indent is on each item, not the list: the list has no direction of its own, so its start side is always
    // the left, and a Hebrew or Arabic item's bullet would hang past the right edge. A task item shows its checkbox
    // where the bullet would be, not as well as it.
    li: (props) => {
        const { className, ...rest } = withoutNode(props)
        return (
            <li
                dir={props.node ? blockDirection(props.node) : 'auto'}
                {...rest}
                className={cn('ms-5 break-words', hasClass(className, 'task-list-item') && TASK_LIST_ITEM_CLASS, className)}
            />
        )
    },
    blockquote: (props) => {
        const { className, ...rest } = withoutNode(props)
        return (
            <blockquote
                dir={props.node ? blockDirection(props.node) : 'auto'}
                {...rest}
                className={cn('mb-3 border-s-2 border-border ps-4 text-sm text-muted-foreground italic', className)}
            />
        )
    },
    hr: (props) => <hr {...sourceLineProps(props)} className="my-6 border-border" />,
    // Raw HTML the sanitizer lets through (see previewSanitizeSchema).
    kbd: (props) => {
        const { className, ...rest } = withoutNode(props)
        return (
            <kbd {...rest} className={cn('rounded border border-border bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground', className)} />
        )
    },
    details: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <details {...rest} className={cn('mb-3 rounded-md border border-border px-3 py-2 text-sm text-foreground/90', className)} />
    },
    summary: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <summary {...rest} className={cn('cursor-pointer font-medium text-foreground', className)} />
    },
    table: (props) => (
        <div {...sourceLineProps(props)} className="mb-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">{props.children}</table>
        </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/40">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
    tr: (props) => (
        <tr {...sourceLineProps(props)} className="border-border">
            {props.children}
        </tr>
    ),
    // A raw-HTML table's colspan, rowspan and dir reach the cell. A column's alignment arrives as its text-align style.
    th: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <th dir="auto" {...rest} className={cn('px-3 py-2 font-medium text-foreground', className)} />
    },
    td: (props) => {
        const { className, ...rest } = withoutNode(props)
        return <td dir="auto" {...rest} className={cn('px-3 py-2 text-foreground/90', className)} />
    },
    pre: (props) => {
        const { className, ...rest } = withoutNode(props)
        const first = props.node?.children[0]
        // A fenced block draws its own frame (the code override), so its <pre> adds only its source line, on a box
        // with no size or spacing of its own.
        if (first?.type === 'element' && (mermaidBlockOrdinal(first) !== null || fencedCodeBlockOrdinal(first) !== null)) {
            return <div {...sourceLineProps(rest)}>{rest.children}</div>
        }
        // A raw-HTML <pre> of plain text, such as ASCII art, keeps its spaces and line breaks, and reads left to
        // right unless the document says otherwise.
        return (
            <pre
                dir="ltr"
                {...rest}
                className={cn('mb-3 overflow-x-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre', className)}
            />
        )
    },
    img: PreviewImage,
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
            code(props: CodeComponentProps) {
                const { className: codeClassName, children, node } = props
                // Numbered on the syntax tree (rehypeFencedBlockOrdinals): every fenced block, even an empty one, has
                // a number and inline code has none. Counting here would go wrong when React renders a block twice.
                const ordinal = mermaidBlockOrdinal(node)

                if (node && ordinal !== null) {
                    // Keyed by an id that stays with the block, not its position, so a block never shows the picture
                    // of the one that was in its place before a block above it was added or removed.
                    const blockId = mermaidBlockId(tabId, mermaidBlockKey(node) ?? `at-${ordinal}`)
                    return (
                        <EmbeddedMermaidBlock
                            key={blockId}
                            blockId={blockId}
                            ordinal={ordinal}
                            source={mermaidBlockText(node)}
                            tabId={tabId}
                            onExpand={onExpandBlock}
                        />
                    )
                }

                const codeOrdinal = fencedCodeBlockOrdinal(node)
                if (!node || codeOrdinal === null) {
                    return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
                }

                const lang = codeLanguage(codeClassName)
                const blockId = fencedCodeBlockId(tabId, codeOrdinal, lang)
                return <FencedCodeBlock key={blockId} code={codeBlockText(node)} language={lang} />
            },
        }
    }, [onExpandBlock, onLinkClick, tabId])

    const body = useMemo(() => markdownPreviewBody(source), [source])
    const firstLine = useMemo(() => markdownBodyFirstLine(source, body), [source, body])
    // Tagged as the PDF is, so shared Han characters take the document's own glyph shapes (Japanese ones under ja).
    const lang = useMemo(() => markdownPreviewLang(source), [source])
    // Safe raw HTML first, then the numbering and source lines, so the sanitizer can't strip the blocks' data
    // properties. Per document, so each block's id is matched against the blocks this document showed last time.
    const rehypePlugins = useMemo(
        (): PluggableList => [...previewHtmlPlugins, rehypeFencedBlockOrdinals, rehypeMermaidBlockIds(tabId ?? ''), rehypeSourceLines(firstLine)],
        [tabId, firstLine]
    )

    // Kept as one element so that loading web images (a context change) redraws only the images, without parsing
    // the document again.
    const markdown = useMemo(
        () => (
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                remarkRehypeOptions={previewRemarkRehypeOptions}
                rehypePlugins={rehypePlugins}
                components={components}
                urlTransform={markdownUrlTransform}
            >
                {body}
            </ReactMarkdown>
        ),
        [body, components, rehypePlugins]
    )

    const remoteImages = useMemo(() => ({ load: loadRemoteImages, onBlocked: onRemoteImageBlocked }), [loadRemoteImages, onRemoteImageBlocked])

    return (
        <div className={cn('flex min-h-full justify-center px-6 py-8', className)}>
            {/* break-words: a long URL or path wraps instead of making the whole preview scroll sideways. */}
            <article lang={lang} className="w-full max-w-3xl min-w-0 break-words">
                <RemoteImagesContext.Provider value={remoteImages}>{markdown}</RemoteImagesContext.Provider>
            </article>
        </div>
    )
})
