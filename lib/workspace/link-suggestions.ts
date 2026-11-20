import { fuzzyScore } from '@/components/studio/command-palette/fuzzy-match'
import { getBaseName, isPathInside, pathInside, samePath } from '@/lib/tauri/fs'
import { isSupportedDocument } from '@/lib/workspace/file-types'
import { isImageFile } from '@/lib/workspace/image-assets'
import type { LinkIndex, LinkIndexEntry } from '@/lib/workspace/link-index'

/** How many close matches Ctrl+. offers for a broken link. */
export const MAX_LINK_SUGGESTIONS = 5

/** What a link is for, so files of that kind come first: pictures for an image, documents for a link. */
export type LinkTargetKind = 'image' | 'document'

/**
 * The fewest changes (letters added, dropped or swapped for others) that turn `a` into `b`, or `max + 1` as soon as it
 * is clear it is more than `max`.
 */
function editDistance(a: string, b: string, max: number): number {
    let previous = new Uint16Array(b.length + 1).map((_, i) => i)
    let current = new Uint16Array(b.length + 1)
    for (let i = 1; i <= a.length; i += 1) {
        current[0] = i
        let best = i
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
            if (current[j]! < best) best = current[j]!
        }
        if (best > max) return max + 1
        ;[previous, current] = [current, previous]
    }
    return previous[b.length]!
}

/**
 * How close `candidate` is to `wanted`, or null when it isn't close at all: the palette's fuzzy match either way round
 * (a letter left out of the link, or one too many), or else a typo or two in the name.
 */
function closeness(candidate: string, wanted: string, typos: boolean): number | null {
    // Text can only be found in text at least as long, so the fuzzy match that can't succeed isn't tried.
    const forward = candidate.length >= wanted.length ? fuzzyScore(candidate, wanted) : null
    if (forward !== null) return forward
    const backward = wanted.length >= candidate.length ? fuzzyScore(wanted, candidate) : null
    if (backward !== null) return backward - 10
    if (!typos) return null
    const a = candidate.toLowerCase()
    const b = wanted.toLowerCase()
    const allowed = Math.max(2, Math.floor(Math.max(a.length, b.length) / 4))
    // Cheap to rule out first: a name much longer or shorter can't be a typo or two away.
    if (Math.abs(a.length - b.length) > allowed) return null
    const distance = editDistance(a, b, allowed)
    return distance <= allowed ? b.length * 5 - distance * 15 : null
}

/** A path inside the open folder as a link writes it from there, with `/` between names, for comparing. */
function inFolder(index: LinkIndex, path: string): string {
    return (pathInside(path, index.root) ?? path).replace(/\\/g, '/')
}

/** An entry with what ranking compares worked out once. */
type Prepared = {
    entry: LinkIndexEntry
    /** From the open folder, with `/`. */
    relative: string
    name: string
    /** Its folder from the open folder, in lower case, one name per item. */
    folders: string[]
    image: boolean
    document: boolean
}

/** Worked out the first time Ctrl+. asks, then kept as long as the tree (and so the index) is the same. */
const prepared = new WeakMap<LinkIndex, Prepared[]>()

function prepare(index: LinkIndex): Prepared[] {
    const known = prepared.get(index)
    if (known) return known
    // The tree names everything from the open folder as it spells it, so the rest of each path is just cut off.
    const rootLength = index.root.replace(/[\\/]+$/, '').length + 1
    const list = index.list.map((entry): Prepared => {
        const relative = entry.path.slice(rootLength).replace(/\\/g, '/')
        const slash = relative.lastIndexOf('/')
        return {
            entry,
            relative,
            name: relative.slice(slash + 1),
            folders: slash < 0 ? [] : relative.slice(0, slash).toLowerCase().split('/'),
            image: entry.kind === 'file' && isImageFile(entry.path),
            document: entry.kind === 'file' && isSupportedDocument(entry.path),
        }
    })
    prepared.set(index, list)
    return list
}

function kindBonus(item: Prepared, wanted: LinkTargetKind): number {
    if (item.entry.kind === 'directory') return wanted === 'image' ? -1000 : 0
    if (wanted === 'image') return item.image ? 40 : -20
    return item.document ? 40 : 0
}

/** More for an entry in the same folder as the broken link's target, a little for each folder they share. */
function nearness(item: Prepared, folders: readonly string[]): number {
    let shared = 0
    while (shared < item.folders.length && shared < folders.length && item.folders[shared] === folders[shared]) shared += 1
    return shared === folders.length && shared === item.folders.length ? 30 : shared * 3
}

/**
 * The files and folders in the open folder closest to a link's `target` (the path it leads to, which isn't there),
 * best first: by the palette's fuzzy match on the path and on the name, files of the link's kind first, then those
 * nearby in the folder. Never the document itself.
 */
export function closeLinkTargets(
    index: LinkIndex,
    target: string,
    { wanted, documentPath, limit = MAX_LINK_SUGGESTIONS }: { wanted: LinkTargetKind; documentPath: string | null; limit?: number }
): string[] {
    const wantedPath = inFolder(index, target)
    const wantedName = getBaseName(target)
    const slash = wantedPath.lastIndexOf('/')
    const wantedFolders = slash < 0 ? [] : wantedPath.slice(0, slash).toLowerCase().split('/')
    const ranked: { path: string; score: number }[] = []
    for (const item of prepare(index)) {
        const bonus = kindBonus(item, wanted)
        if (bonus <= -1000) continue
        const byName = closeness(item.name, wantedName, true)
        // Only the name can catch a typo; the whole path is matched the palette's way, one way round.
        const byPath = item.relative.length >= wantedPath.length ? fuzzyScore(item.relative, wantedPath) : null
        if (byPath === null && byName === null) continue
        const { entry } = item
        // The folder the missing file would be in is there already; it isn't what the link meant.
        if (entry.kind === 'directory' && isPathInside(target, entry.path)) continue
        const score = Math.max(byPath ?? -Infinity, (byName ?? -Infinity) - 5) + bonus + nearness(item, wantedFolders)
        ranked.push({ path: entry.path, score })
    }
    ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    // Only the best few are compared with the document, rather than every entry.
    const best: string[] = []
    for (const { path } of ranked) {
        if (best.length >= limit) break
        if (!documentPath || !samePath(path, documentPath)) best.push(path)
    }
    return best
}

/** Footnote and footnote-label ids: real places, but rarely what a `#heading` link meant. */
const FOOTNOTE_ID = /^(fn-|fnref-|footnote-label$)/

/** The anchors closest to a `#fragment` that leads nowhere, best first; headings before footnotes. */
export function closeAnchors(ids: readonly string[], fragment: string, limit = MAX_LINK_SUGGESTIONS): string[] {
    const ranked: { id: string; score: number; order: number }[] = []
    const seen = new Set<string>()
    ids.forEach((id, order) => {
        if (!id || seen.has(id)) return
        seen.add(id)
        const score = closeness(id, fragment, true)
        if (score === null) return
        ranked.push({ id, score: score - (FOOTNOTE_ID.test(id) ? 30 : 0), order })
    })
    ranked.sort((a, b) => b.score - a.score || a.order - b.order)
    return ranked.slice(0, limit).map((item) => item.id)
}
