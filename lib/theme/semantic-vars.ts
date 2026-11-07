import { ensureContrast, hexColorMix } from '@/lib/theme/color-mix'
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
    // Primary buttons and selected text: the palette text colour as a fill, with the background colour as its text.
    // Stepped toward black or white only where that pair is under 4.5:1 (Solarized Light).
    const primaryFill = ensureContrast(tokens.fg, tokens.fg, [tokens.bg], MIN_TEXT_CONTRAST)

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

export function applySemanticVars(root: HTMLElement, tokens: ResolvedThemeTokens) {
    const vars = tokensToSemanticVars(tokens)
    for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value)
    }
}
