'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyThemeToDocument } from '@/lib/theme/apply-document-theme'
import { DEFAULT_APP_THEME, getDiagramColors, isLightTheme, parseStoredTheme, type AppThemeId, type DiagramColors } from '@/lib/theme/catalog'
import { resolveThemeTokensForId, type ResolvedThemeTokens } from '@/lib/theme/resolve-theme-tokens'
import { STORAGE_MERMAID_THEME } from '@/lib/workspace/types'

type AppThemeContextValue = {
    themeId: AppThemeId
    setThemeId: (id: AppThemeId) => void
    colors: DiagramColors
    tokens: ResolvedThemeTokens
    isLight: boolean
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null)

function readInitialTheme(): AppThemeId {
    if (typeof window === 'undefined') return DEFAULT_APP_THEME
    return parseStoredTheme(localStorage.getItem(STORAGE_MERMAID_THEME))
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
    const [themeId, setThemeIdState] = useState<AppThemeId>(readInitialTheme)

    useEffect(() => {
        applyThemeToDocument(themeId)
    }, [themeId])

    const setThemeId = useCallback((id: AppThemeId) => {
        setThemeIdState(id)
        try {
            localStorage.setItem(STORAGE_MERMAID_THEME, id)
        } catch {
            // private browsing / quota
        }
    }, [])

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
