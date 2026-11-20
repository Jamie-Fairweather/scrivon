import type { DocumentKind } from '@/lib/workspace/file-types'

export type PaletteMode = 'all' | 'files' | 'text'

export type ActionPaletteItem = {
    kind: 'action'
    value: string
    searchText: string
    label: string
    /** Muted second line, e.g. the full path of a recent folder. */
    detail?: string
    shortcut?: string
    /** Set for an on/off setting: whether it is on now. */
    checked?: boolean
    disabled?: boolean
    disabledReason?: string
    run: () => void | Promise<void>
}

export type TabPaletteItem = {
    kind: 'tab'
    value: string
    searchText: string
    path: string
    name: string
    relativePath: string
    documentKind: DocumentKind
    isDirty: boolean
}

export type FilePaletteItem = {
    kind: 'file'
    value: string
    searchText: string
    path: string
    name: string
    relativePath: string
    documentKind: DocumentKind
}

export type TextPaletteItem = {
    kind: 'text'
    value: string
    searchText: string
    path: string
    name: string
    relativePath: string
    documentKind: DocumentKind
    line: number
    column: number
    length: number
    preview: string
    /** Where the match starts inside `preview`. */
    previewMatchStart: number
    /** How much of the match `preview` shows: less than `length` for a match longer than the preview. */
    previewMatchLength: number
    source: 'buffer' | 'disk'
    /** In Replace in Workspace, what the match becomes. */
    newText?: string
    /** Set on the last search's hits while a new search runs, so they stay in place but can't be opened. */
    disabled?: boolean
}

export type RecentPaletteItem = {
    kind: 'recent'
    value: string
    searchText: string
    path: string
    name: string
    relativePath: string
    documentKind: DocumentKind
}

export type WorkspacePaletteItem = {
    kind: 'workspace'
    value: string
    searchText: string
    path: string
    name: string
}

/** Goes to a line (and column) of the open file: the ':' prefix. */
export type LinePaletteItem = {
    kind: 'line'
    value: string
    searchText: string
    path: string
    label: string
    /** The file's name and how many lines it has. */
    detail: string
    line: number
    column: number
}

/** A heading of the open Markdown file: the '@' prefix. */
export type HeadingPaletteItem = {
    kind: 'heading'
    value: string
    searchText: string
    path: string
    /** The heading's id in the preview. */
    headingId: string
    text: string
    /** 1 to 6, as in '#' to '######'. */
    level: number
    line: number
    /** How far in to draw it, as the Outline panel does: 0 at the top. */
    depth: number
}

/** A prefix the palette understands, listed by '?'. Picking it types the prefix into the box. */
export type PrefixPaletteItem = {
    kind: 'prefix'
    value: string
    searchText: string
    prefix: string
    label: string
}

export type PaletteItem =
    | ActionPaletteItem
    | TabPaletteItem
    | FilePaletteItem
    | TextPaletteItem
    | RecentPaletteItem
    | WorkspacePaletteItem
    | LinePaletteItem
    | HeadingPaletteItem
    | PrefixPaletteItem

export type PaletteGroup = {
    id: string
    label: string
    items: PaletteItem[]
    /** Set for one file's matches in Replace in Workspace, whose heading names the file and can replace in it. */
    file?: PaletteGroupFile
}

export type PaletteGroupFile = {
    path: string
    name: string
    /** The folder it is in, relative to the workspace ('' at the top). */
    folder: string
    /** How many matches the group lists. */
    matchCount: number
    /** True when the file has more matches than listed: its heading says '10+'. */
    capped: boolean
    /** Set while the matches are from the last search and a new one runs, so they can't be replaced. */
    disabled?: boolean
}

export type TextSearchHit = {
    path: string
    line: number
    column: number
    length: number
    preview: string
    /** Where the match starts inside `preview`. */
    previewMatchStart: number
    /** How much of the match `preview` shows: less than `length` for a match longer than the preview. */
    previewMatchLength: number
    source: 'buffer' | 'disk'
    /** Set when the search was asked for replacements: what the match becomes. */
    newText?: string
}
