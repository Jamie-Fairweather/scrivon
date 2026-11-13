import { invoke } from '@tauri-apps/api/core'
import { resolveMarkdownLink, type MarkdownLinkContext } from '@/components/studio/markdown/markdown-links'
import { errorMessage } from '@/lib/notify'
import { isPathInside, isWindowsPath, normalizePath } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'

/**
 * Where a document's image comes from. The preview, exports and pasted images all go through this, so they agree
 * on which files a document may show.
 */
export type DocumentImageSource =
    /** Used as written: a web address or an inline `data:` picture. */
    | { kind: 'url'; url: string }
    /** A file inside the open folder, for {@link readWorkspaceImage}. */
    | { kind: 'file'; path: string }
    /** Never read, and why. */
    | { kind: 'blocked'; reason: string }

const URL_IMAGE = /^\s*(https?|data|blob):/i
const OUTSIDE_FOLDER = 'Only images inside the open folder are shown.'

/**
 * Works out where an image's `src` points, from the document's folder (`/` paths from the open folder). A file
 * outside the open folder is never named for reading.
 */
export function resolveDocumentImage(src: string, context: MarkdownLinkContext): DocumentImageSource {
    if (URL_IMAGE.test(src)) return { kind: 'url', url: src }
    const target = resolveMarkdownLink(src, context)
    switch (target.kind) {
        case 'file': {
            const path = normalizePath(target.path)
            const root = context.workspaceRoot
            return root && isPathInside(path, root) ? { kind: 'file', path } : { kind: 'blocked', reason: OUTSIDE_FOLDER }
        }
        case 'unresolved':
            return { kind: 'blocked', reason: 'Save the document in the open folder to show its images.' }
        case 'network':
            return { kind: 'blocked', reason: 'Images on other computers aren’t shown.' }
        case 'none':
            return { kind: 'blocked', reason: 'The image has no address.' }
        default:
            return { kind: 'blocked', reason: 'This kind of image address isn’t supported.' }
    }
}

/** Kept images, newest last. A pending read has no `url` yet. */
type CachedImage = { promise: Promise<string>; url?: string }

/** About 64 MB of images kept in memory; the ones used longest ago go first. */
const MAX_CACHED_CHARS = 64 * 1024 * 1024

const cache = new Map<string, CachedImage>()
let cachedChars = 0
/** Each image asked for, and how many times it has changed on disk since. */
const versions = new Map<string, number>()
const listeners = new Set<() => void>()

/** One spelling per file: `\` on Windows, in lower case there, as file names ignore case. */
function imageKey(path: string): string {
    const normalized = normalizePath(path)
    return isWindowsPath(normalized) ? normalized.toLowerCase() : normalized
}

function dropCached(key: string): void {
    const cached = cache.get(key)
    if (!cached) return
    cache.delete(key)
    cachedChars -= cached.url?.length ?? 0
}

/** Drops the images used longest ago until the rest fit, never the newest one. */
function trimCache(newest: string): void {
    for (const [key, cached] of cache) {
        if (cachedChars <= MAX_CACHED_CHARS) return
        if (key !== newest && cached.url !== undefined) dropCached(key)
    }
}

/**
 * Reads an image inside the open folder as a `data:` URL, through the app (which refuses anything outside
 * `workspaceRoot`). Kept in memory until it changes on disk ({@link forgetWorkspaceImages}); a failed read isn't
 * kept, so it is tried again next time. Rejects with the reason it can't be shown.
 */
export function readWorkspaceImage(path: string, workspaceRoot: string): Promise<string> {
    const key = imageKey(path)
    if (!versions.has(key)) versions.set(key, 0)
    const hit = cache.get(key)
    if (hit) {
        cache.delete(key)
        cache.set(key, hit)
        return hit.promise
    }
    if (!isTauri()) return Promise.reject(new Error('Images from the folder only show in the desktop app.'))

    const entry: CachedImage = {
        promise: invoke<string>('read_workspace_image', { root: workspaceRoot, path }).then(
            (url) => {
                if (cache.get(key) === entry) {
                    entry.url = url
                    cachedChars += url.length
                    trimCache(key)
                }
                return url
            },
            (err: unknown) => {
                if (cache.get(key) === entry) cache.delete(key)
                throw new Error(errorMessage(err, 'Couldn’t read the image.'))
            }
        ),
    }
    cache.set(key, entry)
    return entry.promise
}

/** The image already read for `path`, so it can show straight away; undefined when it isn't kept. */
export function cachedWorkspaceImage(path: string): string | undefined {
    return cache.get(imageKey(path))?.url
}

/** Counts the changes on disk to an image asked for before; it goes up each time the image must be read again. */
export function workspaceImageVersion(path: string): number {
    return versions.get(imageKey(path)) ?? 0
}

/** Calls `listener` when an image asked for before changes on disk. Returns the function that stops it. */
export function subscribeWorkspaceImages(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/**
 * Forgets the images at `paths`, or inside them when they are folders, because they changed on disk. Anything
 * showing one of them is told, so it reads it again.
 */
export function forgetWorkspaceImages(paths: readonly string[]): void {
    const changed = paths.map(imageKey)
    let forgot = false
    for (const [key, version] of versions) {
        if (!changed.some((path) => key === path || isPathInside(key, path))) continue
        versions.set(key, version + 1)
        dropCached(key)
        forgot = true
    }
    if (!forgot) return
    for (const listener of listeners) listener()
}
