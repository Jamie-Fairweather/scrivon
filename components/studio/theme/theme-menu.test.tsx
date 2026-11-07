import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Menu, MenuPopup, MenuTrigger } from '@/components/ui/menu'
import { APP_THEME_IDS } from '@/lib/theme/catalog'
import { ThemeMenu } from './theme-menu'

const setThemeId = vi.fn()

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => ({ themeId: 'nord', setThemeId }),
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

describe('ThemeMenu', () => {
    beforeEach(() => {
        setThemeId.mockClear()
    })

    it('lists every theme one level down as a single-choice group, with the current one checked', async () => {
        await openThemeMenu()

        const items = screen.getAllByRole('menuitemradio')
        expect(items).toHaveLength(APP_THEME_IDS.length)
        expect(screen.queryAllByRole('menuitemcheckbox')).toHaveLength(0)
        expect(screen.getByRole('group', { name: 'Dark' })).toBeInTheDocument()
        expect(screen.getByRole('group', { name: 'Light' })).toBeInTheDocument()

        const checked = items.filter((item) => item.getAttribute('aria-checked') === 'true')
        expect(checked).toHaveLength(1)
        expect(checked[0]).toHaveTextContent('Nord')
    })

    it('switches theme when a palette is picked', async () => {
        await openThemeMenu()

        await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dracula' }))

        expect(setThemeId).toHaveBeenCalledWith('dracula')
    })
})
