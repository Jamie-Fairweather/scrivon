import { APP_THEMES, type AppThemeId } from '@/lib/theme/themes'
import type { DiagramColors } from '@/lib/theme/types'

export type { AppThemeId, DiagramColors }

export const SYSTEM_LIGHT_THEME: AppThemeId = 'scrivon-light'
export const SYSTEM_DARK_THEME: AppThemeId = 'scrivon-dark'

export const APP_THEME_IDS = Object.keys(APP_THEMES) as AppThemeId[]

export const APP_THEME_LABELS = Object.fromEntries(APP_THEME_IDS.map((id) => [id, APP_THEMES[id].label])) as Record<AppThemeId, string>

export const APP_LIGHT_THEME_IDS = APP_THEME_IDS.filter((id) => APP_THEMES[id].kind === 'light')
export const APP_DARK_THEME_IDS = APP_THEME_IDS.filter((id) => APP_THEMES[id].kind === 'dark')

/** Own keys only: `in` would also accept inherited names like 'constructor' from stored data. */
export function isAppThemeId(value: unknown): value is AppThemeId {
    return typeof value === 'string' && Object.hasOwn(APP_THEMES, value)
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
