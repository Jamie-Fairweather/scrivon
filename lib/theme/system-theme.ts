import { FOLLOW_SYSTEM, type ThemeSetting } from '@/lib/settings/types'
import { isLightTheme, type AppThemeId } from '@/lib/theme/catalog'

/** Windows' light/dark setting, as the page sees it. The desktop app passes Windows' changes on to it. */
const DARK_QUERY = '(prefers-color-scheme: dark)'

function darkQuery(): MediaQueryList | null {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
    return window.matchMedia(DARK_QUERY)
}

/** Whether Windows is set to dark. With nothing to ask, dark, like the default theme. */
export function systemPrefersDark(): boolean {
    return darkQuery()?.matches ?? true
}

/** Calls onChange with the new setting each time Windows switches between light and dark. Returns a stop function. */
export function watchSystemTheme(onChange: (dark: boolean) => void): () => void {
    const query = darkQuery()
    if (!query) return () => undefined
    const listener = () => onChange(query.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
}

/** The theme on screen: the fixed one, or in System mode the light or dark one to match Windows. */
export function resolveThemeSetting(setting: ThemeSetting, systemIsDark: boolean): AppThemeId {
    if (setting.id !== FOLLOW_SYSTEM) return setting.id
    return systemIsDark ? setting.dark : setting.light
}

/**
 * Turns System mode on or off without changing the theme on screen. Turning it on keeps the
 * current theme as System mode's light or dark theme; turning it off keeps it as the fixed theme.
 */
export function withFollowSystem(setting: ThemeSetting, on: boolean, systemIsDark: boolean): ThemeSetting {
    if ((setting.id === FOLLOW_SYSTEM) === on) return setting
    const current = resolveThemeSetting(setting, systemIsDark)
    if (!on) return { ...setting, id: current }
    return withSystemTheme({ ...setting, id: FOLLOW_SYSTEM }, current)
}

/** Sets the theme System mode uses: a light theme for when Windows is light, a dark one for when it's dark. */
export function withSystemTheme(setting: ThemeSetting, id: AppThemeId): ThemeSetting {
    return isLightTheme(id) ? { ...setting, light: id } : { ...setting, dark: id }
}
