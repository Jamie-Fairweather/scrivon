import type { AppThemeId } from '@/lib/theme/catalog'
import { getDiagramColors } from '@/lib/theme/catalog'
import { contrastRatio, ensureContrast, hexColorMix } from '@/lib/theme/color-mix'
import type { DiagramColors } from '@/lib/theme/types'

/** Matches beautiful-mermaid MIX weights in src/theme.ts */
const MIX = {
    textMuted: 40,
    textSecondary: 60,
    line: 50,
    arrow: 85,
    nodeFill: 3,
    nodeStroke: 20,
} as const

/** UI-only text weights. Diagram palettes pick `muted` for faint edge labels, which is too pale for UI text. */
const UI_MIX = {
    interactive: 8,
    mutedText: 65,
    lineNumber: 45,
} as const

/**
 * WCAG AA minimums: 4.5:1 for normal text, 3:1 for line numbers (secondary, non-body text).
 * `interactive` is a fill, not text: the floor just keeps it equally visible in low-contrast palettes.
 */
const MIN_CONTRAST = {
    text: 4.5,
    lineNumber: 3,
    interactive: 1.15,
} as const

/**
 * Extra contrast (one ratio step) the stronger of two text levels keeps over the weaker one:
 * body text over secondary text, and the current line number over the other line numbers.
 */
const TEXT_LEVEL_STEP = 1

export type ResolvedThemeTokens = {
    bg: string
    fg: string
    accent: string
    muted: string
    border: string
    surface: string
    line: string
    textSecondary: string
    /** Fill for hover, selected and pressed states. `surface` (3%) is too faint to see against bg. */
    interactive: string
    /** Secondary UI text (descriptions, hints, placeholders); at least 4.5:1 on bg, surface and interactive. */
    mutedText: string
    /** Editor line numbers; at least 3:1 on bg and surface. */
    lineNumber: string
    /** The current line's number; at least 4.5:1 on bg and surface, and always a step stronger than `lineNumber`. */
    activeLineNumber: string
    /**
     * Body text for the UI. Same as `fg` unless the palette's text is so soft (Solarized) that
     * `mutedText` would outrank it; then it is pushed further from bg. Monaco and diagrams keep `fg`.
     */
    uiText: string
}

/** Resolve full UI palette from diagram colors, using the same derivations as beautiful-mermaid SVGs. */
export function resolveThemeTokens(colors: DiagramColors): ResolvedThemeTokens {
    const { bg, fg } = colors
    const surface = colors.surface ?? hexColorMix(fg, bg, MIX.nodeFill)
    const interactive = ensureContrast(hexColorMix(fg, bg, UI_MIX.interactive), fg, [bg], MIN_CONTRAST.interactive)
    const textBackgrounds = [bg, surface, interactive]
    const textSecondary = hexColorMix(fg, bg, MIX.textSecondary)
    const mutedText = ensureContrast(colors.muted ?? hexColorMix(fg, bg, UI_MIX.mutedText), fg, textBackgrounds, MIN_CONTRAST.text)
    const lineNumber = ensureContrast(hexColorMix(fg, bg, UI_MIX.lineNumber), fg, textBackgrounds, MIN_CONTRAST.lineNumber)
    const activeLineNumberMin = Math.max(MIN_CONTRAST.text, contrastRatio(lineNumber, bg) + TEXT_LEVEL_STEP)

    return {
        bg,
        fg,
        accent: colors.accent ?? hexColorMix(fg, bg, MIX.arrow),
        muted: colors.muted ?? hexColorMix(fg, bg, MIX.textMuted),
        border: colors.border ?? hexColorMix(fg, bg, MIX.nodeStroke),
        surface,
        line: colors.line ?? hexColorMix(fg, bg, MIX.line),
        textSecondary,
        interactive,
        mutedText,
        lineNumber,
        // Monaco draws it on bg or on the current-line highlight (surface).
        activeLineNumber: ensureContrast(textSecondary, fg, [bg, surface], activeLineNumberMin),
        // uiText and mutedText sit on the same side of bg, so out-ranking it on bg out-ranks it on every fill.
        uiText: ensureContrast(fg, fg, [bg], contrastRatio(mutedText, bg) + TEXT_LEVEL_STEP),
    }
}

export function resolveThemeTokensForId(themeId: AppThemeId): ResolvedThemeTokens {
    return resolveThemeTokens(getDiagramColors(themeId))
}
