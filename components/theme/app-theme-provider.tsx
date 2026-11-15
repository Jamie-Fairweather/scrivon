'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { isTauri } from '@/lib/tauri/platform'
import { applyThemeToDocument } from '@/lib/theme/apply-document-theme'
import { getDiagramColors, isLightTheme, type AppThemeId, type DiagramColors } from '@/lib/theme/catalog'
import { resolveThemeTokensForId, type ResolvedThemeTokens } from '@/lib/theme/resolve-theme-tokens'
import { resolveThemeSetting, systemPrefersDark, watchSystemTheme } from '@/lib/theme/system-theme'

type AppThemeContextValue = {
    /** The theme on screen: the fixed one, or in System mode the one that matches Windows. */
    themeId: AppThemeId
    /** Uses this theme all the time (leaves System mode). */
    setThemeId: (id: AppThemeId) => void
    colors: DiagramColors
    tokens: ResolvedThemeTokens
    isLight: boolean
}

const AppThemeContext = createContext<AppThemeContextValue | null>(null)

/** How long showing the window waits for a paint. A hidden window may not draw at all. */
const PAINT_WAIT_MS = 100

/** Resolves once the page has painted (two animation frames), or after a short wait when it isn't drawing. */
function afterPaint(): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, PAINT_WAIT_MS)
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                clearTimeout(timer)
                resolve()
            })
        )
    })
}

/**
 * Whether Windows is set to dark, kept up to date as it changes. While the page hydrates it reads
 * the real setting too: nothing in the markup depends on it, and the boot script already painted it.
 */
function useSystemPrefersDark(): boolean {
    return useSyncExternalStore(watchSystemTheme, systemPrefersDark, systemPrefersDark)
}

/**
 * The app's only theme system: it owns the `dark` class and theme variables on <html>.
 * Do not add next-themes. Registry components that call its useTheme() should use useAppTheme() instead.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
    const { settings, setThemeId } = useAppSettings()
    const themeId = resolveThemeSetting(settings.theme, useSystemPrefersDark())
    const windowShown = useRef(false)

    useEffect(() => {
        applyThemeToDocument(themeId)
        if (!isTauri()) return
        const appWindow = getCurrentWebviewWindow()
        // The window's own colour shows before the page paints, and at the edges a resize uncovers.
        const colored = appWindow.setBackgroundColor(resolveThemeTokensForId(themeId).bg).catch(() => undefined)
        if (windowShown.current) return
        windowShown.current = true
        // The window starts hidden (tauri.conf.json), so a light theme never opens on the dark default colour.
        // If this never runs, the app shows the window by itself after a few seconds.
        void colored
            .then(afterPaint)
            .then(() => appWindow.show())
            .catch((err: unknown) => console.warn("Couldn't show the window", err))
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
