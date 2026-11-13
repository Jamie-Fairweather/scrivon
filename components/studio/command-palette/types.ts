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
    /** Where the match starts inside `preview`; `length` is how long it is. */
    previewMatchStart: number
    source: 'buffer' | 'disk'
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
}

export type TextSearchHit = {
    path: string
    line: number
    column: number
    length: number
    preview: string
    /** Where the match starts inside `preview`; `length` is how long it is. */
    previewMatchStart: number
    source: 'buffer' | 'disk'
}
