import { fuzzyScore } from '@/components/studio/command-palette/fuzzy-match'
import { getBaseName, getParentPath, pathInside, samePath } from '@/lib/tauri/fs'
import { isSupportedDocument } from '@/lib/workspace/file-types'
import { isImageFile } from '@/lib/workspace/image-assets'
import type { LinkIndex, LinkIndexEntry } from '@/lib/workspace/link-index'

/** How many close matches Ctrl+. offers for a broken link. */
export const MAX_LINK_SUGGESTIONS = 5

/** What a link is for, so files of that kind come first: pictures for an image, documents for a link. */
export type LinkTargetKind = 'image' | 'document'

/** The fewest changes (letters added, dropped or swapped for others) that turn `a` into `b`. */
function editDistance(a: string, b: string): number {
    let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i]
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
        previous = current
    }
    return previous[b.length]!
}

/**
 * How close `candidate` is to `wanted`, or null when it isn't close at all: the palette's fuzzy match either way round
 * (a letter left out of the link, or one too many), or else a typo or two in the name.
 */
function closeness(candidate: string, wanted: string, typos: boolean): number | null {
    const forward = fuzzyScore(candidate, wanted)
    if (forward !== null) return forward
    const backward = fuzzyScore(wanted, candidate)
    if (backward !== null) return backward - 10
    if (!typos) return null
    const a = candidate.toLowerCase()
    const b = wanted.toLowerCase()
    const allowed = Math.max(2, Math.floor(Math.max(a.length, b.length) / 4))
    // Cheap to rule out first: a name much longer or shorter can't be a typo or two away.
    if (Math.abs(a.length - b.length) > allowed) return null
    const distance = editDistance(a, b)
    return distance <= allowed ? b.length * 5 - distance * 15 : null
}

/** A path inside the open folder as a link writes it from there, with `/` between names, for comparing. */
function inFolder(index: LinkIndex, path: string): string {
    return (pathInside(path, index.root) ?? path).replace(/\\/g, '/')
}

function kindBonus(entry: LinkIndexEntry, wanted: LinkTargetKind): number {
    if (entry.kind === 'directory') return wanted === 'image' ? -1000 : 0
    if (wanted === 'image') return isImageFile(entry.path) ? 40 : -20
    return isSupportedDocument(entry.path) ? 40 : 0
}

/** More for an entry in the same folder as the broken link's target, a little for each folder they share. */
function nearness(index: LinkIndex, entry: LinkIndexEntry, target: string): number {
    const folder = getParentPath(target)
    if (samePath(getParentPath(entry.path), folder)) return 30
    const a = inFolder(index, getParentPath(entry.path)).toLowerCase().split('/')
    const b = inFolder(index, folder).toLowerCase().split('/')
    let shared = 0
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1
    return shared * 3
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
    const ranked: { path: string; score: number }[] = []
    for (const entry of index.list) {
        if (documentPath && samePath(entry.path, documentPath)) continue
        const bonus = kindBonus(entry, wanted)
        if (bonus <= -1000) continue
        const byPath = closeness(inFolder(index, entry.path), wantedPath, false)
        const byName = closeness(getBaseName(entry.path), wantedName, true)
        if (byPath === null && byName === null) continue
        const score = Math.max(byPath ?? -Infinity, (byName ?? -Infinity) - 5) + bonus + nearness(index, entry, target)
        ranked.push({ path: entry.path, score })
    }
    ranked.sort((a, b) => b.score - a.score || a.path.length - b.path.length)
    return ranked.slice(0, limit).map((item) => item.path)
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
