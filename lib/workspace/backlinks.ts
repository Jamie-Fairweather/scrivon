import { buildPreview, MAX_FILE_BYTES, openTabText, READ_CONCURRENCY, type OpenFileTexts } from '@/components/studio/command-palette/search-content'
import type { DocumentWikiLink } from '@/lib/markdown/document-links'
import { comparablePath, stampChanged } from '@/lib/tauri/fs'
import type { FileStamp } from '@/lib/workspace/types'
import { resolveWikiTarget, type WikiIndex } from '@/lib/workspace/wiki-link-lookup'

/**
 * "Linked from": the other notes in the open folder whose wiki links lead to a file, found with the same lookup the
 * preview follows them by (resolveWikiTarget). Ordinary Markdown links aren't listed.
 */

/** A wiki link to the file, in another note. */
export type Backlink = {
    /** The note the link is in, as the tree spells it. */
    path: string
    /** Its path from the open folder, without `.md`: what the list shows. */
    relative: string
    /** Where the link is, from 1, as the editor counts. */
    line: number
    column: number
    /** The line the link is on, without the spaces around it (only the part around the link, on a very long line). */
    text: string
}

export type BacklinksResult = {
    /** The file the links lead to. */
    target: string
    links: Backlink[]
    /** The tree doesn't list every file (WikiIndex.incomplete), so there may be more. */
    incomplete: boolean
}

/** A wiki link as a scan keeps it between scans: what it leads to, where it is and its line, not the rest of the note. */
type KeptLink = { target: string; line: number; column: number; text: string }

/**
 * What a scan learnt about one note, so the next one needn't read or parse it again. A note read from disk keeps its
 * stamp and the disk check it was last looked at in (see ScanBacklinksOptions.diskCheck), never its text. A note read
 * from a tab keeps the tab's text, which the tab holds anyway, to tell when it changes.
 */
type KeptNote =
    | { source: 'disk'; stamp: FileStamp | null; checked: number | undefined; links: readonly KeptLink[] }
    | { source: 'tab'; text: string; links: readonly KeptLink[] }

/** The notes' links kept between scans, by comparablePath. A finished scan forgets the notes no longer in the index. */
export type BacklinksMemo = Map<string, KeptNote>

export function createBacklinksMemo(): BacklinksMemo {
    return new Map()
}

export type ScanBacklinksOptions = {
    /** The file whose links are wanted: the one showing. */
    target: string
    index: WikiIndex
    /** The open tabs' text, unsaved edits included, which counts over the disk's. */
    openTexts: OpenFileTexts
    /** A note's wiki links (in a worker: see createLinksReader), read from its text. */
    readLinks: (text: string, path: string) => Promise<readonly DocumentWikiLink[]>
    readFile: (path: string) => Promise<string>
    /** A file's size and modified time, or null when they can't be read. */
    getFileStamp: (path: string) => Promise<FileStamp | null>
    /** What earlier scans learnt, used and updated by this one. */
    memo?: BacklinksMemo
    /**
     * Which disk check this scan belongs to. A note on disk already looked at in the same check is taken from `memo`
     * without asking the disk again, so a scan for a change in a tab's text doesn't stat every file. Pass a new number
     * when the files on disk may have changed. Left out, every note on disk is stamped again.
     */
    diskCheck?: number
    signal: AbortSignal
    maxFileBytes?: number
    concurrency?: number
}

/** Longer lines are cut down to the part around the link, so a note written on one long line isn't kept whole. */
const MAX_LINE_CHARS = 300

/** The line around the link at `offset`, without the spaces around it. */
function lineAround(text: string, offset: number, length: number): string {
    const start = text.lastIndexOf('\n', offset - 1) + 1
    const end = text.indexOf('\n', offset)
    const line = text.slice(start, end < 0 ? text.length : end)
    if (line.length <= MAX_LINE_CHARS) return line.trim()
    return buildPreview(line, offset - start, length).preview.trim()
}

/**
 * Every wiki link in the folder's other notes that leads to `target`, in the tree's order and then down each note. A
 * note open in a tab is read from the tab. The rest are read from disk `concurrency` at a time, skipping files over
 * `maxFileBytes`. With a `memo`, a note whose stamp (or tab text) hasn't changed isn't read or parsed again, and one
 * already looked at in this `diskCheck` isn't stamped again either. Null once `signal` aborts: a newer scan took its
 * place (what this one learnt so far stays in `memo`).
 */
export async function scanBacklinks({
    target,
    index,
    openTexts,
    readLinks,
    readFile,
    getFileStamp,
    memo,
    diskCheck,
    signal,
    maxFileBytes = MAX_FILE_BYTES,
    concurrency = READ_CONCURRENCY,
}: ScanBacklinksOptions): Promise<BacklinksResult | null> {
    const own = comparablePath(target)
    const notes = index.notes.filter((note) => comparablePath(note.path) !== own)
    const found: Backlink[][] = []

    const linksIn = async (path: string, text: string): Promise<KeptLink[]> => {
        // Most notes have no wiki links at all: no need to parse them.
        if (text.length > maxFileBytes || !text.includes('[[')) return []
        const links = await readLinks(text, path)
        return links.map((link) => {
            const { line, column, offset = 0 } = link.position.start
            const length = (link.position.end.offset ?? offset) - offset
            return { target: link.target, line, column, text: lineAround(text, offset, length) }
        })
    }

    /** The note's links, or null when the scan was aborted before they were known. */
    const linksOf = async (path: string): Promise<readonly KeptLink[] | null> => {
        const key = comparablePath(path)
        const kept = memo?.get(key)
        const inTab = openTabText(openTexts, path)
        if (inTab !== undefined) {
            if (kept?.source === 'tab' && kept.text === inTab) return kept.links
            const links = await linksIn(path, inTab)
            memo?.set(key, { source: 'tab', text: inTab, links })
            return links
        }
        if (kept?.source === 'disk' && diskCheck !== undefined && kept.checked === diskCheck) return kept.links
        const stamp = await getFileStamp(path)
        if (signal.aborted) return null
        if (kept?.source === 'disk' && kept.stamp !== null && stamp !== null && !stampChanged(kept.stamp, stamp)) {
            memo?.set(key, { ...kept, checked: diskCheck })
            return kept.links
        }
        let links: KeptLink[] = []
        if (stamp === null || stamp.size <= maxFileBytes) {
            const text = await readFile(path)
            if (signal.aborted) return null
            links = await linksIn(path, text)
        }
        memo?.set(key, { source: 'disk', stamp, checked: diskCheck, links })
        return links
    }

    let next = 0
    const work = async () => {
        while (!signal.aborted) {
            const at = next++
            const note = notes[at]
            if (!note) return
            try {
                const links = await linksOf(note.path)
                if (links === null || signal.aborted) continue
                const leading: Backlink[] = []
                for (const link of links) {
                    if (!link.target) continue
                    const lookup = resolveWikiTarget(index, link.target, note.path)
                    if (lookup.kind !== 'found' || comparablePath(lookup.path) !== own) continue
                    leading.push({ path: note.path, relative: note.relative, line: link.line, column: link.column, text: link.text })
                }
                found[at] = leading
            } catch {
                // A note that can't be read (gone, locked) or parsed is left out; the rest still count.
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, notes.length) }, work))
    if (signal.aborted) return null
    if (memo) {
        // Notes deleted, renamed or moved out of the folder are forgotten.
        const listed = new Set(notes.map((note) => comparablePath(note.path)))
        for (const key of memo.keys()) if (!listed.has(key)) memo.delete(key)
    }
    return { target, links: found.flat(), incomplete: index.incomplete }
}

/** How long changes must pause before "Linked from" is worked out again. */
export const BACKLINKS_DELAY_MS = 300

export type BacklinksScanner<Input> = {
    /** Works the list out for `input` once requests pause, stopping any scan still running. */
    request: (input: Input) => void
    /** Stops the waiting and running scans. Nothing is reported after this until the next request. */
    cancel: () => void
}

/**
 * Runs `scan` for the newest request once requests pause for `delay`. A request stops the scan in progress at once
 * (its signal aborts), so only the newest scan's result is ever reported.
 */
export function createBacklinksScanner<Input>(
    scan: (input: Input, signal: AbortSignal) => Promise<BacklinksResult | null>,
    onResult: (result: BacklinksResult) => void,
    delay = BACKLINKS_DELAY_MS
): BacklinksScanner<Input> {
    let timer: ReturnType<typeof setTimeout> | null = null
    let running: AbortController | null = null

    const cancel = () => {
        if (timer !== null) clearTimeout(timer)
        timer = null
        running?.abort()
        running = null
    }

    return {
        request(input) {
            cancel()
            timer = setTimeout(() => {
                timer = null
                const controller = new AbortController()
                running = controller
                scan(input, controller.signal).then(
                    (result) => {
                        if (result && running === controller && !controller.signal.aborted) onResult(result)
                    },
                    () => {}
                )
            }, delay)
        },
        cancel,
    }
}
