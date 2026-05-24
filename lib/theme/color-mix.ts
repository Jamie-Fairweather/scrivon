export function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
    const normalized = hex.trim()
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized)
    if (!match) return null
    return {
        r: Number.parseInt(match[1], 16),
        g: Number.parseInt(match[2], 16),
        b: Number.parseInt(match[3], 16),
    }
}

export function toHexColor(r: number, g: number, b: number): string {
    const channel = (value: number) =>
        Math.max(0, Math.min(255, Math.round(value)))
            .toString(16)
            .padStart(2, '0')
    return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Mix fg into bg at fgPercent (0–100), matching CSS color-mix(in srgb, fg N%, bg). */
export function hexColorMix(fg: string, bg: string, fgPercent: number): string {
    const foreground = parseHexColor(fg)
    const background = parseHexColor(bg)
    if (!foreground || !background) return fg

    const t = fgPercent / 100
    return toHexColor(
        background.r + (foreground.r - background.r) * t,
        background.g + (foreground.g - background.g) * t,
        background.b + (foreground.b - background.b) * t
    )
}
