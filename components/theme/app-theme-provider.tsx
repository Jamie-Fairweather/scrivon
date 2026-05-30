'use client'

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { applyThemeToDocument } from '@/lib/theme/apply-document-theme'
import { getDiagramColors, isLightTheme, type AppThemeId, type DiagramColors } from '@/lib/theme/catalog'
import { resolveThemeTokensForId, type ResolvedThemeTokens } from '@/lib/theme/resolve-theme-tokens'

type AppThemeContextValue = {
    themeId: AppThemeId
    setThemeId: (id: AppThemeId) => void
    colors: DiagramColors
    tokens: ResolvedThemeTokens
    isLight: boolean
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null)

export function AppThemeProvider({ children }: { children: ReactNode }) {
    const { settings, setThemeId } = useAppSettings()
    const themeId = settings.theme.id

    useEffect(() => {
        applyThemeToDocument(themeId)
    }, [themeId])

    const value = useMemo<AppThemeContextValue>(() => {
        return {
            themeId,
            setThemeId,
            colors: getDiagramColors(themeId),
            tokens: resolveThemeTokensForId(themeId),
            isLight: isLightTheme(themeId),
        }
    }, [themeId, setThemeId])

    return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>
}

export function useAppTheme(): AppThemeContextValue {
    const ctx = useContext(AppThemeContext)
    if (!ctx) throw new Error('useAppTheme must be used within AppThemeProvider')
    return ctx
}
