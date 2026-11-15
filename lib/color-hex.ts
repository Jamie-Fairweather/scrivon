const HEX_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * Accepts `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`; returns lowercase `#rrggbb`,
 * or `#rrggbbaa` when the colour is translucent. `null` for anything else.
 */
export function normalizeColorHex(value: string): string | null {
    const trimmed = value.trim()
    if (!HEX_PATTERN.test(trimmed)) return null
    let digits = trimmed.slice(1).toLowerCase()
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('')
    if (digits.length === 8 && digits.endsWith('ff')) digits = digits.slice(0, 6)
    return `#${digits}`
}
