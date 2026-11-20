import { isPathInside } from '@/components/studio/markdown/markdown-links'
import { comparablePath, getParentPath, joinPath, pathInside } from '@/lib/tauri/fs'
import { isMarkdownFile } from '@/lib/workspace/file-types'
import type { FileNode } from '@/lib/workspace/types'

/**
 * Which note a wiki link (`[[Note]]`, `[[folder/Note]]`) leads to, from the open folder's tree: the one lookup the
 * preview, the editor's suggestions, the link check and "Linked from" all use, so they never disagree.
 */

/** A Markdown file the tree lists, as wiki links know it. */
export type WikiNote = {
    /** As the tree spells it. */
    path: string
    /** Its name without `.md` or `.markdown`, as written. */
    name: string
    /** Its path from the open folder, with `/` between names and without `.md` or `.markdown`: `docs/Setup`. */
    relative: string
    /** Its folder from the open folder, with `/` between names: '' at the top. */
    folder: string
}

export type WikiIndex = {
    root: string
    /** Every Markdown file, in the tree's order. */
    notes: readonly WikiNote[]
    /** Notes by name in lower case, each list in the order a clash is settled after the folder: shortest path, then A to Z. */
    byName: ReadonlyMap<string, readonly WikiNote[]>
    /** Notes by `relative` in lower case. */
    byPath: ReadonlyMap<string, WikiNote>
    /**
     * The tree doesn't list every file: it was cut short (MAX_TREE_ENTRIES, see isTreeTruncated) or has folders it
     * couldn't read. A note it doesn't list may still be there.
     */
    incomplete: boolean
}

/**
 * - `found`: the note at `path`.
 * - `missing`: no note has that name in the open folder (or the target points outside it).
 * - `unlisted`: none the tree lists, but the tree doesn't list every file (see WikiIndex.incomplete).
 */
export type WikiLookup = { kind: 'found'; path: string } | { kind: 'missing' } | { kind: 'unlisted' }

const MARKDOWN_SUFFIX = /\.(?:md|markdown)$/i
const DRIVE = /^[a-zA-Z]:/

function compareNotes(a: WikiNote, b: WikiNote): number {
    if (a.relative.length !== b.relative.length) return a.relative.length - b.relative.length
    const left = a.relative.toLowerCase()
    const right = b.relative.toLowerCase()
    return left < right ? -1 : left > right ? 1 : 0
}

/** The tree's Markdown files as one lookup. Build it once each time the tree changes (see wikiIndexFor). */
export function buildWikiIndex(root: string, tree: readonly FileNode[]): WikiIndex {
    const notes: WikiNote[] = []
    let incomplete = false
    const walk = (nodes: readonly FileNode[], folder: string) => {
        for (const node of nodes) {
            if (node.kind === 'directory') {
                if (node.truncated || node.unreadable) incomplete = true
                walk(node.children, folder ? `${folder}/${node.name}` : node.name)
            } else if (isMarkdownFile(node.name)) {
                const name = node.name.replace(MARKDOWN_SUFFIX, '')
                notes.push({ path: node.path, name, relative: folder ? `${folder}/${name}` : name, folder })
            }
        }
    }
    walk(tree, '')

    const byName = new Map<string, WikiNote[]>()
    const byPath = new Map<string, WikiNote>()
    for (const note of notes) {
        const key = note.name.toLowerCase()
        const same = byName.get(key)
        if (same) same.push(note)
        else byName.set(key, [note])
        const pathKey = note.relative.toLowerCase()
        if (!byPath.has(pathKey)) byPath.set(pathKey, note)
    }
    for (const list of byName.values()) list.sort(compareNotes)
    return { root, notes, byName, byPath, incomplete }
}

const indexes = new WeakMap<readonly FileNode[], WikiIndex>()

/** {@link buildWikiIndex}, kept for each tree, so the preview, the editor and the Outline share one. */
export function wikiIndexFor(root: string, tree: readonly FileNode[]): WikiIndex {
    const kept = indexes.get(tree)
    if (kept && kept.root === root) return kept
    const built = buildWikiIndex(root, tree)
    indexes.set(tree, built)
    return built
}

/** The folder a document is in, from the open folder, with `/` between names; '' at the top or for no document. */
function documentFolder(index: WikiIndex, documentPath: string | null): string {
    if (!documentPath) return ''
    const rest = pathInside(getParentPath(documentPath), index.root)
    return rest === null ? '' : rest.replace(/\\/g, '/')
}

/** The names of a path from the open folder with `.` and `..` worked out, or null when it climbs out of it. */
function folderPath(target: string): string[] | null {
    const names: string[] = []
    for (const name of target.split('/')) {
        if (!name || name === '.') continue
        if (name === '..') {
            if (names.length === 0) return null
            names.pop()
        } else {
            names.push(name)
        }
    }
    return names
}

/**
 * The note a wiki link's target names, for a link in `documentPath` (null for a document that isn't in a folder).
 * Letter case and a `.md` or `.markdown` at the end don't matter. A target with `/` or `\` is a path from the open
 * folder (`[[docs/Setup]]`, `[[/docs/Setup]]`); one without is a name, matched anywhere in it. When notes share
 * a name, the one in the document's own folder wins (the open folder's top for a document with no folder of its own),
 * then the one with the shortest path, then the first from A to Z. A target never leads outside the open folder: one
 * with a drive letter or a network share, or that climbs out with `..`, is missing.
 */
export function resolveWikiTarget(index: WikiIndex, target: string, documentPath: string | null): WikiLookup {
    const notFound: WikiLookup = index.incomplete ? { kind: 'unlisted' } : { kind: 'missing' }
    const written = target.trim().replace(/\\/g, '/')
    if (DRIVE.test(written) || written.startsWith('//')) return { kind: 'missing' }
    const wanted = written.replace(MARKDOWN_SUFFIX, '')
    if (!wanted) return { kind: 'missing' }

    if (wanted.includes('/')) {
        const names = folderPath(wanted)
        if (!names || names.length === 0) return { kind: 'missing' }
        // Belt and braces: whatever the names say, the file must be inside the open folder.
        if (!isPathInside(names.reduce(joinPath, index.root), index.root)) return { kind: 'missing' }
        const note = index.byPath.get(names.join('/').toLowerCase())
        return note ? { kind: 'found', path: note.path } : notFound
    }

    const candidates = index.byName.get(wanted.toLowerCase())
    if (!candidates) return notFound
    const folder = documentFolder(index, documentPath).toLowerCase()
    const note = candidates.find((candidate) => candidate.folder.toLowerCase() === folder) ?? candidates[0]!
    return { kind: 'found', path: note.path }
}

/**
 * The shortest target that leads to `note` from `documentPath`: its name, unless another note with that name wins
 * there, else its path from the open folder. What a suggestion inserts.
 */
export function wikiTargetFor(index: WikiIndex, note: WikiNote, documentPath: string | null): string {
    const byName = resolveWikiTarget(index, note.name, documentPath)
    return byName.kind === 'found' && comparablePath(byName.path) === comparablePath(note.path) ? note.name : note.relative
}

/** Whether more than one note has this note's name, so a list of them should say which folder each is in. */
export function wikiNameClashes(index: WikiIndex, note: WikiNote): boolean {
    return (index.byName.get(note.name.toLowerCase())?.length ?? 0) > 1
}
