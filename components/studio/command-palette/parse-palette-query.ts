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
 * such as '@media' or ':root' can still be searched for there. Elsewhere ':', '@' and '?' count only as
 * the very first character, so a space in front searches for them as text too.
 */
export function parsePaletteQuery(raw: string, mode: PaletteMode = 'all'): ParsedPaletteQuery {
    const trimmed = raw.trimStart()
    const kind = PREFIX_KINDS[trimmed.charAt(0)]
    if (kind === 'commands' || (kind && mode !== 'text' && trimmed === raw)) {
        return { kind, query: trimmed.slice(1).trim() }
    }
    return { kind: 'search', query: raw.trim() }
}

/**
 * The query to keep when the palette switches mode. Text that Find in Workspace was searching for, such
 * as '@media', would start a prefix elsewhere, so a space goes in front to keep it a search.
 */
export function queryForMode(query: string, from: PaletteMode, to: PaletteMode): string {
    const wasSearch = parsePaletteQuery(query, from).kind === 'search'
    return wasSearch && parsePaletteQuery(query, to).kind !== 'search' ? ` ${query}` : query
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
