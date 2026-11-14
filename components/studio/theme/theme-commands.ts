'use client'

import { useCallback, useMemo, useState } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { FOLLOW_SYSTEM, type ThemeSetting } from '@/lib/settings/types'
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
    /** The saved setting: a fixed theme, or Follow Windows with a light and a dark pick. */
    theme: ThemeSetting
    /** The theme on screen. */
    themeId: AppThemeId
    isLight: boolean
    toggleLightDark: () => void
    /** Uses this theme all the time (stops following Windows). */
    setThemeId: (id: AppThemeId) => void
    /** Sets the theme Follow Windows uses for that theme's kind (light or dark). */
    setSystemThemeId: (id: AppThemeId) => void
    setFollowSystem: (on: boolean) => void
}

/** The light/dark switch, Follow Windows on/off, and one command per theme so typing a theme's name finds it. */
export function buildThemeCommands(ctx: ThemeCommandsContext): AppCommand[] {
    const following = ctx.theme.id === FOLLOW_SYSTEM
    // With Follow Windows on, a theme becomes the pick for its kind, as in Options > Theme.
    const pick = (id: AppThemeId): AppCommand => {
        const kind = isLightTheme(id) ? 'light' : 'dark'
        const current = following ? ctx.theme[kind] : ctx.themeId
        return {
            id: `theme:${id}`,
            label: `Theme: ${APP_THEME_LABELS[id]}`,
            keywords: `theme colour color ${kind}`,
            detail: following ? `When Windows is ${kind}` : undefined,
            disabled: id === current,
            disabledReason: 'Current theme',
            run: () => (following ? ctx.setSystemThemeId(id) : ctx.setThemeId(id)),
        }
    }

    return [
        {
            id: 'toggle-theme',
            label: ctx.isLight ? 'Switch to Dark Theme' : 'Switch to Light Theme',
            keywords: 'theme light dark toggle',
            // It sets a fixed theme, so say so rather than quietly turning Follow Windows off.
            detail: following ? 'Stops following Windows' : undefined,
            run: () => ctx.toggleLightDark(),
        },
        {
            // A theme: id, so the palette ranks it with the themes, below the light/dark switch.
            id: 'theme:follow-windows',
            label: 'Theme: Follow Windows',
            keywords: 'theme light dark system auto',
            checked: following,
            run: () => ctx.setFollowSystem(!following),
        },
        ...APP_DARK_THEME_IDS.map(pick),
        ...APP_LIGHT_THEME_IDS.map(pick),
    ]
}

export function useThemeCommands(): void {
    const { themeId, isLight, setThemeId } = useAppTheme()
    const { settings, setSystemThemeId, setFollowSystem } = useAppSettings()
    const theme = settings.theme

    // Kept for the app session, so switching light/dark twice lands back on the user's theme.
    const [lastThemeToggle, setLastThemeToggle] = useState<ThemeToggle | null>(null)
    const toggleLightDark = useCallback(() => {
        const target = themeToggleTarget(themeId, lastThemeToggle)
        setLastThemeToggle({ from: themeId, to: target })
        setThemeId(target)
    }, [themeId, lastThemeToggle, setThemeId])

    const commands = useMemo(
        () => buildThemeCommands({ theme, themeId, isLight, toggleLightDark, setThemeId, setSystemThemeId, setFollowSystem }),
        [theme, themeId, isLight, toggleLightDark, setThemeId, setSystemThemeId, setFollowSystem]
    )
    useRegisterCommands(commands)
}
