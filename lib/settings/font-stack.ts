/**
 * Reading a CSS font-family list, with no Tauri imports, so the exporters can use it too.
 * Settings save system font names quoted and escaped (`"Odd \"Quote\" Font"`), and a quoted name may hold a comma.
 */

const QUOTED_FAMILY = /^(["'])((?:\\[\s\S]|(?!\1)[^\\])*)\1$/

/** Splits a CSS font-family list on the commas outside quoted names. */
export function splitFontStack(stack: string): string[] {
    const parts: string[] = []
    let current = ''
    let quote: string | null = null
    for (let index = 0; index < stack.length; index++) {
        const char = stack[index]!
        current += char
        if (quote) {
            if (char === '\\' && index + 1 < stack.length) current += stack[++index]
            else if (char === quote) quote = null
        } else if (char === '"' || char === "'") {
            quote = char
        } else if (char === ',') {
            parts.push(current.slice(0, -1).trim())
            current = ''
        }
    }
    parts.push(current.trim())
    return parts.filter(Boolean)
}

/** One family from a stack as plain text: quotes and escapes removed, spaces collapsed. */
export function familyName(part: string): string {
    const quoted = QUOTED_FAMILY.exec(part)
    return (quoted ? quoted[2]!.replace(/\\([\s\S])/g, '$1') : part.replace(/\s+/g, ' ')).trim()
}
