export type ParsedPaletteQuery = {
    actionsOnly: boolean
    query: string
}

export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('>')) {
        return { actionsOnly: true, query: trimmed.slice(1).trimStart() }
    }
    return { actionsOnly: false, query: raw.trim() }
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
