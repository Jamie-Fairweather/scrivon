import { createYielder, findOpenTab } from '@/components/studio/command-palette/replace-content'
import { MAX_FILE_BYTES, openTabText, READ_CONCURRENCY } from '@/components/studio/command-palette/search-content'
import {
    comparablePath,
    createLimit,
    DiskChangedError,
    getBaseName,
    isFileMissingError,
    isMarkdownFile,
    normalizePath,
    type TextFileRead,
    type WriteWorkspaceFileOptions,
} from '@/lib/tauri/fs'
import { isLargeFile } from '@/lib/workspace/document-tab'
import { buildLinkIndex, lookupLinkTarget } from '@/lib/workspace/link-index'
import {
    applyRewrites,
    mightLinkTo,
    planLinkRewrites,
    rewriteEdits,
    rewriteSignature,
    type LinkRewrite,
    type PathMove,
} from '@/lib/workspace/link-rewrite'
import { collectFilePaths, collectUnreadableFolders, isTreeTruncated } from '@/lib/workspace/paths'
import { remapPathAfterRename } from '@/lib/workspace/tab-paths'
import type { TextDecodeIssue } from '@/lib/workspace/text-encoding'
import type { TextEdit } from '@/lib/workspace/text-edits'
import type { FileNode, FileStamp } from '@/lib/workspace/types'

/**
 * Offering to update links after a rename or move: the scan of the folder's Markdown files that finds the links the
 * move broke (planLinkRewrites), and the pass that changes them once the user says so. Files and tabs are reached
 * only through what the caller passes in, so both can be tested without the app.
 *
 * Data safety comes first. Each file is planned again from its text as it is when it is changed, and left alone
 * when its links aren't the ones shown. An open tab changes only in its buffer (applyTabEdits, one undo step); a
 * file that isn't open is written atomically in its own encoding, refused if it changed on disk since it was read.
 * A file that would open read-only (an encoding problem, or too big) is never changed, open or not.
 */

/** A rename or move that has happened, with the folder's tree from before it. */
export type LinkMove = PathMove & {
    /** The open folder it happened in. */
    root: string
    isDirectory: boolean
    /** The explorer's tree from before the move, so every path in it is an old one. */
    tree: readonly FileNode[]
}

/** An open tab, as far as link updates need to know. */
export type LinkUpdateTab = {
    id: string
    path: string
    content: string
    readOnly?: boolean
    encodingIssue?: TextDecodeIssue
    largeFile?: true
}

/** Why a file that links to the moved item is left as it is. */
export type LinkUpdateSkipReason =
    | 'read-only'
    /** Read as Windows-1252: writing it back would turn it into UTF-8. */
    | 'encoding'
    | 'binary'
    | 'too-large'
    /** Its links aren't the ones shown any more. */
    | 'changed'
    /** Changed or deleted on disk between reading and writing it. */
    | 'disk-changed'
    | 'unreadable'
    | 'failed'

export type LinkUpdateSkip = { path: string; reason: LinkUpdateSkipReason; detail?: string }

const SKIP_REASONS: Record<LinkUpdateSkipReason, string> = {
    'read-only': 'it is open read-only',
    encoding: "it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it",
    binary: "it doesn't look like text",
    'too-large': 'it is too big to change here',
    changed: 'its links changed since they were listed',
    'disk-changed': 'it was changed or deleted outside Scrivon',
    unreadable: "it couldn't be read",
    failed: "it couldn't be saved",
}

/** Why a file was left alone, as a phrase: 'it is open read-only'. */
export function describeLinkSkip(skip: Pick<LinkUpdateSkip, 'reason' | 'detail'>): string {
    const reason = SKIP_REASONS[skip.reason]
    return skip.detail ? `${reason}: ${skip.detail}` : reason
}

/** One file whose links the move broke, as scanned. */
export type LinkUpdateFile = {
    /** Where the file is now. */
    path: string
    /** Where it was before the move (the same unless it moved too). */
    oldPath: string
    rewrites: LinkRewrite[]
    /** What its rewrites were, so a file whose links changed since is left alone (rewriteSignature). */
    signature: string
}

export type LinkUpdateScan = {
    move: LinkMove
    /** The files to change, in the tree's order. */
    files: LinkUpdateFile[]
    /** Files with links to change that won't be changed, and why (a read-only tab, a Windows-1252 file). */
    blocked: Array<LinkUpdateSkip & { file: LinkUpdateFile }>
    /** Markdown files that weren't looked at: over the size limit, or unreadable. */
    unchecked: number
    /** The tree wasn't listed in full (too many entries, or folders that couldn't be read), so files may be missing from it. */
    partialTree: boolean
    /** Whether a target is there, as asked during the scan, for planning again (see applyLinkUpdates). */
    targetExists: (oldTarget: string) => Promise<boolean>
}

export type ScanLinkUpdatesOptions = {
    move: LinkMove
    /** The open tabs now: asked again for each file, so a file opened meanwhile is read from its tab. */
    getTabs: () => readonly LinkUpdateTab[]
    readTextFile: (path: string) => Promise<TextFileRead>
    /** The file's size and modified time; null when it can't be looked at (or isn't there). */
    readStamp: (path: string) => Promise<FileStamp | null>
    signal?: AbortSignal
    maxFileBytes?: number
    concurrency?: number
    yieldToUi?: () => Promise<void>
}

/** Why a file can't be changed even though it has links to change, or null when it can. */
function tabBlock(tab: LinkUpdateTab): LinkUpdateSkipReason | null {
    if (tab.encodingIssue) return tab.encodingIssue === 'binary' ? 'binary' : 'encoding'
    if (tab.largeFile) return 'too-large'
    return tab.readOnly ? 'read-only' : null
}

function readBlock(read: TextFileRead): LinkUpdateSkipReason | null {
    if (read.issue) return read.issue === 'binary' ? 'binary' : 'encoding'
    return isLargeFile(read.stamp?.size) ? 'too-large' : null
}

/**
 * Whether a link's target is there, by where it was before the move: from the tree, or (for a target the tree
 * doesn't list, in a hidden folder or one it didn't read) from the disk, where it now is. Each path is asked once.
 */
function createTargetCheck(move: LinkMove, readStamp: ScanLinkUpdatesOptions['readStamp'], concurrency: number) {
    const index = buildLinkIndex(move.root, move.tree)
    const answers = new Map<string, Promise<boolean>>()
    const limit = createLimit(concurrency)
    return (oldTarget: string): Promise<boolean> => {
        if (lookupLinkTarget(index, oldTarget).kind === 'found') return Promise.resolve(true)
        const key = comparablePath(oldTarget)
        let answer = answers.get(key)
        if (!answer) {
            const where = remapPathAfterRename(oldTarget, move.oldPath, move.newPath)
            answer = limit(() => readStamp(where)).then(
                (stamp) => stamp !== null,
                () => false
            )
            answers.set(key, answer)
        }
        return answer
    }
}

/**
 * Looks through the open folder's Markdown files (from the tree as it was before the move) for links the move broke,
 * a few files at a time. An open tab's text is used rather than the disk. Files over `maxFileBytes` aren't read.
 */
export async function scanLinkUpdates(opts: ScanLinkUpdatesOptions): Promise<LinkUpdateScan> {
    const {
        move,
        getTabs,
        readTextFile,
        readStamp,
        signal,
        maxFileBytes = MAX_FILE_BYTES,
        concurrency = READ_CONCURRENCY,
        yieldToUi = createYielder(),
    } = opts
    const targetExists = createTargetCheck(move, readStamp, concurrency)
    const movedName = getBaseName(move.oldPath)
    const oldPaths = [...collectFilePaths(move.tree as FileNode[])].filter((path) => isMarkdownFile(path))
    const scan: LinkUpdateScan = {
        move,
        files: [],
        blocked: [],
        unchecked: 0,
        partialTree: isTreeTruncated(move.tree as FileNode[]) || collectUnreadableFolders(move.tree as FileNode[]).length > 0,
        targetExists,
    }

    type Found = { file: LinkUpdateFile; block: LinkUpdateSkipReason | null } | 'unchecked' | null
    const scanFile = async (oldPath: string): Promise<Found> => {
        const path = remapPathAfterRename(oldPath, move.oldPath, move.newPath)
        const moved = normalizePath(path) !== normalizePath(oldPath)
        const tabs = getTabs()
        let text = openTabText(tabs, path)
        let block: LinkUpdateSkipReason | null = null
        if (text !== undefined) {
            if (text.length > maxFileBytes) return 'unchecked'
            const tab = findOpenTab(tabs, path)
            block = tab ? tabBlock(tab) : null
        } else {
            try {
                const stamp = await readStamp(path)
                if (stamp && stamp.size > maxFileBytes) return 'unchecked'
                const read = await readTextFile(path)
                if (read.content.length > maxFileBytes) return 'unchecked'
                text = read.content
                block = readBlock(read)
            } catch {
                return 'unchecked'
            }
        }
        // A file that didn't move can only break by naming the moved item; most files are passed over unparsed.
        if (!moved && !mightLinkTo(text, movedName)) return null
        const rewrites = await planLinkRewrites(text, { workspaceRoot: move.root, oldFilePath: oldPath, move, targetExists })
        if (rewrites.length === 0) return null
        return { file: { path, oldPath, rewrites, signature: rewriteSignature(rewrites) }, block }
    }

    // A few files at a time, each kept in its place in the tree's order whichever read finishes first.
    const found: Found[] = []
    let next = 0
    const worker = async () => {
        while (!signal?.aborted) {
            const index = next++
            if (index >= oldPaths.length) return
            found[index] = await scanFile(oldPaths[index]!)
            await yieldToUi()
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, oldPaths.length) }, () => worker()))

    for (const result of found) {
        if (result === 'unchecked') scan.unchecked++
        else if (result?.block) scan.blocked.push({ path: result.file.path, reason: result.block, file: result.file })
        else if (result) scan.files.push(result.file)
    }
    return scan
}

export type ApplyLinkUpdatesOptions = {
    scan: LinkUpdateScan
    /** The open tabs as they are at this moment: asked again for each file. */
    getTabs: () => readonly LinkUpdateTab[]
    /** Changes an open tab as one undo step (the coordinator's applyTabEdits). False when it couldn't. */
    applyTabEdits: (tabId: string, edits: readonly TextEdit[]) => boolean | Promise<boolean>
    readTextFile: (path: string) => Promise<TextFileRead>
    /** writeWorkspaceFile: atomic, in the file's own encoding, refused with DiskChangedError if it changed since `expected`. */
    writeTextFile: (path: string, content: string, options: WriteWorkspaceFileOptions) => Promise<unknown>
    /** Keeps the file's text as it was before it is written, in Local History. Failing doesn't stop the write. */
    keepVersion?: (path: string, text: string) => Promise<unknown>
    /** A file that isn't open was just written. */
    onWritten?: (path: string) => void
    maxFileBytes?: number
}

export type LinkUpdateOutcome = {
    /** The files changed, and how many links in each. */
    updated: Array<{ path: string; links: number }>
    skipped: LinkUpdateSkip[]
}

/**
 * Makes the link changes the user agreed to. Each file is planned again from its text now (its tab's if it is open
 * now, otherwise the disk's): a file whose links aren't the ones shown is left alone, never edited at old places.
 */
export async function applyLinkUpdates(opts: ApplyLinkUpdatesOptions): Promise<LinkUpdateOutcome> {
    const { scan, getTabs, applyTabEdits, readTextFile, writeTextFile, keepVersion, onWritten, maxFileBytes = MAX_FILE_BYTES } = opts
    const { move, targetExists } = scan
    const outcome: LinkUpdateOutcome = { updated: [], skipped: scan.blocked.map(({ path, reason }) => ({ path, reason })) }
    const skip = (path: string, reason: LinkUpdateSkipReason, detail?: string) =>
        outcome.skipped.push(detail ? { path, reason, detail } : { path, reason })

    /** The file's rewrites in `text`, or null when they aren't the ones shown. */
    const replan = async (file: LinkUpdateFile, text: string): Promise<LinkRewrite[] | null> => {
        const rewrites = await planLinkRewrites(text, { workspaceRoot: move.root, oldFilePath: file.oldPath, move, targetExists })
        return rewriteSignature(rewrites) === file.signature ? rewrites : null
    }

    const updateTab = async (file: LinkUpdateFile, tab: LinkUpdateTab) => {
        const block = tabBlock(tab)
        if (block) return skip(file.path, block)
        if (tab.content.length > maxFileBytes) return skip(file.path, 'too-large')
        const rewrites = await replan(file, tab.content)
        if (!rewrites) return skip(file.path, 'changed')
        // Typed in while it was planned: its text has to be the one planned.
        const now = findOpenTab(getTabs(), file.path)
        if (!now || now.id !== tab.id || now.content !== tab.content) return skip(file.path, 'changed')
        if (await applyTabEdits(tab.id, rewriteEdits(tab.content, rewrites))) outcome.updated.push({ path: file.path, links: rewrites.length })
        else skip(file.path, 'read-only')
    }

    const updateOnDisk = async (file: LinkUpdateFile) => {
        let read: TextFileRead
        try {
            read = await readTextFile(file.path)
        } catch (err) {
            return skip(file.path, isFileMissingError(err) ? 'disk-changed' : 'unreadable')
        }
        const block = readBlock(read)
        if (block) return skip(file.path, block)
        if (read.content.length > maxFileBytes) return skip(file.path, 'too-large')
        const rewrites = await replan(file, read.content)
        if (!rewrites) return skip(file.path, 'changed')
        // Opened while it was read: the tab is the one to change, never the disk under it.
        const opened = findOpenTab(getTabs(), file.path)
        if (opened) return updateTab(file, opened)
        try {
            await keepVersion?.(file.path, read.content)
        } catch (err) {
            console.warn(`Couldn't keep the old version of ${file.path} in Local History`, err)
        }
        try {
            await writeTextFile(file.path, applyRewrites(read.content, rewrites), { format: read.format, expected: read.stamp })
        } catch (err) {
            if (err instanceof DiskChangedError) return skip(file.path, 'disk-changed')
            return skip(file.path, 'failed', err instanceof Error ? err.message : String(err))
        }
        outcome.updated.push({ path: file.path, links: rewrites.length })
        onWritten?.(file.path)
    }

    for (const file of scan.files) {
        const tab = findOpenTab(getTabs(), file.path)
        try {
            if (tab) await updateTab(file, tab)
            else await updateOnDisk(file)
        } catch (err) {
            // One file going wrong doesn't stop the rest, and the notice still lists what was changed.
            skip(file.path, 'failed', err instanceof Error ? err.message : String(err))
        }
    }
    return outcome
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`
}

/** Each skipped file with why: 'old.md (it is open read-only)'. */
function skipList(skipped: readonly LinkUpdateSkip[], max = 5): string {
    const shown = skipped.slice(0, max).map((s) => `${getBaseName(s.path)} (${describeLinkSkip(s)})`)
    const rest = skipped.length - shown.length
    return rest > 0 ? `${shown.join('; ')}; and ${plural(rest, 'other')}` : shown.join('; ')
}

/** Why some files weren't looked at, for the dialog and the notice; null when every file was. */
export function uncheckedNote(scan: Pick<LinkUpdateScan, 'unchecked' | 'partialTree'>): string | null {
    const reasons: string[] = []
    if (scan.unchecked > 0) reasons.push(`${plural(scan.unchecked, 'file')} ${scan.unchecked === 1 ? 'was' : 'were'} too big or couldn't be read`)
    if (scan.partialTree) reasons.push("Scrivon didn't list every file in this folder")
    return reasons.length > 0 ? `Some files weren't checked: ${reasons.join(', and ')}.` : null
}

export type LinkUpdateNotice = { kind: 'success' | 'warning'; title: string; description?: string }

/** What the notice after Update Links says: how many files were updated, and which weren't and why. */
export function describeLinkUpdateOutcome(outcome: LinkUpdateOutcome, scan: Pick<LinkUpdateScan, 'unchecked' | 'partialTree'>): LinkUpdateNotice {
    const files = outcome.updated.length
    const links = outcome.updated.reduce((sum, file) => sum + file.links, 0)
    const title =
        files === 0
            ? 'No links were updated'
            : files === 1
              ? `Updated ${plural(links, 'link')} in ${getBaseName(outcome.updated[0]!.path)}`
              : `Updated ${plural(links, 'link')} in ${plural(files, 'file')}`
    const details: string[] = []
    if (outcome.skipped.length > 0) details.push(`Not updated: ${skipList(outcome.skipped)}.`)
    const unchecked = uncheckedNote(scan)
    if (unchecked) details.push(unchecked)
    return {
        kind: outcome.skipped.length > 0 || files === 0 ? 'warning' : 'success',
        title,
        ...(details.length > 0 ? { description: details.join(' ') } : {}),
    }
}

/** The notice when every file that links to the moved item can't be changed, so there is nothing to ask. */
export function describeBlockedOnly(scan: LinkUpdateScan): LinkUpdateNotice {
    const name = getBaseName(scan.move.newPath)
    const unchecked = uncheckedNote(scan)
    return {
        kind: 'warning',
        title: `Links to ${name} weren't updated`,
        description: [`Not updated: ${skipList(scan.blocked)}.`, unchecked].filter(Boolean).join(' '),
    }
}
