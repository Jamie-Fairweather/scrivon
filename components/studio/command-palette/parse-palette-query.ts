import type { PaletteMode } from '@/components/studio/command-palette/types'

/**
 * What the palette is asked for: a plain search, or one of the prefixes ('>' commands, ':' go to line,
 * '@' jump to a heading, '?' list the prefixes).
 */
export type PaletteQueryKind = 'search' | 'commands' | 'line' | 'heading' | 'help'

export type ParsedPaletteQuery = {
    kind: PaletteQueryKind
    query: string
}

const PREFIX_KINDS: Record<string, PaletteQueryKind> = {
    '>': 'commands',
    ':': 'line',
    '@': 'heading',
    '?': 'help',
}

/**
 * Splits a leading prefix off the query. Find in Workspace (`mode` 'text') only knows '>', so text
 * such as '@media' or ':root' can still be searched for there.
 */
export function parsePaletteQuery(raw: string, mode: PaletteMode = 'all'): ParsedPaletteQuery {
    const trimmed = raw.trimStart()
    const kind = PREFIX_KINDS[trimmed.charAt(0)]
    if (kind && (mode !== 'text' || kind === 'commands')) {
        return { kind, query: trimmed.slice(1).trim() }
    }
    return { kind: 'search', query: raw.trim() }
}

/**
 * Turns the editor selection into a starting query for Find in Workspace.
 * Only a single line is used (search matches line by line), and never text starting
 * with '>', which would switch the palette to commands.
 */
export function queryFromEditorSelection(selection: string | null | undefined): string | null {
    const trimmed = selection?.trim()
    if (!trimmed) return null
    if (/[\r\n]/.test(trimmed)) return null
    if (trimmed.startsWith('>')) return null
    return trimmed
}
