import { THEME_TWINS } from '@/components/studio/theme/theme-commands'
import { FOLLOW_SYSTEM, type DiagramExportTheme, type ThemeSetting } from '@/lib/settings/types'
import { isLightTheme, type AppThemeId } from '@/lib/theme/catalog'

/**
 * The theme an exported diagram is drawn in. 'light' and 'dark' keep the theme on screen when it is
 * already that kind. Otherwise they use the theme Windows light or dark would show (when following
 * Windows), or the same family's other half, or else the user's light or dark theme.
 */
export function diagramExportThemeId(choice: DiagramExportTheme, appThemeId: AppThemeId, theme: ThemeSetting): AppThemeId {
    if (choice === 'app') return appThemeId
    const light = choice === 'light'
    if (isLightTheme(appThemeId) === light) return appThemeId
    const usersTheme = light ? theme.light : theme.dark
    if (theme.id === FOLLOW_SYSTEM) return usersTheme
    return THEME_TWINS[appThemeId] ?? usersTheme
}
