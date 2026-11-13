import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useAppUpdate } from '@/components/studio/app-update-provider'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { isTauri } from '@/lib/tauri/platform'

vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/app-update-provider', () => ({ useAppUpdate: vi.fn() }))

function mockUpdates(value: { checking: boolean; checkForUpdates: () => Promise<void> }) {
    vi.mocked(useAppUpdate).mockReturnValue(value as unknown as ReturnType<typeof useAppUpdate>)
}
vi.mock('@/components/studio/dialogs/open-source-licenses-dialog', () => ({
    OpenSourceLicensesDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Licences" /> : null),
}))

let shown: ReturnType<typeof useCommands> = []
function CommandsProbe() {
    const commands = useCommands()
    useEffect(() => {
        shown = commands
    }, [commands])
    return null
}

beforeEach(() => {
    shown = []
    vi.mocked(isTauri).mockReturnValue(false)
    mockUpdates({ checking: false, checkForUpdates: vi.fn(async () => {}) })
    vi.mocked(useAppSettings).mockReturnValue({ settings: { keybinds: createDefaultKeybinds(false) } } as unknown as ReturnType<
        typeof useAppSettings
    >)
})

describe('HelpCommands', () => {
    it.each([
        ['about', /About/],
        ['licences', /Licences/],
    ])('opens its dialog from the %s command', (id, name) => {
        render(
            <CommandRegistryProvider>
                <HelpCommands />
                <CommandsProbe />
            </CommandRegistryProvider>
        )
        expect(shown.map((c) => c.label)).toEqual(['About Scrivon…', 'Licences…'])

        act(() => void shown.find((c) => c.id === id)!.run())
        expect(screen.getByRole('dialog', { name })).toBeInTheDocument()
    })

    it('checks for updates from the desktop app, and not while a check is running', () => {
        vi.mocked(isTauri).mockReturnValue(true)
        const checkForUpdates = vi.fn(async () => {})
        mockUpdates({ checking: false, checkForUpdates })
        const { rerender } = render(
            <CommandRegistryProvider>
                <HelpCommands />
                <CommandsProbe />
            </CommandRegistryProvider>
        )
        const command = () => shown.find((c) => c.id === 'check-for-updates')

        expect(command()).toMatchObject({ label: 'Check for Updates…', disabled: false })
        act(() => void command()!.run())
        expect(checkForUpdates).toHaveBeenCalledTimes(1)

        mockUpdates({ checking: true, checkForUpdates })
        rerender(
            <CommandRegistryProvider>
                <HelpCommands />
                <CommandsProbe />
            </CommandRegistryProvider>
        )
        expect(command()).toMatchObject({ disabled: true, disabledReason: 'Already checking' })
    })

    it('has no update check in the browser, which has no updates', () => {
        render(
            <CommandRegistryProvider>
                <HelpCommands />
                <CommandsProbe />
            </CommandRegistryProvider>
        )
        expect(shown.some((c) => c.id === 'check-for-updates')).toBe(false)
    })

    it('can be found by typing "licenses" too', () => {
        render(
            <CommandRegistryProvider>
                <HelpCommands />
                <CommandsProbe />
            </CommandRegistryProvider>
        )
        expect(shown.find((c) => c.id === 'licences')?.keywords).toContain('licenses')
    })
})
