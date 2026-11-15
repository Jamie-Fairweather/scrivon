import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPaletteCommands, usePaletteCommands } from '@/components/studio/command-palette/palette-commands'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { GlobalKeybindsProvider } from '@/components/studio/settings/global-keybinds-provider'
import { SettingsProvider } from '@/components/studio/settings/settings-provider'

const palette = vi.hoisted(() => ({ provided: true, openMode: vi.fn() }))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ isDesktop: true, workspaceRoot: null }),
}))
vi.mock('@/components/studio/command-palette/command-palette-provider', () => ({
    useCommandPalette: () => ({ openMode: palette.openMode }),
    useOptionalCommandPalette: () => (palette.provided ? { open: vi.fn(), openMode: palette.openMode } : null),
}))

describe('buildPaletteCommands', () => {
    it('opens the palette in each mode, on its own keys', () => {
        const openMode = vi.fn()
        const commands = buildPaletteCommands(openMode)

        expect(commands.map(({ id, label, keybind }) => ({ id, label, keybind }))).toEqual([
            { id: 'command-palette', label: 'Command Palette…', keybind: 'palette.open' },
            { id: 'go-to-file', label: 'Go to File…', keybind: 'palette.openFiles' },
            { id: 'find-in-workspace', label: 'Find in Workspace…', keybind: 'palette.openText' },
        ])

        for (const command of commands) void command.run()
        expect(openMode.mock.calls).toEqual([['all'], ['files'], ['text']])
    })

    it('can always run, as their keys can, also on the welcome screen', () => {
        expect(buildPaletteCommands(vi.fn()).every((command) => !command.disabled)).toBe(true)
    })
})

describe('usePaletteCommands', () => {
    function PaletteCommands() {
        usePaletteCommands()
        return null
    }

    function Providers({ children }: { children: ReactNode }) {
        return (
            <SettingsProvider>
                <CommandRegistryProvider>
                    <PaletteCommands />
                    <GlobalKeybindsProvider>{children}</GlobalKeybindsProvider>
                </CommandRegistryProvider>
            </SettingsProvider>
        )
    }

    afterEach(() => {
        palette.provided = true
        vi.clearAllMocks()
    })

    it('still opens the palette just once on F1, with no folder open', () => {
        const { result } = renderHook(() => useCommands(), { wrapper: Providers })
        expect(result.current.find((command) => command.id === 'command-palette')?.shortcut).toBe('F1')

        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, cancelable: true }))

        expect(palette.openMode.mock.calls).toEqual([['all']])
    })

    it('adds nothing without a palette', () => {
        palette.provided = false
        const { result } = renderHook(() => useCommands(), { wrapper: Providers })
        expect(result.current).toEqual([])
    })
})
