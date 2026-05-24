import { getTheme, type AppThemeId } from '@/lib/theme/catalog'
import { resolveThemeTokens } from '@/lib/theme/resolve-theme-tokens'
import { applySemanticVars, clearSemanticVars } from '@/lib/theme/semantic-vars'

export function applyThemeToDocument(themeId: AppThemeId, root: HTMLElement = document.documentElement) {
    const theme = getTheme(themeId)
    const tokens = resolveThemeTokens(theme.colors)

    root.classList.toggle('dark', theme.kind === 'dark')
    applySemanticVars(root, tokens)
    root.dataset.appTheme = themeId
}

export function clearThemeFromDocument(root: HTMLElement = document.documentElement) {
    delete root.dataset.appTheme
    clearSemanticVars(root)
}
