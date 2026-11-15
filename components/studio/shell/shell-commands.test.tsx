import { act, render } from '@testing-library/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { commandShortcut } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { buildExitCommand, buildSettingsCommand, useExitCommand, type ExitCommandContext } from '@/components/studio/shell/shell-commands'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

const close = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn(() => ({ close })) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: vi.fn() }))

function exitContext(overrides: Partial<ExitCommandContext> = {}): ExitCommandContext {
    return { isDesktop: true, isMac: false, exitApp: vi.fn(), ...overrides }
}

describe('buildSettingsCommand', () => {
    it('opens Settings on its app shortcut', () => {
        const openSettings = vi.fn()
        const settings = buildSettingsCommand(openSettings)
        expect(settings).toMatchObject({ label: 'Settings…', keybind: 'settings.open' })
        void settings.run()
        expect(openSettings).toHaveBeenCalledTimes(1)
    })
})

describe('buildExitCommand', () => {
    it("exits the app, showing Windows' own shortcut for it", () => {
        const ctx = exitContext()
        const exit = buildExitCommand(ctx)
        expect(exit).toMatchObject({ label: 'Exit', disabled: false })
        expect(commandShortcut(exit, createDefaultKeybinds(false), false)).toBe('Alt+F4')
        void exit.run()
        expect(ctx.exitApp).toHaveBeenCalledTimes(1)
    })

    it('shows the Mac quit keys on a Mac, and is off outside the desktop app', () => {
        expect(commandShortcut(buildExitCommand(exitContext({ isMac: true })), createDefaultKeybinds(true), true)).toBe('⌘Q')
        expect(buildExitCommand(exitContext({ isDesktop: false }))).toMatchObject({ disabled: true, disabledReason: 'Desktop only' })
    })
})

describe('useExitCommand', () => {
    it('writes waiting settings, then closes the window, which asks about unsaved changes', () => {
        const flushPendingSettings = vi.fn()
        vi.mocked(useAppSettings).mockReturnValue({
            settings: { keybinds: createDefaultKeybinds(false) },
            flushPendingSettings,
        } as unknown as ReturnType<typeof useAppSettings>)
        vi.mocked(useWorkspaceSession).mockReturnValue({ isDesktop: true } as ReturnType<typeof useWorkspaceSession>)
        let shown: ReturnType<typeof useCommands> = []
        function Exit() {
            useExitCommand()
            const commands = useCommands()
            useEffect(() => {
                shown = commands
            }, [commands])
            return null
        }
        render(
            <CommandRegistryProvider>
                <Exit />
            </CommandRegistryProvider>
        )

        act(() => void shown.find((c) => c.id === 'exit')!.run())

        expect(flushPendingSettings).toHaveBeenCalledTimes(1)
        expect(getCurrentWindow).toHaveBeenCalled()
        expect(close).toHaveBeenCalledTimes(1)
    })
})
