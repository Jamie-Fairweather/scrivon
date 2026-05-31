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
