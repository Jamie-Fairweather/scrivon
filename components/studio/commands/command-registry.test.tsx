import { render, screen } from '@testing-library/react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { CommandRegistryProvider, useCommand, useCommands, useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { KeybindBindings } from '@/lib/settings/types'

vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))

let keybinds: KeybindBindings

beforeEach(() => {
    keybinds = createDefaultKeybinds(false)
    vi.mocked(useAppSettings).mockImplementation(() => ({ settings: { keybinds } }) as unknown as ReturnType<typeof useAppSettings>)
})

function Feature({ commands }: { commands: AppCommand[] }) {
    useRegisterCommands(commands)
    return null
}

/** A feature that builds its list each render, as the real ones do with useMemo. */
function SaveFeature({ disabled }: { disabled: boolean }) {
    const commands = useMemo<AppCommand[]>(() => [{ id: 'save', label: 'Save', keybind: 'document.save', disabled, run: () => {} }], [disabled])
    useRegisterCommands(commands)
    return null
}

function CommandList() {
    const commands = useCommands()
    return (
        <ul aria-label="commands">
            {commands.map((c) => (
                <li key={c.id}>{[c.label, c.shortcut, c.disabled ? 'off' : 'on'].filter(Boolean).join(' | ')}</li>
            ))}
        </ul>
    )
}

function OneCommand({ id }: { id: string }) {
    const command = useCommand(id)
    return <p>{command ? `found ${command.label}` : 'missing'}</p>
}

const listed = () => Array.from(screen.getByRole('list', { name: 'commands' }).querySelectorAll('li'), (li) => li.textContent)

describe('useRegisterCommands and useCommands', () => {
    it("lists each feature's commands with the user's current shortcut", () => {
        render(
            <CommandRegistryProvider>
                <SaveFeature disabled={false} />
                <Feature commands={[{ id: 'about', label: 'About', run: () => {} }]} />
                <CommandList />
            </CommandRegistryProvider>
        )

        expect(listed()).toEqual(['Save | Ctrl+S | on', 'About | on'])
    })

    it('follows a change to a command without moving it, and a change to the shortcut', () => {
        const view = render(
            <CommandRegistryProvider>
                <SaveFeature disabled={false} />
                <Feature commands={[{ id: 'about', label: 'About', run: () => {} }]} />
                <CommandList />
            </CommandRegistryProvider>
        )

        keybinds = { ...keybinds, 'document.save': [{ key: 'F9' }] }
        view.rerender(
            <CommandRegistryProvider>
                <SaveFeature disabled />
                <Feature commands={[{ id: 'about', label: 'About', run: () => {} }]} />
                <CommandList />
            </CommandRegistryProvider>
        )

        expect(listed()).toEqual(['Save | F9 | off', 'About | on'])
    })

    it("drops a feature's commands when it goes away", () => {
        const view = render(
            <CommandRegistryProvider>
                <SaveFeature disabled={false} />
                <CommandList />
            </CommandRegistryProvider>
        )

        view.rerender(
            <CommandRegistryProvider>
                <CommandList />
            </CommandRegistryProvider>
        )

        expect(listed()).toEqual([])
    })

    it('finds one command by id', () => {
        render(
            <CommandRegistryProvider>
                <SaveFeature disabled={false} />
                <OneCommand id="save" />
                <OneCommand id="exit" />
            </CommandRegistryProvider>
        )

        expect(screen.getByText('found Save')).toBeInTheDocument()
        expect(screen.getByText('missing')).toBeInTheDocument()
    })

    it('does nothing without a registry above, so a feature also works on its own', () => {
        render(
            <>
                <SaveFeature disabled={false} />
                <CommandList />
            </>
        )

        expect(listed()).toEqual([])
    })
})
