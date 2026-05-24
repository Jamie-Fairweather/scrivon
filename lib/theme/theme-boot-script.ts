import { APP_THEMES, type AppThemeId } from '@/lib/theme/themes'
import { resolveThemeTokens } from '@/lib/theme/resolve-theme-tokens'
import { tokensToSemanticVars } from '@/lib/theme/semantic-vars'
import { STORAGE_MERMAID_THEME } from '@/lib/workspace/types'

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

    const storageKey = JSON.stringify(STORAGE_MERMAID_THEME)
    const themesJson = JSON.stringify(bootThemes)
    const darkTheme = JSON.stringify('scrivon-dark')
    const lightTheme = JSON.stringify('scrivon-light')
    const varNames = JSON.stringify([
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
    ])

    return `(function(){try{var k=${storageKey};var themes=${themesJson};var names=${varNames};var id=localStorage.getItem(k);if(!id||!themes[id])id=window.matchMedia('(prefers-color-scheme: dark)').matches?${darkTheme}:${lightTheme};var t=themes[id];var r=document.documentElement;r.dataset.appTheme=id;r.classList.toggle('dark',t.kind==='dark');var v=t.vars;for(var i=0;i<names.length;i++)r.style.setProperty(names[i],v[names[i]]);}catch(e){}})();`
}
