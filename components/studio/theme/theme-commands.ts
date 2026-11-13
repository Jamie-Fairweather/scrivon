'use client'

import { useCallback, useMemo, useState } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import {
    APP_DARK_THEME_IDS,
    APP_LIGHT_THEME_IDS,
    APP_THEME_LABELS,
    isLightTheme,
    SYSTEM_DARK_THEME,
    SYSTEM_LIGHT_THEME,
    type AppThemeId,
} from '@/lib/theme/catalog'

/** The other half of each theme family that has both a light and a dark version. */
export const THEME_TWINS: Partial<Record<AppThemeId, AppThemeId>> = {
    'scrivon-light': 'scrivon-dark',
    'scrivon-dark': 'scrivon-light',
    'zinc-light': 'zinc-dark',
    'zinc-dark': 'zinc-light',
    'tokyo-night': 'tokyo-night-light',
    'tokyo-night-storm': 'tokyo-night-light',
    'tokyo-night-light': 'tokyo-night',
    'catppuccin-mocha': 'catppuccin-latte',
    'catppuccin-latte': 'catppuccin-mocha',
    nord: 'nord-light',
    'nord-light': 'nord',
    'github-light': 'github-dark',
    'github-dark': 'github-light',
    'solarized-light': 'solarized-dark',
    'solarized-dark': 'solarized-light',
}

/** The last light/dark switch, so switching back returns to the theme the user had. */
export type ThemeToggle = { from: AppThemeId; to: AppThemeId }

/**
 * Where 'Switch to Light/Dark Theme' goes from `current`: back to the theme the last switch
 * came from, else the same family's light or dark twin, else Scrivon Light or Dark.
 */
export function themeToggleTarget(current: AppThemeId, lastToggle: ThemeToggle | null): AppThemeId {
    if (lastToggle && lastToggle.to === current && isLightTheme(lastToggle.from) !== isLightTheme(current)) return lastToggle.from
    return THEME_TWINS[current] ?? (isLightTheme(current) ? SYSTEM_DARK_THEME : SYSTEM_LIGHT_THEME)
}

export type ThemeCommandsContext = {
    themeId: AppThemeId
    isLight: boolean
    toggleLightDark: () => void
    setThemeId: (id: AppThemeId) => void
}

/** The light/dark switch, and one command per theme so typing a theme's name finds it. */
export function buildThemeCommands(ctx: ThemeCommandsContext): AppCommand[] {
    const pick = (id: AppThemeId): AppCommand => ({
        id: `theme:${id}`,
        label: `Theme: ${APP_THEME_LABELS[id]}`,
        keywords: `theme colour color ${isLightTheme(id) ? 'light' : 'dark'}`,
        disabled: id === ctx.themeId,
        disabledReason: 'Current theme',
        run: () => ctx.setThemeId(id),
    })

    return [
        {
            id: 'toggle-theme',
            label: ctx.isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme',
            keywords: 'theme light dark toggle',
            run: () => ctx.toggleLightDark(),
        },
        ...APP_DARK_THEME_IDS.map(pick),
        ...APP_LIGHT_THEME_IDS.map(pick),
    ]
}

export function useThemeCommands(): void {
    const { themeId, isLight, setThemeId } = useAppTheme()

    // Kept for the app session, so switching light/dark twice lands back on the user's theme.
    const [lastThemeToggle, setLastThemeToggle] = useState<ThemeToggle | null>(null)
    const toggleLightDark = useCallback(() => {
        const target = themeToggleTarget(themeId, lastThemeToggle)
        setLastThemeToggle({ from: themeId, to: target })
        setThemeId(target)
    }, [themeId, lastThemeToggle, setThemeId])

    const commands = useMemo(
        () => buildThemeCommands({ themeId, isLight, toggleLightDark, setThemeId }),
        [themeId, isLight, toggleLightDark, setThemeId]
    )
    useRegisterCommands(commands)
}
