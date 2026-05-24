import type { AppThemeId } from '@/lib/theme/catalog'
import { getDiagramColors } from '@/lib/theme/catalog'
import { hexColorMix } from '@/lib/theme/color-mix'
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
}

/** Resolve full UI palette from diagram colors, using the same derivations as beautiful-mermaid SVGs. */
export function resolveThemeTokens(colors: DiagramColors): ResolvedThemeTokens {
    const { bg, fg } = colors

    return {
        bg,
        fg,
        accent: colors.accent ?? hexColorMix(fg, bg, MIX.arrow),
        muted: colors.muted ?? hexColorMix(fg, bg, MIX.textMuted),
        border: colors.border ?? hexColorMix(fg, bg, MIX.nodeStroke),
        surface: colors.surface ?? hexColorMix(fg, bg, MIX.nodeFill),
        line: colors.line ?? hexColorMix(fg, bg, MIX.line),
        textSecondary: hexColorMix(fg, bg, MIX.textSecondary),
        textFaint: hexColorMix(fg, bg, MIX.textFaint),
    }
}

export function resolveThemeTokensForId(themeId: AppThemeId): ResolvedThemeTokens {
    return resolveThemeTokens(getDiagramColors(themeId))
}
