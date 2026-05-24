import { hexColorMix } from '@/lib/theme/color-mix'
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

export const SEMANTIC_VAR_NAMES = [
    '--background',
    '--foreground',
    '--card',
    '--card-foreground',
    '--popover',
    '--popover-foreground',
    '--primary',
    '--primary-foreground',
    '--secondary',
    '--secondary-foreground',
    '--muted',
    '--muted-foreground',
    '--accent',
    '--accent-foreground',
    '--border',
    '--input',
    '--ring',
    '--sidebar',
    '--sidebar-foreground',
    '--sidebar-primary',
    '--sidebar-primary-foreground',
    '--sidebar-accent',
    '--sidebar-accent-foreground',
    '--sidebar-border',
    '--sidebar-ring',
    '--code',
    '--code-foreground',
    '--code-highlight',
] as const satisfies readonly (keyof SemanticThemeVars)[]

export function tokensToSemanticVars(tokens: ResolvedThemeTokens): SemanticThemeVars {
    return {
        '--background': tokens.bg,
        '--foreground': tokens.fg,
        '--card': tokens.surface,
        '--card-foreground': tokens.fg,
        '--popover': tokens.surface,
        '--popover-foreground': tokens.fg,
        '--primary': tokens.fg,
        '--primary-foreground': tokens.bg,
        '--secondary': tokens.surface,
        '--secondary-foreground': tokens.fg,
        '--muted': tokens.surface,
        '--muted-foreground': tokens.muted,
        '--accent': hexColorMix(tokens.accent, tokens.bg, 24),
        '--accent-foreground': tokens.fg,
        '--border': tokens.border,
        '--input': tokens.border,
        '--ring': tokens.accent,
        '--sidebar': tokens.bg,
        '--sidebar-foreground': tokens.textSecondary,
        '--sidebar-primary': tokens.fg,
        '--sidebar-primary-foreground': tokens.bg,
        '--sidebar-accent': tokens.surface,
        '--sidebar-accent-foreground': tokens.fg,
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

export function clearSemanticVars(root: HTMLElement) {
    for (const name of SEMANTIC_VAR_NAMES) {
        root.style.removeProperty(name)
    }
}
