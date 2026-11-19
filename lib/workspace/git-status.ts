import { comparablePath, getParentPath, joinPath, normalizePath } from '@/lib/tauri/fs'
import type { GitEntry } from '@/lib/tauri/git'
import type { FileNode } from '@/lib/workspace/types'

/** A changed file's letter: Modified, Added, Untracked (new and not added yet), Renamed or Conflicted. */
export type GitFileMark = 'M' | 'A' | 'U' | 'R' | 'C'

/** What one explorer row shows: a file's letter, `changes` for a folder with changes inside, or '' for nothing. */
export type GitRowMark = GitFileMark | 'changes' | ''

/** Said in the row's tooltip and to screen readers, so the mark never relies on its colour or letter alone. */
export const GIT_MARK_LABELS: Record<Exclude<GitRowMark, ''>, string> = {
    M: 'Modified',
    A: 'Added',
    U: 'Untracked',
    R: 'Renamed',
    C: 'Conflicted',
    changes: 'Contains changes',
}

/** The open folder's git changes, ready to look rows up in. Paths are keyed by {@link comparablePath}. */
export type GitChanges = {
    /** Each changed file still on disk, and its letter. */
    files: ReadonlyMap<string, GitFileMark>
    /** Folders with a change somewhere inside, a deleted file's or a renamed file's old place included. */
    folders: ReadonlySet<string>
    /** Folders git reported whole, as everything in them is untracked. */
    untrackedFolders: ReadonlySet<string>
    /** The same for the same changes, to tell whether a refresh changed anything. */
    key: string
}

export const NO_GIT_CHANGES: GitChanges = { files: new Map(), folders: new Set(), untrackedFolders: new Set(), key: '' }

/** What an entry means for its path: a row's letter, or `D` for a file that is gone from the disk. */
export function entryMark(entry: GitEntry): GitFileMark | 'D' {
    const [x = '.', y = '.'] = entry.xy
    switch (entry.kind) {
        case 'unmerged':
            return 'C'
        case 'untracked':
            return 'U'
        case 'renamed':
            if (y === 'D') return 'D'
            // A copy is a new file, made from another.
            return x === 'C' ? 'A' : 'R'
        case 'changed':
            if (x === 'D' || y === 'D') return 'D'
            return x === 'A' ? 'A' : 'M'
    }
}

/** Which letter wins when git lists a path twice (deleted in the index, and back again untracked, say). */
const MARK_RANK: Record<GitFileMark, number> = { U: 1, M: 2, A: 3, R: 4, C: 5 }

/**
 * Turns git's entries for the open folder `root` into what the rows show: each changed file's letter, and every
 * folder with something changed inside it (deleted files too, which have no row of their own).
 */
export function gitChangesFrom(root: string, entries: readonly GitEntry[]): GitChanges {
    if (entries.length === 0) return NO_GIT_CHANGES
    const top = comparablePath(root)
    const files = new Map<string, GitFileMark>()
    const folders = new Set<string>()
    const untrackedFolders = new Set<string>()
    const fullPath = (relative: string) => (relative === '' ? normalizePath(root) : joinPath(root, relative))
    const noteFoldersAbove = (path: string) => {
        let folder = getParentPath(path)
        while (folder) {
            const key = comparablePath(folder)
            if (key === top || key.length < top.length || folders.has(key)) break
            folders.add(key)
            const parent = getParentPath(folder)
            if (parent === folder) break
            folder = parent
        }
    }

    for (const entry of entries) {
        const path = fullPath(entry.path)
        const key = comparablePath(path)
        noteFoldersAbove(path)
        if (entry.from !== undefined) noteFoldersAbove(fullPath(entry.from))
        if (entry.dir) {
            untrackedFolders.add(key)
            if (key !== top) folders.add(key)
            continue
        }
        const mark = entryMark(entry)
        if (mark === 'D') continue
        const before = files.get(key)
        if (!before || MARK_RANK[mark] > MARK_RANK[before]) files.set(key, mark)
    }
    return { files, folders, untrackedFolders, key: `${top}\n${JSON.stringify(entries)}` }
}

/** True when `path`, or a folder it is in, is a folder git reported as untracked whole. */
function inUntrackedFolder(changes: GitChanges, path: string): boolean {
    if (changes.untrackedFolders.size === 0) return false
    let current = normalizePath(path)
    while (current) {
        if (changes.untrackedFolders.has(comparablePath(current))) return true
        const parent = getParentPath(current)
        if (parent === current) return false
        current = parent
    }
    return false
}

/**
 * The mark for the row of `path`: a file's letter (U for anything in an untracked folder, which git lists as one
 * entry), or a dot for a folder with any change inside it. A submodule whose commit moved is a folder with an entry
 * of its own, and gets the dot too.
 */
export function gitRowMark(changes: GitChanges, path: string, kind: FileNode['kind']): GitRowMark {
    if (changes === NO_GIT_CHANGES) return ''
    const key = comparablePath(path)
    if (kind === 'directory') {
        return changes.folders.has(key) || changes.files.has(key) || inUntrackedFolder(changes, path) ? 'changes' : ''
    }
    return changes.files.get(key) ?? (inUntrackedFolder(changes, path) ? 'U' : '')
}
