import type { Element, Root as HastRoot } from 'hast'
import { toHtml } from 'hast-util-to-html'
import { invoke } from '@tauri-apps/api/core'
import type { Definition, Html, Image, ImageReference, Parent, PhrasingContent, Root, Text } from 'mdast'
import rehypeRaw from 'rehype-raw'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { decode, type MarkdownLinkContext } from '@/components/studio/markdown/markdown-links'
import type { PdfExportMissingImage } from '@/lib/markdown/export-assets'
import { isExportWebImageUrl, webImageAddress } from '@/lib/markdown/web-images'
import { errorMessage } from '@/lib/notify'
import { createLimit } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { readWorkspaceImage, resolveDocumentImage } from '@/lib/workspace/workspace-images'

export type DocumentImageOptions = MarkdownLinkContext & {
    /** The user chose to load this document's web images in the preview, so the export embeds them too. */
    allowRemoteImages: boolean
}

/** What became of an image's address: the picture to embed, or why it can't be. */
type Embedded = { dataUrl: string } | { reason: string }

/** A picture in the document: its address as written, and how to put the outcome in its place. */
type ImageSite = { src: string; apply: (outcome: Embedded) => void }

/** Web images downloaded at once, so a document full of badges doesn't open dozens of connections together. */
const MAX_PARALLEL_DOWNLOADS = 4
const downloadLimit = createLimit(MAX_PARALLEL_DOWNLOADS)

/** Downloads a web image through the app, which can reach any site (the page itself may only talk to the app). */
async function downloadWebImage(src: string): Promise<Embedded> {
    let url: string
    try {
        url = webImageAddress(src)
    } catch {
        return { reason: 'This web address isn’t valid.' }
    }
    try {
        return { dataUrl: await downloadLimit(() => invoke<string>('fetch_export_image', { url })) }
    } catch (err) {
        return { reason: errorMessage(err, 'Couldn’t download the image.') }
    }
}

/**
 * The picture for `src`, or null to leave it as written: an inline `data:` picture, or a web image the user hasn't
 * loaded (each export then leaves it out, as the preview does) or one outside the desktop app.
 */
async function embed(src: string, options: DocumentImageOptions): Promise<Embedded | null> {
    if (isExportWebImageUrl(src)) return options.allowRemoteImages && isTauri() ? downloadWebImage(src) : null
    const source = resolveDocumentImage(src, options)
    if (source.kind === 'blocked') return { reason: source.reason }
    if (source.kind === 'url') return null
    try {
        return { dataUrl: await readWorkspaceImage(source.path, options.workspaceRoot!) }
    } catch (err) {
        return { reason: errorMessage(err, 'Couldn’t read the image.') }
    }
}

/** What prints in place of a picture that couldn't be embedded, as for a web image the user didn't load. */
function altText(alt: string | null | undefined): Text {
    return { type: 'text', value: alt?.trim() || '[image]' }
}

/** Reads raw HTML the way the PDF and Word exports do, so an `<img>`'s address comes out as they see it. */
const htmlParser = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).freeze()

/** An `<img>` tag, quoted attributes and all, or a comment, whose pictures never show. */
const IMG_TAG_OR_COMMENT = /<!--[\s\S]*?(?:-->|$)|<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi

/**
 * The pictures in a piece of raw HTML. Each `<img>` that is embedded is written again with the picture as its
 * `src`; one that can't be loses its `src`, so its alt text shows instead, as for a Markdown picture.
 */
function htmlImageSites(node: Html): ImageSite[] {
    const html = node.value
    if (!/<img\b/i.test(html)) return []
    // The HTML split at each picture's tag, so one can be written again without moving the others.
    const parts: string[] = []
    const sites: ImageSite[] = []
    let end = 0
    for (const match of html.matchAll(IMG_TAG_OR_COMMENT)) {
        if (match[0].startsWith('<!--')) continue
        const parsed = htmlParser.runSync({ type: 'root', children: [{ type: 'html', value: match[0] }] }) as HastRoot
        const img = parsed.children.find((child): child is Element => child.type === 'element' && child.tagName === 'img')
        const src = img?.properties.src
        if (!img || typeof src !== 'string') continue
        parts.push(html.slice(end, match.index))
        const at = parts.push(match[0]) - 1
        end = match.index + match[0].length
        sites.push({
            src,
            apply: (outcome) => {
                if ('dataUrl' in outcome) img.properties.src = outcome.dataUrl
                else delete img.properties.src
                parts[at] = toHtml(img)
                node.value = parts.join('')
            },
        })
    }
    parts.push(html.slice(end))
    return sites
}

/** Each picture in the document: Markdown images, `![alt][ref]` with its definition's address, and raw HTML `<img>`. */
function imageSites(tree: Root): ImageSite[] {
    const definitions = new Map<string, Definition>()
    // When a label is defined twice the first one counts, as in CommonMark.
    visit(tree, 'definition', (node: Definition) => {
        if (!definitions.has(node.identifier)) definitions.set(node.identifier, node)
    })
    const sites: ImageSite[] = []
    visit(tree, (node, index, parent: Parent | undefined) => {
        if (node.type === 'html') sites.push(...htmlImageSites(node as Html))
        if (!parent || index === undefined) return
        const put = (child: PhrasingContent) => {
            parent.children[index] = child
        }
        if (node.type === 'image') {
            const image = node as Image
            sites.push({ src: image.url, apply: (outcome) => ('dataUrl' in outcome ? (image.url = outcome.dataUrl) : put(altText(image.alt))) })
        } else if (node.type === 'imageReference') {
            const reference = node as ImageReference
            const definition = definitions.get(reference.identifier)
            // The parser only makes a reference whose label is defined. A link may use the definition too, so the picture gets its own address.
            if (!definition) return
            sites.push({
                src: definition.url,
                apply: (outcome) =>
                    put(
                        'dataUrl' in outcome
                            ? { type: 'image', url: outcome.dataUrl, alt: reference.alt, title: definition.title }
                            : altText(reference.alt)
                    ),
            })
        }
    })
    return sites
}

/**
 * Puts each picture in the document into it as a `data:` URL, so the PDF and Word files carry their images. Files
 * are found the way the preview finds them. A picture that can't be embedded prints as its alt text, and is
 * returned with the reason, once for each address.
 */
export async function embedDocumentImages(tree: Root, options: DocumentImageOptions): Promise<PdfExportMissingImage[]> {
    const sites = imageSites(tree)
    const reads = new Map<string, Promise<Embedded | null>>()
    for (const { src } of sites) if (!reads.has(src)) reads.set(src, embed(src, options))

    const outcomes = new Map<string, Embedded | null>()
    for (const [src, read] of reads) outcomes.set(src, await read)
    for (const { src, apply } of sites) {
        const outcome = outcomes.get(src)
        if (outcome) apply(outcome)
    }
    return [...outcomes].flatMap(([src, outcome]) =>
        outcome && 'reason' in outcome ? [{ slot: 'Image', path: decode(src).trim(), reason: outcome.reason }] : []
    )
}
