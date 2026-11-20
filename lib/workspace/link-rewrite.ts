import { decode, resolveMarkdownLink } from '@/components/studio/markdown/markdown-links'
import { addressParts, readDocumentLinks, type DocumentLink, type DocumentLinks, type TextSpan } from '@/lib/markdown/document-links'
import { isPathInside, joinPath, normalizePath, samePath } from '@/lib/tauri/fs'
import { documentLinkAddress } from '@/lib/workspace/image-assets'
import { remapPathAfterRename } from '@/lib/workspace/tab-paths'
import { applyTextEdits, rangesOfOffsets, type TextEdit } from '@/lib/workspace/text-edits'

/**
 * Which links in a Markdown file a rename or move breaks, and what each should say instead. Pure: the text, the
 * paths and whether a target is there are all handed in, so it can be tested without a disk, and the link-update
 * scan (link-update.ts) and its second pass on Update Links share it.
 *
 * Links are read by the shared link extractor (documentLinks), so links in code, inline code and maths are never
 * touched, and only an address whose place in the text is certain is changed. Each address is resolved from the
 * file's old place, as the preview resolved it before the move, and the new one is written from the file's new place.
 */

/** A file or folder renamed or moved from `oldPath` to `newPath`. */
export type PathMove = { oldPath: string; newPath: string }

/** One link's new address. */
export type LinkRewrite = {
    /** Where the path is written (the address without its `?query` or `#fragment`), in the whole text: what changes. */
    span: TextSpan
    /** The new path, as it is written in place of `span`. */
    text: string
    /** The whole address as written before (with any `?query` and `#fragment`). */
    oldAddress: string
    /** The whole address as it will be written. */
    newAddress: string
    /** The line the address is on, from 1. */
    line: number
}

export type LinkRewriteContext = {
    workspaceRoot: string
    /** Where the file whose text this is was before the move. */
    oldFilePath: string
    move: PathMove
    /**
     * Whether a link's target is there, given by where it was before the move. Only asked about links that would
     * change; a target that isn't there is a broken link, and stays as it is written.
     */
    targetExists: (oldTarget: string) => boolean | Promise<boolean>
    /**
     * Gives the UI a turn (createYielder): called every few hundred links, so a file with thousands of them never
     * holds up typing while it is planned.
     */
    yieldToUi?: () => Promise<void>
}

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:([\\/]|%5c)/i
const NETWORK_PATH = /^([\\/]|%5c){2}/i

/** The path an address names, decoded as the preview reads it, without its `?query` or `#fragment`. */
function linkPathOf(url: string): string {
    const value = url.trim()
    const hash = value.indexOf('#')
    const beforeHash = hash >= 0 ? value.slice(0, hash) : value
    const query = beforeHash.indexOf('?')
    return decode(query >= 0 ? beforeHash.slice(0, query) : beforeHash)
}

/** Where a link leads from `documentPath`, when it is a file path inside the open folder: null for anything else. */
function fileTarget(url: string, documentPath: string, workspaceRoot: string): string | null {
    const target = resolveMarkdownLink(url, { documentPath, workspaceRoot })
    if (target.kind !== 'file') return null
    return normalizePath(target.path)
}

/** How many links are planned between turns given to the UI (`yieldToUi`), in a file with very many. */
const LINKS_PER_TURN = 256

/** A rewrite before its line is known: the lines are worked out once for the whole file (planLinkRewrites). */
type PlannedRewrite = Omit<LinkRewrite, 'line'>

/** The rewrite one link needs, or null when the move leaves it working (or it is left alone). */
async function rewriteFor(text: string, link: DocumentLink, context: LinkRewriteContext, newFilePath: string): Promise<PlannedRewrite | null> {
    // A reference's address is in its definition, which is rewritten (once) on its own.
    if (!link.address || link.kind === 'reference') return null
    const written = text.slice(link.address.start, link.address.end)
    const parts = addressParts(written, link.url)
    if (!parts) return null

    const linkPath = linkPathOf(link.url)
    // `#` links, web links and other schemes resolve to no file; absolute paths name the same place wherever the file is.
    if (!linkPath || WINDOWS_ABSOLUTE.test(linkPath) || NETWORK_PATH.test(linkPath) || WINDOWS_ABSOLUTE.test(link.url)) return null

    const { workspaceRoot, oldFilePath, move } = context
    const before = fileTarget(link.url, oldFilePath, workspaceRoot)
    // Only inside the open folder, so a link never makes Scrivon look elsewhere on the disk.
    if (!before || !isPathInside(before, workspaceRoot)) return null
    const after = normalizePath(remapPathAfterRename(before, move.oldPath, move.newPath))
    // Where the address as written leads from the file's new place. Compared exactly (letter case too), so a change
    // of case only is seen: the link then still works on Windows, but not where case matters (GitHub).
    const now = fileTarget(link.url, newFilePath, workspaceRoot)
    if (now !== null && now === after) return null

    // A link that was broken before the move stays as it is written.
    const exists = samePath(before, move.oldPath) || (await context.targetExists(before))
    if (!exists) return null

    // `/` links stay from the open folder; the rest are from the file's folder, with `/` between names.
    const fromRoot = linkPath.startsWith('/')
    let path = fromRoot ? `/${documentLinkAddress(joinPath(workspaceRoot, '_'), after)}` : documentLinkAddress(newFilePath, after)
    if (/[\\/]$/.test(linkPath) && !path.endsWith('/')) path += '/'
    const start = link.address.start
    const suffix = written.slice(parts.pathEnd)
    return {
        span: { start, end: start + parts.pathEnd },
        text: path,
        oldAddress: written,
        newAddress: `${path}${suffix}`,
    }
}

/**
 * The links in `text` (the Markdown file that was at `context.oldFilePath`) that the move breaks, and their new
 * addresses, in order. Those are links to the moved file or folder (or something in it), and, in a file that moved
 * itself, its own relative links. A link that still leads to the same place from the new folder isn't changed, so a
 * rename in place leaves a file's own links alone, as does a folder move for links between two files inside it.
 * Each rewrite replaces only the path: the `?query`, `#fragment`, title, `<…>` and reference-definition form stay.
 */
export async function planLinkRewrites(
    text: string,
    context: LinkRewriteContext,
    links: DocumentLinks = readDocumentLinks(text)
): Promise<LinkRewrite[]> {
    const newFilePath = normalizePath(remapPathAfterRename(context.oldFilePath, context.move.oldPath, context.move.newPath))
    const planned: PlannedRewrite[] = []
    for (const [i, link] of links.links.entries()) {
        if (context.yieldToUi && i > 0 && i % LINKS_PER_TURN === 0) await context.yieldToUi()
        const rewrite = await rewriteFor(text, link, context, newFilePath)
        if (rewrite) planned.push(rewrite)
    }
    // Each line is worked out once for the file (a binary search per link), not counted from the start each time.
    const ranges = rangesOfOffsets(
        text,
        planned.map((rewrite) => rewrite.span)
    )
    return planned.map((rewrite, i) => ({ ...rewrite, line: ranges[i]!.startLineNumber }))
}

/**
 * What a file's rewrites are, apart from where they are: the same signature means the same links change in the same
 * way, so a file edited elsewhere since it was scanned still gets the rewrites it was shown, at their new places.
 */
export function rewriteSignature(rewrites: readonly LinkRewrite[]): string {
    return JSON.stringify(rewrites.map((rewrite) => [rewrite.oldAddress, rewrite.newAddress]))
}

/** The rewrites as editor edits on `text` (for applyTabEdits: one undo step for them all). */
export function rewriteEdits(text: string, rewrites: readonly LinkRewrite[]): TextEdit[] {
    const ranges = rangesOfOffsets(
        text,
        rewrites.map((rewrite) => rewrite.span)
    )
    return rewrites.map((rewrite, i) => ({ range: ranges[i]!, text: rewrite.text }))
}

/** `text` with the rewrites made. */
export function applyRewrites(text: string, rewrites: readonly LinkRewrite[]): string {
    return applyTextEdits(text, rewriteEdits(text, rewrites))
}

/**
 * Whether a file that didn't move could link to the moved item at all: its addresses would have to name it. A cheap
 * look before the file is parsed, so most files in a big folder are passed over. Each run of letters and digits in
 * the name must be there, as it is or percent-encoded, in any letter case.
 */
export function mightLinkTo(text: string, name: string): boolean {
    const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    if (words.length === 0) return true
    const lower = text.toLowerCase()
    return words.every((word) => {
        const w = word.toLowerCase()
        return lower.includes(w) || lower.includes(encodeURIComponent(w).toLowerCase())
    })
}
