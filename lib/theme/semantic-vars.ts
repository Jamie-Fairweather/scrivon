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
    '--warning-foreground': string
    '--destructive-foreground': string
    '--info-foreground': string
    '--success-foreground': string
}

/** Minimum contrast for text drawn on a hover, selected or highlighted fill (WCAG AA, normal text). */
const MIN_TEXT_CONTRAST = 4.5

type ThemeKind = 'light' | 'dark'
type StatusName = 'warning' | 'destructive' | 'info' | 'success'
/** `fill` is the colour of the status's tints (--warning etc.), `text` its text colour (--warning-foreground etc.). */
type StatusColor = { fill: string; text: string }

/**
 * Tailwind's status colours, as app/globals.css sets them before the theme loads: the 500 shade
 * for tints, and the 700 shade for text in light themes and the 400 shade in dark ones.
 */
export const STATUS_COLORS: Record<ThemeKind, Record<StatusName, StatusColor>> = {
    light: {
        warning: { fill: '#fe9a00', text: '#bb4d00' },
        destructive: { fill: '#fb2c36', text: '#c10007' },
        info: { fill: '#2b7fff', text: '#1447e6' },
        success: { fill: '#00bc7d', text: '#007a55' },
    },
    dark: {
        warning: { fill: '#fe9a00', text: '#ffb900' },
        // .dark mixes 10% white into red-500.
        destructive: { fill: '#fb414a', text: '#ff6467' },
        info: { fill: '#2b7fff', text: '#51a2ff' },
        success: { fill: '#00bc7d', text: '#00d492' },
    },
}

/**
 * How strong the status tints are that the text sits on, over the background or a panel: hover (/4),
 * the read-only bar (/10), and badges (/8 in light themes, /16 in dark ones).
 */
export const STATUS_TINT_PERCENTS: Record<ThemeKind, readonly number[]> = { light: [4, 8, 10], dark: [4, 10, 16] }

/**
 * Status text (warnings, errors, links, success) made darker in light themes and lighter in dark ones
 * until it reaches 4.5:1 on the theme's backgrounds and on its own tints over them. Tailwind's fixed
 * shades fall short on the grey or tinted backgrounds of some themes (Tokyo Light, Nord, Latte).
 */
function statusTextColor(tokens: ResolvedThemeTokens, kind: ThemeKind, status: StatusName, extraBackgrounds: readonly string[] = []): string {
    const { fill, text } = STATUS_COLORS[kind][status]
    const tints = [tokens.bg, tokens.surface].flatMap((surface) => STATUS_TINT_PERCENTS[kind].map((percent) => hexColorMix(fill, surface, percent)))
    // The background goes first: it decides whether the text steps toward black or white.
    const backgrounds = [tokens.bg, tokens.surface, tokens.interactive, ...extraBackgrounds, ...tints]
    return ensureContrast(text, text, backgrounds, MIN_TEXT_CONTRAST)
}

export function tokensToSemanticVars(tokens: ResolvedThemeTokens): SemanticThemeVars {
    const accent = hexColorMix(tokens.accent, tokens.bg, 24)
    const textOnInteractive = ensureContrast(tokens.uiText, tokens.uiText, [tokens.interactive], MIN_TEXT_CONTRAST)
    const kind: ThemeKind = contrastRatio('#000000', tokens.bg) >= contrastRatio('#ffffff', tokens.bg) ? 'light' : 'dark'

    return {
        '--background': tokens.bg,
        '--foreground': tokens.uiText,
        '--card': tokens.surface,
        '--card-foreground': tokens.uiText,
        '--popover': tokens.surface,
        '--popover-foreground': tokens.uiText,
        '--primary': tokens.fg,
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
        '--sidebar-primary': tokens.fg,
        '--sidebar-primary-foreground': tokens.bg,
        '--sidebar-accent': tokens.interactive,
        '--sidebar-accent-foreground': textOnInteractive,
        '--sidebar-border': tokens.border,
        '--sidebar-ring': tokens.accent,
        '--code': tokens.bg,
        '--code-foreground': tokens.fg,
        '--code-highlight': tokens.surface,
        '--warning-foreground': statusTextColor(tokens, kind, 'warning'),
        // A destructive menu item (the explorer's Delete) keeps its red on the highlighted row.
        '--destructive-foreground': statusTextColor(tokens, kind, 'destructive', [accent]),
        '--info-foreground': statusTextColor(tokens, kind, 'info'),
        '--success-foreground': statusTextColor(tokens, kind, 'success'),
    }
}

export function applySemanticVars(root: HTMLElement, tokens: ResolvedThemeTokens) {
    const vars = tokensToSemanticVars(tokens)
    for (const [name, value] of Object.entries(vars)) {
        root.style.setProperty(name, value)
    }
}
