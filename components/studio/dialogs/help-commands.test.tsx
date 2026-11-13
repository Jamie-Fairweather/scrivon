import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { createDefaultKeybinds } from '@/lib/settings/defaults'

vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
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
