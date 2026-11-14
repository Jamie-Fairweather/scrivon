import { describe, expect, it, vi } from 'vitest'
import { FOLLOW_SYSTEM, type ThemeSetting } from '@/lib/settings/types'
import { APP_THEME_IDS, isLightTheme, type AppThemeId } from '@/lib/theme/catalog'
import { buildThemeCommands, THEME_TWINS, themeToggleTarget } from '@/components/studio/theme/theme-commands'

describe('themeToggleTarget', () => {
    it("switches to the same family's light or dark version", () => {
        expect(themeToggleTarget('nord', null)).toBe('nord-light')
        expect(themeToggleTarget('nord-light', null)).toBe('nord')
        expect(themeToggleTarget('catppuccin-mocha', null)).toBe('catppuccin-latte')
    })

    it('goes back to the theme the last switch came from', () => {
        expect(themeToggleTarget('tokyo-night-storm', null)).toBe('tokyo-night-light')
        expect(themeToggleTarget('tokyo-night-light', { from: 'tokyo-night-storm', to: 'tokyo-night-light' })).toBe('tokyo-night-storm')
        expect(themeToggleTarget('scrivon-light', { from: 'dracula', to: 'scrivon-light' })).toBe('dracula')
    })

    it('falls back to Scrivon for themes with no twin', () => {
        expect(themeToggleTarget('dracula', null)).toBe('scrivon-light')
        expect(themeToggleTarget('one-dark', null)).toBe('scrivon-light')
    })

    it('ignores a last switch the user has since moved away from', () => {
        expect(themeToggleTarget('github-light', { from: 'dracula', to: 'scrivon-light' })).toBe('github-dark')
    })

    it('only pairs real themes of the opposite kind', () => {
        for (const [id, twin] of Object.entries(THEME_TWINS) as Array<[AppThemeId, AppThemeId]>) {
            expect(APP_THEME_IDS).toContain(id)
            expect(APP_THEME_IDS).toContain(twin)
            expect(isLightTheme(twin)).toBe(!isLightTheme(id))
        }
    })
})

describe('buildThemeCommands', () => {
    const build = (themeId: AppThemeId = 'scrivon-light', theme: ThemeSetting = { id: themeId, light: 'scrivon-light', dark: 'scrivon-dark' }) => {
        const ctx = {
            theme,
            themeId,
            isLight: isLightTheme(themeId),
            toggleLightDark: vi.fn(),
            setThemeId: vi.fn(),
            setSystemThemeId: vi.fn(),
            setFollowSystem: vi.fn(),
        }
        return { ctx, commands: buildThemeCommands(ctx) }
    }

    it('switches between light and dark', () => {
        const { ctx, commands } = build('scrivon-light')
        const toggle = commands.find((c) => c.id === 'toggle-theme')
        expect(toggle?.label).toBe('Switch to Dark Theme')
        void toggle!.run()
        expect(ctx.toggleLightDark).toHaveBeenCalledTimes(1)
        expect(build('dracula').commands.find((c) => c.id === 'toggle-theme')?.label).toBe('Switch to Light Theme')
    })

    it('has a command for every theme, found by its name, that picks it', () => {
        const { ctx, commands } = build()
        const themes = commands.filter((c) => c.id.startsWith('theme:') && c.id !== 'theme:follow-windows')
        expect(themes).toHaveLength(APP_THEME_IDS.length)

        const tokyo = themes.find((c) => c.id === 'theme:tokyo-night')
        expect(tokyo).toMatchObject({ label: 'Theme: Tokyo Night', disabled: false })
        expect(tokyo?.keywords).toContain('dark')
        void tokyo!.run()
        expect(ctx.setThemeId).toHaveBeenCalledWith('tokyo-night')
    })

    it('says which theme is in use now', () => {
        const current = build('nord').commands.find((c) => c.id === 'theme:nord')
        expect(current).toMatchObject({ disabled: true, disabledReason: 'Current theme' })
    })

    describe('with Follow Windows on', () => {
        // Windows is dark, so Nord shows; GitHub Light is the pick for when Windows is light.
        const following: ThemeSetting = { id: FOLLOW_SYSTEM, light: 'github-light', dark: 'nord' }
        const find = (commands: ReturnType<typeof build>['commands'], id: string) => commands.find((c) => c.id === id)

        it('sets the pick for the theme kind and keeps following Windows', () => {
            const { ctx, commands } = build('nord', following)
            void find(commands, 'theme:dracula')!.run()
            void find(commands, 'theme:solarized-light')!.run()
            expect(ctx.setSystemThemeId).toHaveBeenNthCalledWith(1, 'dracula')
            expect(ctx.setSystemThemeId).toHaveBeenNthCalledWith(2, 'solarized-light')
            expect(ctx.setThemeId).not.toHaveBeenCalled()
        })

        it('says which Windows mode each theme is for, and marks both picks', () => {
            const { commands } = build('nord', following)
            expect(find(commands, 'theme:dracula')).toMatchObject({ detail: 'When Windows is dark', disabled: false })
            expect(find(commands, 'theme:solarized-light')).toMatchObject({ detail: 'When Windows is light', disabled: false })
            expect(find(commands, 'theme:nord')).toMatchObject({ disabled: true, disabledReason: 'Current theme' })
            expect(find(commands, 'theme:github-light')).toMatchObject({ disabled: true, disabledReason: 'Current theme' })
            expect(find(commands, 'theme:nord-light')?.disabled).toBe(false)
        })

        it('shows no Windows mode when a fixed theme is in use', () => {
            expect(find(build('nord').commands, 'theme:dracula')?.detail).toBeUndefined()
        })

        it('says the light/dark switch stops following Windows', () => {
            const { ctx, commands } = build('nord', following)
            const toggle = find(commands, 'toggle-theme')
            expect(toggle).toMatchObject({ label: 'Switch to Light Theme', detail: 'Stops following Windows' })
            void toggle!.run()
            expect(ctx.toggleLightDark).toHaveBeenCalledTimes(1)
            expect(find(build('nord').commands, 'toggle-theme')?.detail).toBeUndefined()
        })

        it('turns Follow Windows off and on', () => {
            const on = build('nord', following)
            const command = find(on.commands, 'theme:follow-windows')
            expect(command).toMatchObject({ label: 'Theme: Follow Windows', checked: true })
            void command!.run()
            expect(on.ctx.setFollowSystem).toHaveBeenCalledWith(false)

            const off = build('nord')
            const offCommand = find(off.commands, 'theme:follow-windows')
            expect(offCommand?.checked).toBe(false)
            void offCommand!.run()
            expect(off.ctx.setFollowSystem).toHaveBeenCalledWith(true)
        })
    })
})
