import { DiskChangedError, getBaseName, isFileMissingError, samePath, type TextFileRead, type WriteWorkspaceFileOptions } from '@/lib/tauri/fs'
import type { TextDecodeIssue } from '@/lib/workspace/text-encoding'
import type { TextEdit } from '@/lib/workspace/text-edits'
import type { FileStamp } from '@/lib/workspace/types'
import { REGEX_FILE_TIME_LIMIT_MS, replaceFile as defaultReplaceFile, type ReplaceFile } from '@/components/studio/command-palette/regex-match-client'
import {
    applyReplacements,
    findReplacements,
    replacementEdits,
    replacementSignature,
    type TextReplacement,
} from '@/components/studio/command-palette/replace-text'
import { MAX_FILE_BYTES, READ_CONCURRENCY } from '@/components/studio/command-palette/search-content'
import { REGEX_MAX_LINE_LENGTH, type TextMatcher } from '@/components/studio/command-palette/text-matcher'

/**
 * Replace in Workspace's passes over the files, kept apart from the palette so they can be tested on their own:
 * the uncapped count Replace All confirms, the run that then makes the changes, and why a file was left alone.
 * Files and tabs are reached only through what the caller passes in.
 *
 * Data safety comes first. An open tab is only ever changed in its buffer (applyTabEdits, one undo step), never
 * written here, and the tab list is read again for each file, so a file opened since the count goes that way too.
 * A file that isn't open is read again, its matches worked out again and compared with what was counted, and
 * written atomically in its own encoding, refused if it changed on disk since it was read.
 */

/** Why a file was left as it was. */
export type ReplaceSkipReason =
    | 'read-only'
    | 'example'
    | 'too-large'
    | 'unreadable'
    /** Read as Windows-1252: writing it back would turn it into UTF-8. */
    | 'encoding'
    | 'binary'
    /** Its matches aren't the ones counted (or shown) any more. */
    | 'changed'
    /** Changed or deleted on disk between reading and writing it. */
    | 'disk-changed'
    | 'timed-out'
    | 'unavailable'
    | 'not-opened'
    | 'failed'

export type ReplaceSkip = { path: string; reason: ReplaceSkipReason; detail?: string }

const SKIP_REASONS: Record<ReplaceSkipReason, string> = {
    'read-only': 'it is open read-only',
    example: "it is an example, which can't be changed",
    'too-large': `it is larger than ${MAX_FILE_BYTES / 1_048_576} MB`,
    unreadable: "it couldn't be read",
    encoding: "it isn't saved as UTF-8 or UTF-16, so Scrivon only reads it",
    binary: "it doesn't look like text",
    changed: 'its text changed since the matches were found',
    'disk-changed': 'it was changed or deleted outside Scrivon while it was being replaced',
    'timed-out': 'the regular expression took too long on it',
    unavailable: "regular expressions aren't available",
    'not-opened': "it couldn't be opened",
    failed: "it couldn't be saved",
}

/** Why a file was skipped, as a phrase: 'it is open read-only'. */
export function describeSkip(skip: Pick<ReplaceSkip, 'reason' | 'detail'>): string {
    const reason = SKIP_REASONS[skip.reason]
    return skip.detail ? `${reason}: ${skip.detail}` : reason
}

/** An open tab, as far as Replace needs to know. */
export type ReplaceTab = { id: string; path: string; content: string; readOnly?: boolean; encodingIssue?: TextDecodeIssue }

/** The open tab for `path`, however either spells it (C:\Notes\A.md and c:/notes/a.md are one file). */
export function findOpenTab<T extends { path: string }>(tabs: readonly T[], path: string): T | undefined {
    return tabs.find((tab) => samePath(tab.path, path))
}

/** Why an open tab can't take a replacement, or null when it can. */
export function tabSkipReason(tab: ReplaceTab, isExample: (tabId: string) => boolean): ReplaceSkipReason | null {
    if (isExample(tab.id)) return 'example'
    if (!tab.readOnly) return null
    // Opened read-only to keep it as it is stored: saying why tells the user more than 'read-only'.
    if (tab.encodingIssue) return tab.encodingIssue === 'binary' ? 'binary' : 'encoding'
    return 'read-only'
}

export type ComputeReplacementsOptions = {
    matcher: TextMatcher
    replacement: string
    /** Used in regex mode, so the pattern runs in the worker, never on this thread. */
    replaceFile?: ReplaceFile
    regexTimeLimitMs?: number
    signal?: AbortSignal
}

export type ComputedReplacements =
    { ok: true; replacements: TextReplacement[]; longLinesSkipped: number } | { ok: false; reason: 'timed-out' | 'unavailable' | 'aborted' }

/** Every match in `text` and what it becomes, with no cap: on this thread for plain text, in the worker for a regex. */
export async function computeReplacements(text: string, opts: ComputeReplacementsOptions): Promise<ComputedReplacements> {
    const { matcher, replacement, replaceFile = defaultReplaceFile, regexTimeLimitMs = REGEX_FILE_TIME_LIMIT_MS, signal } = opts
    if (!matcher.options.useRegex) return { ok: true, ...findReplacements(text, matcher, replacement) }
    const result = await replaceFile(text, matcher.query, matcher.options, replacement, { timeLimitMs: regexTimeLimitMs, signal })
    if (result.type === 'replacements') return { ok: true, replacements: result.replacements, longLinesSkipped: result.longLinesSkipped }
    if (result.type === 'timedOut') return { ok: false, reason: 'timed-out' }
    if (result.type === 'aborted') return { ok: false, reason: 'aborted' }
    // An invalid pattern never gets here: the palette compiles it first.
    return { ok: false, reason: 'unavailable' }
}

/** Lets the window draw and take keys between files, once `budgetMs` of work has gone by since it last did. */
export function createYielder(budgetMs = 12, now: () => number = () => performance.now()): () => Promise<void> {
    let last = now()
    return async () => {
        if (now() - last < budgetMs) return
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        last = now()
    }
}

/** One file Replace All will change, as counted. */
export type PlannedFile = {
    path: string
    /** Open in a tab when counted ('buffer'), or read from disk. The route is decided again when it is changed. */
    source: 'buffer' | 'disk'
    count: number
    /** Its matches and their results when counted, so a file whose matches changed since is left alone. */
    signature: string
}

export type ReplacePlan = {
    files: PlannedFile[]
    /** Every match in `files`. */
    totalMatches: number
    /** Files with matches that won't be changed, and files that couldn't be looked at. */
    skipped: ReplaceSkip[]
    /** Lines a regex search left out for being longer than REGEX_MAX_LINE_LENGTH. */
    longLinesSkipped: number
}

export type PlanResult =
    | { type: 'plan'; plan: ReplacePlan }
    /** A regex took too long on a file, or the worker isn't there, so the count can't be trusted: nothing is replaced. */
    | { type: 'stopped'; reason: 'timed-out' | 'unavailable'; path: string }
    | { type: 'aborted' }

export type PlanWorkspaceReplaceOptions = ComputeReplacementsOptions & {
    /** The workspace's files, in the order the results list them. */
    paths: readonly string[]
    /** The open tabs now. */
    tabs: readonly ReplaceTab[]
    isExample: (tabId: string) => boolean
    readTextFile: (path: string) => Promise<TextFileRead>
    /** The file's size and modified time, so a file too big to search isn't read. Null when unknown. */
    getFileStamp?: (path: string) => Promise<FileStamp | null>
    signal: AbortSignal
    /** Files looked at so far, of all of them. */
    onProgress?: (done: number, total: number) => void
    maxFileBytes?: number
    concurrency?: number
    yieldToUi?: () => Promise<void>
}

type FileCount = { file?: PlannedFile; skip?: ReplaceSkip; longLinesSkipped: number; stop?: { reason: 'timed-out' | 'unavailable'; path: string } }

/**
 * The fresh, uncapped pass Replace All confirms with: every file with matches, how many, and which files will
 * be left alone and why. Open tabs (as the search does) come first, then the files that aren't open.
 */
export async function planWorkspaceReplace(opts: PlanWorkspaceReplaceOptions): Promise<PlanResult> {
    const {
        paths,
        tabs,
        isExample,
        readTextFile,
        getFileStamp,
        signal,
        onProgress,
        maxFileBytes = MAX_FILE_BYTES,
        concurrency = READ_CONCURRENCY,
        yieldToUi = createYielder(),
    } = opts
    // Examples aren't searched, so they aren't counted either.
    const openTabs = tabs.filter((tab) => !isExample(tab.id))
    const diskPaths = paths.filter((path) => !findOpenTab(tabs, path))
    const total = openTabs.length + diskPaths.length
    let done = 0
    const step = () => onProgress?.(++done, total)

    const count = async (path: string, text: string, source: PlannedFile['source']): Promise<FileCount> => {
        const computed = await computeReplacements(text, { ...opts, signal })
        if (!computed.ok)
            return computed.reason === 'aborted' ? { longLinesSkipped: 0 } : { longLinesSkipped: 0, stop: { reason: computed.reason, path } }
        const { replacements, longLinesSkipped } = computed
        if (replacements.length === 0) return { longLinesSkipped }
        return { file: { path, source, count: replacements.length, signature: replacementSignature(replacements) }, longLinesSkipped }
    }

    const countTab = async (tab: ReplaceTab): Promise<FileCount> => {
        const counted = await count(tab.path, tab.content, 'buffer')
        const reason = counted.file ? tabSkipReason(tab, isExample) : null
        if (reason) return { ...counted, file: undefined, skip: { path: tab.path, reason } }
        return counted
    }

    const countDiskFile = async (path: string): Promise<FileCount> => {
        try {
            const stamp = getFileStamp ? await getFileStamp(path) : null
            if (stamp && stamp.size > maxFileBytes) return { skip: { path, reason: 'too-large' }, longLinesSkipped: 0 }
            const read = await readTextFile(path)
            if (read.content.length > maxFileBytes) return { skip: { path, reason: 'too-large' }, longLinesSkipped: 0 }
            const counted = await count(path, read.content, 'disk')
            // A file that can't be written back safely is only mentioned when it has something to replace.
            if (counted.file && read.issue)
                return { ...counted, file: undefined, skip: { path, reason: read.issue === 'binary' ? 'binary' : 'encoding' } }
            return counted
        } catch {
            return { skip: { path, reason: 'unreadable' }, longLinesSkipped: 0 }
        }
    }

    const results: FileCount[] = []
    for (const tab of openTabs) {
        if (signal.aborted) return { type: 'aborted' }
        results.push(await countTab(tab))
        step()
        await yieldToUi()
    }

    // Files are read a few at a time, and kept in their place in the list whichever read finishes first.
    let next = 0
    let stopped = false
    const diskResults: FileCount[] = []
    const worker = async () => {
        while (!signal.aborted && !stopped) {
            const index = next++
            if (index >= diskPaths.length) return
            const result = await countDiskFile(diskPaths[index]!)
            diskResults[index] = result
            if (result.stop) stopped = true
            step()
            await yieldToUi()
        }
    }
    if (!results.some((result) => result.stop)) {
        await Promise.all(Array.from({ length: Math.min(concurrency, diskPaths.length) }, () => worker()))
    }
    if (signal.aborted) return { type: 'aborted' }
    results.push(...diskResults.filter(Boolean))

    const stop = results.find((result) => result.stop)?.stop
    if (stop) return { type: 'stopped', ...stop }

    const files = results.flatMap((result) => (result.file ? [result.file] : []))
    return {
        type: 'plan',
        plan: {
            files,
            totalMatches: files.reduce((sum, file) => sum + file.count, 0),
            skipped: results.flatMap((result) => (result.skip ? [result.skip] : [])),
            longLinesSkipped: results.reduce((sum, result) => sum + result.longLinesSkipped, 0),
        },
    }
}

export type ReplacedFile = { path: string; count: number; route: 'buffer' | 'disk' }

export type ReplaceOutcome = {
    replaced: ReplacedFile[]
    replacedMatches: number
    skipped: ReplaceSkip[]
    longLinesSkipped: number
    /** Stopped part way by the user. What was replaced before stays replaced. */
    cancelled: boolean
}

export type ApplyWorkspaceReplaceOptions = ComputeReplacementsOptions & {
    plan: ReplacePlan
    /** The open tabs as they are at this moment: asked again for each file. */
    getTabs: () => readonly ReplaceTab[]
    isExample: (tabId: string) => boolean
    /** Changes an open tab as one undo step (the coordinator's applyTabEdits). False when it couldn't. */
    applyTabEdits: (tabId: string, edits: readonly TextEdit[]) => boolean | Promise<boolean>
    readTextFile: (path: string) => Promise<TextFileRead>
    /** writeWorkspaceFile: atomic, in the file's own encoding, refused with DiskChangedError if it changed since `expected`. */
    writeTextFile: (path: string, content: string, options: WriteWorkspaceFileOptions) => Promise<unknown>
    /** Keeps the file's text as it was before it is written, in Local History. Failing doesn't stop the write. */
    keepVersion?: (path: string, text: string) => Promise<unknown>
    /** A file that isn't open was just written. */
    onWritten?: (path: string) => void
    signal: AbortSignal
    /** Files done so far, of all of them. */
    onProgress?: (done: number, total: number) => void
    maxFileBytes?: number
    yieldToUi?: () => Promise<void>
}

/**
 * Makes the replacements Replace All confirmed, one file at a time, letting the window draw in between. Stops
 * before the next file once `signal` is aborted; files already changed stay changed and are listed.
 */
export async function applyWorkspaceReplace(opts: ApplyWorkspaceReplaceOptions): Promise<ReplaceOutcome> {
    const {
        plan,
        getTabs,
        isExample,
        applyTabEdits,
        readTextFile,
        writeTextFile,
        keepVersion,
        onWritten,
        signal,
        onProgress,
        maxFileBytes = MAX_FILE_BYTES,
        yieldToUi = createYielder(),
    } = opts
    const outcome: ReplaceOutcome = { replaced: [], replacedMatches: 0, skipped: [], longLinesSkipped: plan.longLinesSkipped, cancelled: false }
    const skip = (path: string, reason: ReplaceSkipReason, detail?: string) =>
        outcome.skipped.push(detail ? { path, reason, detail } : { path, reason })
    const replaced = (path: string, count: number, route: ReplacedFile['route']) => {
        outcome.replaced.push({ path, count, route })
        outcome.replacedMatches += count
    }

    /** The file's replacements now, or why it is left alone: they must be the ones counted. */
    const replacementsNow = async (planned: PlannedFile, text: string): Promise<TextReplacement[] | ReplaceSkipReason | null> => {
        const computed = await computeReplacements(text, { ...opts, signal })
        if (!computed.ok) return computed.reason === 'aborted' ? null : computed.reason
        if (replacementSignature(computed.replacements) !== planned.signature) return 'changed'
        return computed.replacements
    }

    const replaceInTab = async (planned: PlannedFile, tab: ReplaceTab) => {
        const reason = tabSkipReason(tab, isExample)
        if (reason) return skip(planned.path, reason)
        const now = await replacementsNow(planned, tab.content)
        if (now === null) return
        if (typeof now === 'string') return skip(planned.path, now)
        // The tab may have changed while the worker worked: its text then has to be the same one.
        const current = findOpenTab(getTabs(), planned.path)
        if (!current || current.id !== tab.id || current.content !== tab.content) return skip(planned.path, 'changed')
        if (await applyTabEdits(tab.id, replacementEdits(tab.content, now))) replaced(planned.path, now.length, 'buffer')
        else skip(planned.path, 'read-only')
    }

    const replaceOnDisk = async (planned: PlannedFile) => {
        let read: TextFileRead
        try {
            read = await readTextFile(planned.path)
        } catch (err) {
            return isFileMissingError(err) ? skip(planned.path, 'disk-changed') : skip(planned.path, 'unreadable')
        }
        if (read.issue) return skip(planned.path, read.issue === 'binary' ? 'binary' : 'encoding')
        if (read.content.length > maxFileBytes) return skip(planned.path, 'too-large')
        const now = await replacementsNow(planned, read.content)
        if (now === null) return
        if (typeof now === 'string') return skip(planned.path, now)
        // Opened while its matches were worked out: the tab is the one to change.
        const opened = findOpenTab(getTabs(), planned.path)
        if (opened) return replaceInTab(planned, opened)
        if (signal.aborted) return
        try {
            await keepVersion?.(planned.path, read.content)
        } catch (err) {
            console.warn(`Couldn't keep the old version of ${planned.path} in Local History`, err)
        }
        try {
            await writeTextFile(planned.path, applyReplacements(read.content, now), { format: read.format, expected: read.stamp })
        } catch (err) {
            if (err instanceof DiskChangedError) return skip(planned.path, 'disk-changed')
            return skip(planned.path, 'failed', err instanceof Error ? err.message : String(err))
        }
        replaced(planned.path, now.length, 'disk')
        onWritten?.(planned.path)
    }

    const total = plan.files.length
    for (let index = 0; index < total; index++) {
        if (signal.aborted) break
        const planned = plan.files[index]!
        // Read again for each file: a file opened since the count is changed in its tab, never on disk.
        const tab = findOpenTab(getTabs(), planned.path)
        if (tab) await replaceInTab(planned, tab)
        else await replaceOnDisk(planned)
        onProgress?.(index + 1, total)
        await yieldToUi()
    }
    outcome.cancelled = signal.aborted && outcome.replaced.length + outcome.skipped.length < total
    return outcome
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`
}

/** File names for a notice, with the rest counted once there are too many to list. */
function nameList(paths: readonly string[], max = 5): string {
    const names = paths.slice(0, max).map(getBaseName)
    const rest = paths.length - names.length
    return rest > 0 ? `${names.join(', ')} and ${plural(rest, 'other')}` : names.join(', ')
}

/** Each skipped file with why, for a notice: 'old.md (it isn't saved as UTF-8…)'. */
function skipList(skipped: readonly ReplaceSkip[], max = 5): string {
    const shown = skipped.slice(0, max).map((s) => `${getBaseName(s.path)} (${describeSkip(s)})`)
    const rest = skipped.length - shown.length
    return rest > 0 ? `${shown.join('; ')}; and ${plural(rest, 'other')}` : shown.join('; ')
}

export type ReplaceNotice = { message: string; details: string[] }

/** What the notice after a replace says: how many matches were replaced, and which files were skipped and why. */
export function describeOutcome(outcome: ReplaceOutcome, total?: number): ReplaceNotice {
    const files = outcome.replaced.length
    let message: string
    if (outcome.cancelled) {
        message = `Replace All stopped after ${plural(files + outcome.skipped.length, 'file')}${total !== undefined ? ` of ${total.toLocaleString('en-GB')}` : ''}. Replaced ${plural(outcome.replacedMatches, 'match', 'matches')}.`
    } else if (files === 0) {
        message = outcome.skipped.length > 0 ? 'Nothing was replaced.' : 'No matches to replace.'
    } else if (files === 1) {
        message = `Replaced ${plural(outcome.replacedMatches, 'match', 'matches')} in ${getBaseName(outcome.replaced[0]!.path)}.`
    } else {
        message = `Replaced ${plural(outcome.replacedMatches, 'match', 'matches')} in ${plural(files, 'file')}.`
    }
    const details: string[] = []
    if (outcome.cancelled && files > 0) details.push(`Already replaced in ${nameList(outcome.replaced.map((r) => r.path))}.`)
    if (outcome.skipped.length > 0) details.push(`Skipped ${plural(outcome.skipped.length, 'file')}: ${skipList(outcome.skipped)}.`)
    if (outcome.longLinesSkipped > 0) {
        details.push(
            `Left ${plural(outcome.longLinesSkipped, 'line')} longer than ${REGEX_MAX_LINE_LENGTH.toLocaleString('en-GB')} characters unchanged.`
        )
    }
    return { message, details }
}
