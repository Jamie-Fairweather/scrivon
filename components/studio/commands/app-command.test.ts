import { describe, expect, it, vi } from 'vitest'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { commandShortcut, createCommandStore, type AppCommand } from '@/components/studio/commands/app-command'

function command(id: string, overrides: Partial<AppCommand> = {}): AppCommand {
    return { id, label: id, run: () => {}, ...overrides }
}

const ids = (commands: readonly AppCommand[]) => commands.map((c) => c.id)

describe('createCommandStore', () => {
    it('lists every group of commands in the order the groups were added', () => {
        const store = createCommandStore()
        const file = store.add()
        const view = store.add()

        view.set([command('toggle-explorer')])
        file.set([command('save'), command('save-all')])

        expect(ids(store.getSnapshot())).toEqual(['save', 'save-all', 'toggle-explorer'])
    })

    it('keeps a group in its place when its commands change', () => {
        const store = createCommandStore()
        const file = store.add()
        const view = store.add()
        file.set([command('save')])
        view.set([command('toggle-explorer')])

        file.set([command('save', { disabled: true })])

        expect(ids(store.getSnapshot())).toEqual(['save', 'toggle-explorer'])
        expect(store.getSnapshot()[0]?.disabled).toBe(true)
    })

    it('drops a removed group', () => {
        const store = createCommandStore()
        const file = store.add()
        store.add().set([command('about')])
        file.set([command('save')])

        file.remove()

        expect(ids(store.getSnapshot())).toEqual(['about'])
    })

    it('tells listeners about each change, until they stop listening', () => {
        const store = createCommandStore()
        const listener = vi.fn()
        const stop = store.subscribe(listener)
        const group = store.add()

        group.set([command('save')])
        group.remove()
        expect(listener).toHaveBeenCalledTimes(2)

        stop()
        store.add().set([command('about')])
        expect(listener).toHaveBeenCalledTimes(2)
    })

    it('gives back the same list until something changes, so React can tell nothing did', () => {
        const store = createCommandStore()
        store.add().set([command('save')])

        expect(store.getSnapshot()).toBe(store.getSnapshot())
    })

    it('keeps the first command when two groups use the same id, so the menu and palette agree', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const store = createCommandStore()
        store.add().set([command('save', { label: 'Save' })])
        store.add().set([command('save', { label: 'Save again' })])

        expect(store.getSnapshot().map((c) => c.label)).toEqual(['Save'])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('save'))
        warn.mockRestore()
    })
})

describe('commandShortcut', () => {
    const keybinds = createDefaultKeybinds(false)

    it("shows the user's current keys for an app shortcut", () => {
        expect(commandShortcut(command('save', { keybind: 'document.save' }), keybinds, false)).toBe('Ctrl+S')
        expect(commandShortcut(command('save', { keybind: 'document.save' }), { ...keybinds, 'document.save': [{ key: 'F9' }] }, false)).toBe('F9')
    })

    it('shows nothing for an app shortcut the user cleared', () => {
        expect(commandShortcut(command('save', { keybind: 'document.save' }), { ...keybinds, 'document.save': [] }, false)).toBeUndefined()
    })

    it("shows keys the app doesn't own as given", () => {
        expect(commandShortcut(command('exit', { keys: { key: 'F4', alt: true } }), keybinds, false)).toBe('Alt+F4')
    })

    it('shows nothing for a command with no keys', () => {
        expect(commandShortcut(command('about'), keybinds, false)).toBeUndefined()
    })
})
