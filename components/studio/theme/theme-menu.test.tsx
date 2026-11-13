import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Menu, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import type { ThemeSetting } from '@/lib/settings/types'
import { APP_THEME_IDS } from '@/lib/theme/catalog'
import { ThemeMenu } from './theme-menu'

const state = vi.hoisted(() => ({ theme: { id: 'nord', light: 'scrivon-light', dark: 'scrivon-dark' } as ThemeSetting }))
const setThemeId = vi.fn()
const setFollowSystem = vi.fn()
const setSystemThemeId = vi.fn()

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { theme: state.theme }, setThemeId, setFollowSystem, setSystemThemeId }),
}))

async function openThemeMenu() {
    render(
        <Menu defaultOpen>
            <MenuTrigger>Options</MenuTrigger>
            <MenuPopup>
                <ThemeMenu />
            </MenuPopup>
        </Menu>
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Theme' }))
    await waitFor(() => expect(screen.getAllByRole('menuitemradio').length).toBeGreaterThan(0))
}

function checkedThemes() {
    return screen
        .getAllByRole('menuitemradio')
        .filter((item) => item.getAttribute('aria-checked') === 'true')
        .map((item) => item.textContent)
}

describe('ThemeMenu', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.theme = { id: 'nord', light: 'scrivon-light', dark: 'scrivon-dark' }
    })

    it('lists every theme one level down as a single-choice group, with the current one checked', async () => {
        await openThemeMenu()

        expect(screen.getAllByRole('menuitemradio')).toHaveLength(APP_THEME_IDS.length)
        expect(screen.getByRole('menuitemcheckbox', { name: 'Follow Windows' })).toHaveAttribute('aria-checked', 'false')
        expect(screen.getByRole('group', { name: 'Dark' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: 'Light' })).toBeInTheDocument()
        expect(checkedThemes()).toEqual(['Nord'])
    })

    it('switches theme when a palette is picked', async () => {
        await openThemeMenu()

        await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dracula' }))

        expect(setThemeId).toHaveBeenCalledWith('dracula')
    })

    it('turns on following Windows', async () => {
        await openThemeMenu()

        await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Follow Windows' }))

        expect(setFollowSystem).toHaveBeenCalledWith(true)
    })

    it('when following Windows, shows and sets the theme for Windows light and the one for Windows dark', async () => {
        state.theme = { id: 'system', light: 'github-light', dark: 'nord' }
        await openThemeMenu()

        expect(screen.getByRole('menuitemcheckbox', { name: 'Follow Windows' })).toHaveAttribute('aria-checked', 'true')
        expect(screen.getByRole('group', { name: 'When Windows is dark' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: 'When Windows is light' })).toBeInTheDocument()
        expect(checkedThemes()).toEqual(['Nord', 'GitHub Light'])

        await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dracula' }))
        await userEvent.click(screen.getByRole('menuitemradio', { name: 'Solarized Light' }))

        expect(setSystemThemeId.mock.calls).toEqual([['dracula'], ['solarized-light']])
        expect(setThemeId).not.toHaveBeenCalled()
    })

    it('turns off following Windows', async () => {
        state.theme = { id: 'system', light: 'github-light', dark: 'nord' }
        await openThemeMenu()

        await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Follow Windows' }))

        expect(setFollowSystem).toHaveBeenCalledWith(false)
    })
})
