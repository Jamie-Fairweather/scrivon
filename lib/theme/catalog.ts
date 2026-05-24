import { APP_THEMES, type AppThemeId } from '@/lib/theme/themes'
import type { DiagramColors } from '@/lib/theme/types'

export type { AppThemeId, DiagramColors }

/** SSR / hydration fallback when system preference is unknown. */
export const DEFAULT_APP_THEME: AppThemeId = 'scrivon-dark'

export const SYSTEM_LIGHT_THEME: AppThemeId = 'scrivon-light'
export const SYSTEM_DARK_THEME: AppThemeId = 'scrivon-dark'

export const APP_THEME_IDS = Object.keys(APP_THEMES) as AppThemeId[]

export const APP_THEME_LABELS = Object.fromEntries(APP_THEME_IDS.map((id) => [id, APP_THEMES[id].label])) as Record<AppThemeId, string>

export const APP_LIGHT_THEME_IDS = APP_THEME_IDS.filter((id) => APP_THEMES[id].kind === 'light')
export const APP_DARK_THEME_IDS = APP_THEME_IDS.filter((id) => APP_THEMES[id].kind === 'dark')

export function isAppThemeId(value: string): value is AppThemeId {
    return value in APP_THEMES
}

export function getTheme(id: AppThemeId) {
    return APP_THEMES[id]
}

export function getDiagramColors(id: AppThemeId): DiagramColors {
    return APP_THEMES[id].colors
}

export function isLightTheme(id: AppThemeId): boolean {
    return APP_THEMES[id].kind === 'light'
}

export function getSystemPreferredTheme(): AppThemeId {
    if (typeof window === 'undefined') return DEFAULT_APP_THEME
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? SYSTEM_DARK_THEME : SYSTEM_LIGHT_THEME
}

export function parseStoredTheme(value: string | null): AppThemeId {
    if (value && isAppThemeId(value)) return value
    return getSystemPreferredTheme()
}
