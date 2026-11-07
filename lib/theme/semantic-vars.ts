import { contrastRatio, ensureContrast, hexColorMix } from '@/lib/theme/color-mix'
import type { ResolvedThemeTokens } from '@/lib/theme/resolve-theme-tokens'

/** Shadcn semantic CSS variables applied inline on html. */
export type SemanticThemeVars = {
    '--background': string
    '--foreground': string
    '--card': string
    '--card-foreground': string
    '--popover': string
    '--popover-foreground': string
    '--primary': string
    '--primary-foreground': string
    '--secondary': string
    '--secondary-foreground': string
    '--muted': string
    '--muted-foreground': string
    '--accent': string
    '--accent-foreground': string
    '--border': string
    '--input': string
    '--ring': string
    '--sidebar': string
    '--sidebar-foreground': string
    '--sidebar-primary': string
    '--sidebar-primary-foreground': string
    '--sidebar-accent': string
    '--sidebar-accent-foreground': string
    '--sidebar-border': string
    '--sidebar-ring': string
    '--code': string
    '--code-foreground': string
    '--code-highlight': string
}

/** Minimum contrast for text drawn on a hover, selected or highlighted fill (WCAG AA, normal text). */
const MIN_TEXT_CONTRAST = 4.5

export function tokensToSemanticVars(tokens: ResolvedThemeTokens): SemanticThemeVars {
    const accent = hexColorMix(tokens.accent, tokens.bg, 24)
    const textOnInteractive = ensureContrast(tokens.uiText, tokens.uiText, [tokens.interactive], MIN_TEXT_CONTRAST)
    const primaryFill = primaryFillColor(tokens)

    return {
        '--background': tokens.bg,
        '--foreground': tokens.uiText,
        '--card': tokens.surface,
        '--card-foreground': tokens.uiText,
        '--popover': tokens.surface,
        '--popover-foreground': tokens.uiText,
        '--primary': primaryFill,
        '--primary-foreground': tokens.bg,
        '--secondary': tokens.interactive,
        '--secondary-foreground': textOnInteractive,
        '--muted': tokens.interactive,
        '--muted-foreground': tokens.mutedText,
        '--accent': accent,
        '--accent-foreground': ensureContrast(tokens.uiText, tokens.uiText, [accent], MIN_TEXT_CONTRAST),
        '--border': tokens.border,
        '--input': tokens.border,
        '--ring': tokens.accent,
        '--sidebar': tokens.bg,
        '--sidebar-foreground': tokens.textSecondary,
        '--sidebar-primary': primaryFill,
        '--sidebar-primary-foreground': tokens.bg,
        '--sidebar-accent': tokens.interactive,
        '--sidebar-accent-foreground': textOnInteractive,
        '--sidebar-border': tokens.border,
        '--sidebar-ring': tokens.accent,
        '--code': tokens.bg,
        '--code-foreground': tokens.fg,
        '--code-highlight': tokens.surface,
    }
}

/**
 * button.tsx draws a hovered or pressed primary button at 90% over the page or a dialog (bg-primary/90).
 * The fill is checked a point under that, so the browser's rounding of the blend can't take it under 4.5:1.
 */
const PRESSED_CHECK_PERCENT = 89

/**
 * The fill of primary buttons and selected text, whose text is the background colour: the palette
 * text colour, stepped toward black or white until that text reaches 4.5:1 on it, at rest and
 * also hovered or pressed over the background or a dialog. Solarized Light and Dark need the step.
 */
function primaryFillColor(tokens: ResolvedThemeTokens): string {
    const text = tokens.bg
    const passes = (fill: string) =>
        [fill, ...[tokens.bg, tokens.surface].map((under) => hexColorMix(fill, under, PRESSED_CHECK_PERCENT))].every(
            (shade) => contrastRatio(text, shade) >= MIN_TEXT_CONTRAST
        )
    if (passes(tokens.fg)) return tokens.fg

    const extreme = contrastRatio('#000000', text) >= contrastRatio('#ffffff', text) ? '#000000' : '#ffffff'
    for (let percent = 1; percent <= 100; percent++) {
        const candidate = hexColorMix(extreme, tokens.fg, percent)
        if (passes(candidate)) return candidate
    }
    return extreme
}

export function applySemanticVars(root: HTMLElement, tokens: ResolvedThemeTokens) {
    const vars = tokensToSemanticVars(tokens)
    for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value)
    }
}
