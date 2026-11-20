import { comparablePath, isHiddenFolder, joinPath, pathInside, samePath } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'

/** A file or folder the explorer lists, as the link check knows it. */
export type LinkIndexEntry = {
    kind: FileNode['kind']
    /** As the tree spells it. */
    path: string
    /** A folder whose contents the tree doesn't know: it couldn't be read, or wasn't (the tree was cut short). */
    unread?: true
    /** A read folder's names, to tell a folder the tree leaves out (`.git`, `node_modules`) from one not there. */
    childNames?: readonly string[]
    /**
     * A folder read through a link (a symlinked or junctioned folder, or one inside it): the links in it aren't
     * followed or listed, so a name missing from it may still be there.
     */
    throughLink?: true
}

/**
 * The open folder's tree as one lookup, keyed by comparablePath (so letter case and `\` or `/` don't matter on
 * Windows), with folders as well as files: a link to a folder works. Build it once each time the tree changes; each
 * lookup is then a few map reads, never a walk of the tree.
 */
export type LinkIndex = {
    root: string
    entries: ReadonlyMap<string, LinkIndexEntry>
    /** Every entry, in the tree's order, for finding close matches. */
    list: readonly LinkIndexEntry[]
}

export function buildLinkIndex(root: string, tree: readonly FileNode[]): LinkIndex {
    const entries = new Map<string, LinkIndexEntry>()
    const list: LinkIndexEntry[] = []
    entries.set(comparablePath(root), { kind: 'directory', path: root, childNames: tree.map((node) => node.name) })
    const walk = (nodes: readonly FileNode[], insideLink: boolean) => {
        for (const node of nodes) {
            const throughLink = node.kind === 'directory' && (insideLink || node.linked === true)
            const entry: LinkIndexEntry =
                node.kind === 'file'
                    ? { kind: 'file', path: node.path }
                    : node.unreadable || node.truncated
                      ? { kind: 'directory', path: node.path, unread: true }
                      : {
                            kind: 'directory',
                            path: node.path,
                            childNames: node.children.map((child) => child.name),
                            ...(throughLink ? { throughLink: true as const } : {}),
                        }
            entries.set(comparablePath(node.path), entry)
            list.push(entry)
            if (node.kind === 'directory') walk(node.children, throughLink)
        }
    }
    walk(tree, false)
    return { root, entries, list }
}

/**
 * What the tree says about a path inside the open folder:
 * - `found`: listed, as this file or folder.
 * - `missing`: its folder was read and it isn't there.
 * - `unknown`: the tree can't say. It is in a folder the tree leaves out (`.git`), couldn't read, or didn't read
 *   because the folder is too big (`truncated`), or under a folder read through a link, whose own links the tree
 *   doesn't list. Ask the disk (once: see checkLinkTarget).
 */
export type IndexAnswer = { kind: 'found'; entry: LinkIndexEntry } | { kind: 'missing' } | { kind: 'unknown' }

export function lookupLinkTarget(index: LinkIndex, path: string): IndexAnswer {
    const listed = index.entries.get(comparablePath(path))
    if (listed) return { kind: 'found', entry: listed }
    if (samePath(path, index.root)) return { kind: 'found', entry: index.entries.get(comparablePath(index.root))! }
    const rest = pathInside(path, index.root)
    if (rest === null) return { kind: 'unknown' }

    // Down from the open folder, one name at a time, to the first one the tree doesn't list.
    let folder = index.entries.get(comparablePath(index.root))!
    for (const name of rest.split(/[\\/]+/).filter(Boolean)) {
        const childPath = joinPath(folder.path, name)
        const child = index.entries.get(comparablePath(childPath))
        if (child) {
            folder = child
            continue
        }
        if (folder.kind === 'file') return { kind: 'missing' }
        if (folder.unread || folder.throughLink) return { kind: 'unknown' }
        return isHiddenFolder(name, folder.childNames ?? []) ? { kind: 'unknown' } : { kind: 'missing' }
    }
    return { kind: 'found', entry: folder }
}
