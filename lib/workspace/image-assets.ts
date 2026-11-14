import { exists, writeFile } from '@tauri-apps/plugin-fs'
import {
    PathExistsError,
    comparablePath,
    createWorkspaceDirectory,
    duplicateWorkspaceFile,
    getBaseName,
    getParentPath,
    isPathInside,
    joinPath,
    listFolderNames,
    normalizePath,
} from '@/lib/tauri/fs'
import { uniqueNewName } from '@/lib/workspace/paths'

/** The pictures the preview and exports show (read_workspace_image), and the extension each is saved with. */
const IMAGE_EXTENSIONS: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
}
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i

/** True for a picture the preview shows, by its extension. */
export function isImageFile(name: string): boolean {
    return IMAGE_FILE.test(name)
}

/**
 * A name for a pasted picture of `type`, from when it was pasted: `image-20261103-090507.png`. Null for a type
 * the preview can't show.
 */
export function pastedImageName(type: string, when: Date): string | null {
    const extension = IMAGE_EXTENSIONS[type.toLowerCase()]
    if (!extension) return null
    const two = (n: number) => String(n).padStart(2, '0')
    const day = `${when.getFullYear()}${two(when.getMonth() + 1)}${two(when.getDate())}`
    const time = `${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`
    return `image-${day}-${time}${extension}`
}

/** Characters that would end or break a link's address, or that the preview reads as `%` codes, `#` or `?`. */
const LINK_UNSAFE = /[\s%#?()<>[\]]/g

/** The way from `folder` to `path`, with `/` between names: `../img/a.png`. */
function relativePath(folder: string, path: string): string {
    const from = normalizePath(folder).split(/[\\/]/).filter(Boolean)
    const to = normalizePath(path).split(/[\\/]/).filter(Boolean)
    const fromKeys = comparablePath(folder).split(/[\\/]/).filter(Boolean)
    const toKeys = comparablePath(path).split(/[\\/]/).filter(Boolean)
    let shared = 0
    while (shared < from.length && shared < to.length - 1 && fromKeys[shared] === toKeys[shared]) shared += 1
    return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
}

/** The Markdown that shows `imagePath` in the document at `documentPath`: `![chart](assets/chart.png)`. */
export function markdownImage(documentPath: string, imagePath: string): string {
    const alt = getBaseName(imagePath)
        .replace(/\.[^.]*$/, '')
        .replace(/[[\]\\]/g, '\\$&')
    const address = relativePath(getParentPath(documentPath), imagePath).replace(
        LINK_UNSAFE,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
    )
    return `![${alt}](${address})`
}

/** The folder next to a document that its pasted and dropped images go in. */
const ASSETS_FOLDER = 'assets'
/** Tries at a free name, should another app keep taking the one picked. */
const MAX_NAME_TRIES = 5

/**
 * Makes the document's assets folder if it isn't there yet. Returns its path, spelt as on disk: an `Assets` folder
 * already there is used as `Assets`, so links to it still work where letter case matters (GitHub).
 */
async function assetsFolderOf(documentPath: string): Promise<string> {
    const parent = getParentPath(documentPath)
    const existing = (await listFolderNames(parent)).find((name) => name.toLowerCase() === ASSETS_FOLDER)
    const folder = joinPath(parent, existing ?? ASSETS_FOLDER)
    if (existing) return folder
    try {
        await createWorkspaceDirectory(folder)
    } catch (err) {
        if (!(err instanceof PathExistsError) && !(await exists(folder))) throw err
    }
    return folder
}

/**
 * Writes a new file in `folder` under `name`, or `name 2`, `name 3`… when that is taken. `write` must refuse to
 * replace a file, so one that turns up meanwhile is never lost: the next free name is tried instead.
 */
async function writeUnderFreeName(folder: string, name: string, write: (path: string) => Promise<void>): Promise<string> {
    for (let tries = 1; ; tries += 1) {
        const path = joinPath(folder, uniqueNewName(name, await listFolderNames(folder)))
        try {
            await write(path)
            return path
        } catch (err) {
            if (tries >= MAX_NAME_TRIES || !(await exists(path))) throw err
        }
    }
}

/**
 * Saves a new image in the `assets` folder next to the document (made if needed), under `name` or the next free
 * name. Never replaces a file. Resolves to the image's path.
 */
export async function saveImageInAssets(documentPath: string, name: string, bytes: Uint8Array): Promise<string> {
    const folder = await assetsFolderOf(documentPath)
    return writeUnderFreeName(folder, name, (path) => writeFile(path, bytes, { createNew: true }))
}

/** A Markdown file in the open folder that images can be added to. */
export type ImageDocument = { path: string; workspaceRoot: string }

/**
 * An image file dropped onto `doc`. One already in the open folder is linked where it is; one from outside is
 * copied into the `assets` folder next to the document, under its own name or the next free one. Resolves to the
 * path to link.
 */
export async function addDroppedImage(sourcePath: string, doc: ImageDocument): Promise<string> {
    if (isPathInside(sourcePath, doc.workspaceRoot)) return normalizePath(sourcePath)
    const folder = await assetsFolderOf(doc.path)
    return writeUnderFreeName(folder, getBaseName(sourcePath), (path) => duplicateWorkspaceFile(sourcePath, path))
}
