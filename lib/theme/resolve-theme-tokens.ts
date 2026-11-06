import type { AppThemeId } from '@/lib/theme/catalog'
import { getDiagramColors } from '@/lib/theme/catalog'
import { ensureContrast, hexColorMix } from '@/lib/theme/color-mix'
import type { DiagramColors } from '@/lib/theme/types'

/** Matches beautiful-mermaid MIX weights in src/theme.ts */
const MIX = {
    textMuted: 40,
    textSecondary: 60,
    textFaint: 25,
    line: 50,
    arrow: 85,
    nodeFill: 3,
    nodeStroke: 20,
} as const

/** UI-only text weights. Diagram palettes pick `muted` for faint edge labels, which is too pale for UI text. */
const UI_MIX = {
    mutedText: 65,
    lineNumber: 45,
} as const

/** WCAG AA minimums: 4.5:1 for normal text, 3:1 for line numbers (secondary, non-body text). */
const MIN_CONTRAST = {
    text: 4.5,
    lineNumber: 3,
} as const

export type ResolvedThemeTokens = {
    bg: string
    fg: string
    accent: string
    muted: string
    border: string
    surface: string
    line: string
    textSecondary: string
    textFaint: string
    /** Secondary UI text (descriptions, hints, placeholders); at least 4.5:1 on bg and surface. */
    mutedText: string
    /** Editor line numbers; at least 3:1 on bg and surface. */
    lineNumber: string
}

/** Resolve full UI palette from diagram colors, using the same derivations as beautiful-mermaid SVGs. */
export function resolveThemeTokens(colors: DiagramColors): ResolvedThemeTokens {
    const { bg, fg } = colors
    const surface = colors.surface ?? hexColorMix(fg, bg, MIX.nodeFill)
    const textBackgrounds = [bg, surface]

    return {
        bg,
        fg,
        accent: colors.accent ?? hexColorMix(fg, bg, MIX.arrow),
        muted: colors.muted ?? hexColorMix(fg, bg, MIX.textMuted),
        border: colors.border ?? hexColorMix(fg, bg, MIX.nodeStroke),
        surface,
        line: colors.line ?? hexColorMix(fg, bg, MIX.line),
        textSecondary: hexColorMix(fg, bg, MIX.textSecondary),
        textFaint: hexColorMix(fg, bg, MIX.textFaint),
        mutedText: ensureContrast(colors.muted ?? hexColorMix(fg, bg, UI_MIX.mutedText), fg, textBackgrounds, MIN_CONTRAST.text),
        lineNumber: ensureContrast(hexColorMix(fg, bg, UI_MIX.lineNumber), fg, textBackgrounds, MIN_CONTRAST.lineNumber),
    }
}

export function resolveThemeTokensForId(themeId: AppThemeId): ResolvedThemeTokens {
    return resolveThemeTokens(getDiagramColors(themeId))
}
