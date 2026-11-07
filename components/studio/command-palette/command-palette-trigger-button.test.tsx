import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { KeybindBindings } from '@/lib/settings/types'

const open = vi.fn()
let keybinds: KeybindBindings = createDefaultKeybinds(false)

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: () => ({ isDesktop: true }) }))
vi.mock('@/components/studio/command-palette/command-palette-provider', () => ({ useCommandPalette: () => ({ open }) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: () => ({ settings: { keybinds } }) }))
vi.mock('@/lib/settings/chord-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/settings/chord-utils')>()),
    isMacPlatform: () => false,
}))

const { CommandPaletteTriggerButton } = await import('./command-palette-trigger-button')

beforeEach(() => {
    keybinds = createDefaultKeybinds(false)
    open.mockClear()
})

describe('CommandPaletteTriggerButton', () => {
    it('opens the palette, and shows its shortcut in a tooltip on keyboard focus instead of a title', async () => {
        render(<CommandPaletteTriggerButton />)
        const button = screen.getByRole('button', { name: 'Search' })
        expect(button).not.toHaveAttribute('title')

        act(() => button.focus())
        expect(await screen.findByText('Search (F1)')).toBeInTheDocument()

        fireEvent.click(button)
        expect(open).toHaveBeenCalledTimes(1)
    })

    it('shows the shortcut the user picked in Settings', async () => {
        keybinds = { ...keybinds, 'palette.open': [{ key: 'k', ctrl: true }] }
        render(<CommandPaletteTriggerButton />)

        act(() => screen.getByRole('button', { name: 'Search' }).focus())
        expect(await screen.findByText('Search (Ctrl+K)')).toBeInTheDocument()
    })

    it('leaves the shortcut out when none is set', async () => {
        keybinds = { ...keybinds, 'palette.open': [] }
        render(<CommandPaletteTriggerButton />)

        act(() => screen.getByRole('button', { name: 'Search' }).focus())
        expect(await screen.findByText('Search')).toBeInTheDocument()
        expect(screen.queryByText(/Search \(/)).not.toBeInTheDocument()
    })
})
