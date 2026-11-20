import { anchorLeadsSomewhere, decode, resolveMarkdownLink, type MarkdownLinkContext } from '@/components/studio/markdown/markdown-links'
import {
    addressParts,
    type AddressParts,
    type DocumentLink,
    type DocumentLinks,
    type DocumentWikiLink,
    type TextSpan,
} from '@/lib/markdown/document-links'
import { getBaseName, isPathInside, samePath } from '@/lib/tauri/fs'
import type { DiskAnswer } from '@/lib/workspace/link-target-cache'
import { lookupLinkTarget, type LinkIndex } from '@/lib/workspace/link-index'
import type { LinkTargetKind } from '@/lib/workspace/link-suggestions'
import { resolveDocumentImage } from '@/lib/workspace/workspace-images'
import { resolveWikiTarget, type WikiIndex } from '@/lib/workspace/wiki-link-lookup'

/** More marks than anyone would fix one by one, so a generated file full of dead links can't slow the editor. */
export const MAX_LINK_MARKS = 500

/** How a broken link can be fixed: a new path, or a new `#fragment`. */
export type LinkFix =
    | {
          kind: 'path'
          /** Where the path is written (the address without its `?query` or `#fragment`), which a fix replaces. */
          span: TextSpan
          /** The file or folder it leads to, which isn't there. */
          target: string
          /** Files of this kind are offered first. */
          wanted: LinkTargetKind
      }
    | {
          kind: 'anchor'
          /** Where the fragment is written (after the `#`), which a fix replaces. */
          span: TextSpan
          /** The ids the linked document has, to offer the closest. */
          ids: readonly string[]
      }
    | {
          /** A wiki link's note, which nothing is offered for yet. */
          kind: 'note'
          /** Where the target is written. */
          span: TextSpan
      }

/** A link that leads nowhere: where its address is, what is wrong in plain words, and how it can be fixed. */
export type BrokenLink = {
    /** The address, as the parser found it in the document: the mark goes here. */
    span: TextSpan
    message: string
    fix: LinkFix
}

export type LinkCheckContext = MarkdownLinkContext & {
    /** The open folder's tree as a lookup (buildLinkIndex), or null when no folder is open. */
    index: LinkIndex | null
    /**
     * The open folder's notes, for wiki links (wikiIndexFor), or null when no folder is open or the file isn't in it.
     * Left out, wiki links aren't checked.
     */
    wikiIndex?: WikiIndex | null
    /** The text of a file open in a tab, or undefined (see openTabText). Another file is never read from disk. */
    openText: (path: string) => string | undefined
    /** The anchors another open document has. */
    anchorsOf: (text: string) => Promise<readonly string[]>
    /**
     * Whether a path the tree can't vouch for is there (checkLinkTarget). `fresh` asks again rather than using a kept
     * answer: the link was just edited.
     */
    checkOnDisk: (path: string, fresh: boolean) => Promise<DiskAnswer>
    /** Whether the link has been edited since the last check, so what the disk said about it before is out of date. */
    edited?: (link: DocumentLink) => boolean
}

/** What a link leads to on disk, as far as the tree and (only when the tree can't say) the disk can tell. */
async function targetState(path: string, link: DocumentLink, context: LinkCheckContext): Promise<'there' | 'missing' | 'unknown'> {
    const answer = lookupLinkTarget(context.index!, path)
    if (answer.kind === 'found') return 'there'
    if (answer.kind === 'missing') return 'missing'
    const onDisk = await context.checkOnDisk(path, context.edited?.(link) ?? false)
    return onDisk === 'missing' ? 'missing' : onDisk === 'unknown' ? 'unknown' : 'there'
}

/** The path as the link writes it, decoded (`my%20file.md` is `my file.md`), for the message. */
function writtenPath(written: string, parts: AddressParts): string {
    return decode(written.slice(0, parts.pathEnd).replace(/\\([!-/:-@[-`{-~])/g, '$1'))
}

function missingMessage(written: string, parts: AddressParts, image: boolean): string {
    const path = writtenPath(written, parts)
    if (/[\\/]$/.test(path)) return `No folder called ${path} in this folder.`
    return `No ${image ? 'image' : 'file'} called ${path} in this folder.`
}

function anchorMessage(fragment: string, file: string | null): string {
    return `${file ? `${file} has` : 'This file has'} no heading for #${fragment}.`
}

function pathFix(link: DocumentLink, parts: AddressParts, target: string, wanted: LinkTargetKind): LinkFix {
    const start = link.address!.start
    return { kind: 'path', span: { start, end: start + parts.pathEnd }, target, wanted }
}

function anchorFix(link: DocumentLink, written: string, parts: AddressParts, ids: readonly string[]): LinkFix {
    const start = link.address!.start + (parts.fragmentStart ?? written.length)
    return { kind: 'anchor', span: { start, end: link.address!.end }, ids }
}

/** Why one link leads nowhere, or null when it works or can't be checked. */
async function checkLink(source: string, link: DocumentLink, anchors: readonly string[], context: LinkCheckContext): Promise<BrokenLink | null> {
    if (!link.address || link.kind === 'reference') return null
    const written = source.slice(link.address.start, link.address.end)
    // Where the path and fragment are written, as the preview splits them: unsure, and the link is left alone.
    const parts = addressParts(written, link.url)
    if (!parts) return null
    const image = link.kind === 'image' || (link.kind === 'definition' && link.image === true)
    const { documentPath, workspaceRoot, index } = context

    if (image) {
        // As the preview shows it: web and inline pictures, and anything outside the open folder, aren't files to check.
        const resolved = resolveDocumentImage(link.url, context)
        if (resolved.kind !== 'file' || !index) return null
        const state = await targetState(resolved.path, link, context)
        return state === 'missing'
            ? { span: link.address, message: missingMessage(written, parts, true), fix: pathFix(link, parts, resolved.path, 'image') }
            : null
    }

    const target = resolveMarkdownLink(link.url, context)
    if (target.kind === 'anchor') {
        return anchorLeadsSomewhere(anchors, target.id)
            ? null
            : { span: link.address, message: anchorMessage(target.id, null), fix: anchorFix(link, written, parts, anchors) }
    }
    // Web, mail and phone links, other computers' shares, other schemes, and the top of the document.
    if (target.kind !== 'file') return null

    if (documentPath && samePath(target.path, documentPath)) {
        if (!target.fragment || anchorLeadsSomewhere(anchors, target.fragment)) return null
        return { span: link.address, message: anchorMessage(target.fragment, null), fix: anchorFix(link, written, parts, anchors) }
    }
    // Only inside the open folder, so a link can never make Scrivon look elsewhere on the disk.
    if (!index || !workspaceRoot || !isPathInside(target.path, workspaceRoot)) return null

    const state = await targetState(target.path, link, context)
    if (state === 'missing')
        return { span: link.address, message: missingMessage(written, parts, false), fix: pathFix(link, parts, target.path, 'document') }
    if (state !== 'there' || !target.fragment) return null

    // Another document's heading only while it is open in a tab: its text is there to read without the disk.
    const text = context.openText(target.path)
    if (text === undefined) return null
    const ids = await context.anchorsOf(text)
    if (anchorLeadsSomewhere(ids, target.fragment)) return null
    return { span: link.address, message: anchorMessage(target.fragment, getBaseName(target.path)), fix: anchorFix(link, written, parts, ids) }
}

/**
 * The links in `source` (read by documentLinks) that lead nowhere, in order, at most MAX_LINK_MARKS. Links that
 * resolve in the tree cost a map lookup each: the disk is asked only about a path the tree can't vouch for, once.
 */
export async function findBrokenLinks(
    source: string,
    { links, wikiLinks, anchors }: DocumentLinks,
    context: LinkCheckContext
): Promise<BrokenLink[]> {
    const found = await Promise.all(links.map((link) => checkLink(source, link, anchors, context)))
    const wiki = wikiLinks.map((link) => checkWikiLink(link, context))
    // In the order they are in the document.
    const broken = [...found, ...wiki].filter((mark): mark is BrokenLink => mark !== null).sort((a, b) => a.span.start - b.span.start)
    return broken.slice(0, MAX_LINK_MARKS)
}

/**
 * Why a wiki link's note can't be found, or null when it can or the check can't say: the same lookup the preview
 * uses (resolveWikiTarget). Only a note missing from a folder the tree lists in full is marked.
 */
function checkWikiLink(link: DocumentWikiLink, { wikiIndex, documentPath }: LinkCheckContext): BrokenLink | null {
    if (!wikiIndex || !link.targetSpan) return null
    if (resolveWikiTarget(wikiIndex, link.target, documentPath).kind !== 'missing') return null
    return { span: link.targetSpan, message: `No note called ${link.target} in this folder.`, fix: { kind: 'note', span: link.targetSpan } }
}
