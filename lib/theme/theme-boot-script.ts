import { APP_THEMES, type AppThemeId } from '@/lib/theme/themes'
import { SYSTEM_DARK_THEME, SYSTEM_LIGHT_THEME } from '@/lib/theme/catalog'
import { resolveThemeTokens } from '@/lib/theme/resolve-theme-tokens'
import { tokensToSemanticVars } from '@/lib/theme/semantic-vars'
import { SETTINGS_STORAGE_KEY } from '@/lib/settings/types'
import { STORAGE_MERMAID_THEME } from '@/lib/workspace/types'

/** JSON safe to embed in `<script>` — prevents `</script>` breakout from interpolated values. */
export function jsonForInlineScript(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * Inline script for layout <head> — applies saved theme before React hydrates. It reads the saved
 * theme the way React does (normalizeTheme, then resolveThemeSetting), so nothing flashes: a known
 * theme is fixed; 'system', or a theme this version doesn't know, follows Windows with the saved
 * light or dark pick. A pick that's unknown or the wrong kind falls back to Scrivon Light or Dark.
 */
export function getThemeBootScript(): string {
    const bootThemes = Object.fromEntries(
        (Object.keys(APP_THEMES) as AppThemeId[]).map((id) => {
            const theme = APP_THEMES[id]
            return [
                id,
                {
                    kind: theme.kind,
                    vars: tokensToSemanticVars(resolveThemeTokens(theme.colors)),
                },
            ]
        })
    )

    const settingsKey = jsonForInlineScript(SETTINGS_STORAGE_KEY)
    const legacyStorageKey = jsonForInlineScript(STORAGE_MERMAID_THEME)
    const themesJson = jsonForInlineScript(bootThemes)
    const darkTheme = jsonForInlineScript(SYSTEM_DARK_THEME)
    const lightTheme = jsonForInlineScript(SYSTEM_LIGHT_THEME)

    return `(function(){try{var settingsKey=${settingsKey};var legacyKey=${legacyStorageKey};var themes=${themesJson};var id=null;var isDark=function(){return window.matchMedia('(prefers-color-scheme: dark)').matches;};var known=function(x){return typeof x==='string'&&Object.prototype.hasOwnProperty.call(themes,x);};var fallback=function(){return isDark()?${darkTheme}:${lightTheme};};var raw=localStorage.getItem(settingsKey);if(raw){try{var parsed=JSON.parse(raw);var saved=parsed&&parsed.theme;if(saved&&saved.id){if(known(saved.id))id=saved.id;else{var kind=isDark()?'dark':'light';var pick=saved[kind];id=known(pick)&&themes[pick].kind===kind?pick:fallback();}}}catch(e){}}if(!id)id=localStorage.getItem(legacyKey);if(!known(id))id=fallback();var t=themes[id];var r=document.documentElement;r.dataset.appTheme=id;r.classList.toggle('dark',t.kind==='dark');r.style.colorScheme=t.kind;var v=t.vars;for(var k in v)r.style.setProperty(k,v[k]);}catch(e){}})();`
}
