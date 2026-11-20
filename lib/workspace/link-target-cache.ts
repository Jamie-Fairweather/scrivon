import { comparablePath, createLimit, isFileMissingError, isPathInside, MAX_PARALLEL_READS, readEntryKind } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'

/**
 * What the disk says about a link's target that the explorer's tree can't vouch for (in a folder it leaves out,
 * couldn't read or didn't read): there, as a file or folder; `missing`; or `unknown` when asking failed some other way
 * (no permission, say), which is never underlined.
 */
export type DiskAnswer = FileNode['kind'] | 'missing' | 'unknown'

type ReadKind = (path: string) => Promise<FileNode['kind']>

/** Answers by comparablePath. A pending one is its promise, so a path is asked about once however many links name it. */
const answers = new Map<string, Promise<DiskAnswer> | DiskAnswer>()
const listeners = new Set<() => void>()
/**
 * Each question is a round trip to the app, and an index page in a folder the tree didn't read can name hundreds of
 * paths, asked again after every tab switch and focus: only a few are asked at a time, as the tree's own reads are.
 */
const diskLimit = createLimit(MAX_PARALLEL_READS)

/**
 * Asks the disk once whether `path` is there, and keeps the answer until it is forgotten. The watcher can't keep it
 * fresh (it drops events in the folders the tree leaves out, and a cut-short folder or a network drive isn't watched
 * at all), so the answers are forgotten when the tab changes, the window gets focus again, a link is edited, or the
 * watcher does see a change ({@link forgetLinkTargets}).
 */
export function checkLinkTarget(path: string, readKind: ReadKind = readEntryKind, { fresh = false }: { fresh?: boolean } = {}): Promise<DiskAnswer> {
    const key = comparablePath(path)
    // A link just edited: ask again, without telling anyone (the check asking is already under way).
    if (fresh) answers.delete(key)
    const known = answers.get(key)
    if (known !== undefined) return Promise.resolve(known)
    const asked = diskLimit(() => readKind(path)).then(
        (kind): DiskAnswer => kind,
        (err: unknown): DiskAnswer => (isFileMissingError(err) ? 'missing' : 'unknown')
    )
    answers.set(key, asked)
    void asked.then((answer) => {
        // Forgotten while it was asked: the next check asks again.
        if (answers.get(key) === asked) answers.set(key, answer)
    })
    return asked
}

/** The answer kept for `path`, if there is one yet. */
export function cachedLinkTarget(path: string): DiskAnswer | undefined {
    const known = answers.get(comparablePath(path))
    return typeof known === 'string' ? known : undefined
}

/**
 * Forgets the answers for `paths`, and for anything inside them when they are folders, or every answer when no paths
 * are given. Whatever checks links is told, so it checks them again.
 */
export function forgetLinkTargets(paths?: readonly string[]): void {
    if (answers.size === 0) return
    let forgot = false
    if (!paths) {
        answers.clear()
        forgot = true
    } else {
        const changed = paths.map(comparablePath)
        for (const key of [...answers.keys()]) {
            if (!changed.some((path) => key === path || isPathInside(key, path))) continue
            answers.delete(key)
            forgot = true
        }
    }
    if (!forgot) return
    for (const listener of listeners) listener()
}

/** Calls `listener` when answers are forgotten. Returns the function that stops it. */
export function subscribeLinkTargets(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
