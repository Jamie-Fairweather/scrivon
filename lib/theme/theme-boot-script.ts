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

/** Inline script for layout <head> — applies saved theme before React hydrates. */
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

    return `(function(){try{var settingsKey=${settingsKey};var legacyKey=${legacyStorageKey};var themes=${themesJson};var id=null;var raw=localStorage.getItem(settingsKey);if(raw){try{var parsed=JSON.parse(raw);if(parsed&&parsed.theme&&parsed.theme.id)id=parsed.theme.id;}catch(e){}}if(!id)id=localStorage.getItem(legacyKey);if(!id||!Object.prototype.hasOwnProperty.call(themes,id))id=window.matchMedia('(prefers-color-scheme: dark)').matches?${darkTheme}:${lightTheme};var t=themes[id];var r=document.documentElement;r.dataset.appTheme=id;r.classList.toggle('dark',t.kind==='dark');r.style.colorScheme=t.kind;var v=t.vars;for(var k in v)r.style.setProperty(k,v[k]);}catch(e){}})();`
}
