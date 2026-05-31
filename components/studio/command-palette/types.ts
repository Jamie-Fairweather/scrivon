import type { DocumentKind } from '@/lib/workspace/file-types'

export type PaletteMode = 'all' | 'files' | 'text'

export type ActionPaletteItem = {
    kind: 'action'
    value: string
    searchText: string
    label: string
    shortcut?: string
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
    line: number
    column: number
    length: number
    preview: string
    source: 'buffer' | 'disk'
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

export type PaletteItem = ActionPaletteItem | TabPaletteItem | FilePaletteItem | TextPaletteItem | RecentPaletteItem | WorkspacePaletteItem

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
    source: 'buffer' | 'disk'
}
