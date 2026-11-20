import {
    MAX_FILE_BYTES,
    openTabText,
    READ_CONCURRENCY,
    type ContentCache,
    type OpenFileTexts,
} from '@/components/studio/command-palette/search-content'
import type { DocumentWikiLink } from '@/lib/markdown/document-links'
import { comparablePath } from '@/lib/tauri/fs'
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
    /** The line the link is on, without the spaces around it. */
    text: string
}

export type BacklinksResult = {
    /** The file the links lead to. */
    target: string
    links: Backlink[]
    /** The tree doesn't list every file (WikiIndex.incomplete), so there may be more. */
    incomplete: boolean
}

/** A note's wiki links, kept with the text they were read from, so an unchanged note isn't read again. */
export type ParsedLinksCache = Map<string, { text: string; links: readonly DocumentWikiLink[] }>

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
    /** Disk text kept between scans, used while a file's stamp is unchanged. */
    cache?: ContentCache
    parsed?: ParsedLinksCache
    signal: AbortSignal
    maxFileBytes?: number
    concurrency?: number
}

/** The line around `offset`, without the spaces around it. */
function lineAround(text: string, offset: number): string {
    const start = text.lastIndexOf('\n', offset - 1) + 1
    const end = text.indexOf('\n', offset)
    return text.slice(start, end < 0 ? text.length : end).trim()
}

/**
 * Every wiki link in the folder's other notes that leads to `target`, in the tree's order and then down each note. A
 * note open in a tab is read from the tab. The rest are read from disk `concurrency` at a time, skipping files over
 * `maxFileBytes`; one whose stamp hasn't changed comes from `cache`, and one whose text hasn't changed isn't parsed
 * again. Null once `signal` aborts: a newer scan took its place.
 */
export async function scanBacklinks({
    target,
    index,
    openTexts,
    readLinks,
    readFile,
    getFileStamp,
    cache,
    parsed,
    signal,
    maxFileBytes = MAX_FILE_BYTES,
    concurrency = READ_CONCURRENCY,
}: ScanBacklinksOptions): Promise<BacklinksResult | null> {
    const own = comparablePath(target)
    const notes = index.notes.filter((note) => comparablePath(note.path) !== own)
    const found: Backlink[][] = []

    const textOf = async (path: string): Promise<string | null> => {
        const inTab = openTabText(openTexts, path)
        if (inTab !== undefined) return inTab
        const stamp = await getFileStamp(path)
        if (stamp !== null && stamp.size > maxFileBytes) return null
        let text = stamp !== null ? cache?.get(path, stamp) : undefined
        if (text === undefined) {
            text = await readFile(path)
            if (stamp !== null) cache?.set(path, stamp, text)
        }
        return text.length > maxFileBytes ? null : text
    }

    const linksOf = async (path: string, text: string): Promise<readonly DocumentWikiLink[]> => {
        // Most notes have no wiki links at all: no need to parse them.
        if (!text.includes('[[')) return []
        const key = comparablePath(path)
        const kept = parsed?.get(key)
        if (kept && kept.text === text) return kept.links
        const links = await readLinks(text, path)
        parsed?.set(key, { text, links })
        return links
    }

    let next = 0
    const work = async () => {
        while (!signal.aborted) {
            const at = next++
            const note = notes[at]
            if (!note) return
            try {
                const text = await textOf(note.path)
                if (text === null || signal.aborted) continue
                const links = await linksOf(note.path, text)
                const leading: Backlink[] = []
                for (const link of links) {
                    if (!link.target) continue
                    const lookup = resolveWikiTarget(index, link.target, note.path)
                    if (lookup.kind !== 'found' || comparablePath(lookup.path) !== own) continue
                    const { line, column, offset } = link.position.start
                    leading.push({ path: note.path, relative: note.relative, line, column, text: lineAround(text, offset ?? 0) })
                }
                found[at] = leading
            } catch {
                // A note that can't be read (gone, locked) or parsed is left out; the rest still count.
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, notes.length) }, work))
    if (signal.aborted) return null
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
