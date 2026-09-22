export type PdfExportOutlineItem = {
    id: string
    level: number
    text: string
}

function slugify(text: string, used: Map<string, number>): string {
    const base =
        text
            .toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-') || 'section'
    const count = used.get(base) ?? 0
    used.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
}

/** Extract ATX headings from markdown body for TOC / heading ids. */
export function extractPdfExportOutline(body: string, maxDepth: number, excludeH1: boolean): PdfExportOutlineItem[] {
    const used = new Map<string, number>()
    const items: PdfExportOutlineItem[] = []
    const lines = body.split(/\r?\n/)

    for (const line of lines) {
        const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
        if (!match) continue
        const level = match[1]!.length
        if (level > maxDepth) continue
        if (excludeH1 && level === 1) continue
        const text = match[2]!.trim()
        if (!text) continue
        items.push({ id: slugify(text, used), level, text })
    }

    return items
}
