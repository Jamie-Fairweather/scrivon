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

/** WCAG 2.x relative luminance (0 = black, 1 = white), or null for an unparseable colour. */
export function relativeLuminance(hex: string): number | null {
    const rgb = parseHexColor(hex)
    if (!rgb) return null
    const linear = (channel: number) => {
        const c = channel / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b)
}

/** WCAG 2.x contrast ratio between two colours (1–21). Unparseable colours count as no contrast. */
export function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a)
    const lb = relativeLuminance(b)
    if (la === null || lb === null) return 1
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Return `color` if it reaches `min` contrast against every background. Otherwise step it
 * toward `toward` (usually the theme's text colour, to keep its hue), then on toward black
 * or white (whichever stands out more from the first background), and return the first
 * colour that passes. Falls back to black or white. Passing the same colour as `color` and
 * `toward` goes straight to black or white.
 */
export function ensureContrast(color: string, toward: string, backgrounds: readonly string[], min: number): string {
    const passes = (candidate: string) => backgrounds.every((bg) => contrastRatio(candidate, bg) >= min)
    if (passes(color)) return color

    // Mixing a colour with itself only gives the same colour back, which has just failed.
    if (toward !== color) {
        for (let percent = 1; percent <= 100; percent++) {
            const candidate = hexColorMix(toward, color, percent)
            if (passes(candidate)) return candidate
        }
    }

    const first = backgrounds[0] ?? color
    const extreme = contrastRatio('#000000', first) >= contrastRatio('#ffffff', first) ? '#000000' : '#ffffff'
    for (let percent = 1; percent <= 100; percent++) {
        const candidate = hexColorMix(extreme, toward, percent)
        if (passes(candidate)) return candidate
    }
    return extreme
}
