import { isMacPlatform } from '@/lib/settings/chord-utils'
import { formatChord, formatKeybindForAction } from '@/lib/settings/format-keybind'
import type { KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'

/**
 * One thing the user can do, shown in both the command palette and the menu bar. Each feature
 * registers its own (see useRegisterCommands), so both places always show the same label,
 * on/off state and shortcut.
 */
export type AppCommand = {
    /** Unique id; menus find the command by it, and the palette uses `action:<id>`. */
    id: string
    label: string
    /** More words the palette matches, e.g. 'preferences options'. */
    keywords?: string
    /** Muted second line in the palette, e.g. a recent folder's full path. */
    detail?: string
    /** The app shortcut that runs it; the user's current keys show next to the label. */
    keybind?: KeybindActionId
    /** Keys the app doesn't own (the editor's Ctrl+Z, Windows' Alt+F4), shown as given. */
    keys?: KeybindChord
    /** Set for an on/off setting: menus show a tick, the palette says whether it is on. */
    checked?: boolean
    disabled?: boolean
    /** For an editor shortcut (Bold, Link…) that is off: its keys still do nothing instead of passing on. */
    keepsKeysWhenOff?: boolean
    /** Shown in the palette next to a command that can't run. */
    disabledReason?: string
    run: () => void | Promise<void>
}

/** The keys to show next to a command, or undefined when it has none (or the user cleared them). */
export function commandShortcut(command: AppCommand, keybinds: KeybindBindings, isMac = isMacPlatform()): string | undefined {
    if (command.keybind) return formatKeybindForAction(command.keybind, keybinds, isMac)
    return command.keys ? formatChord(command.keys, isMac) : undefined
}

/** One feature's commands in the store. */
export type CommandGroup = {
    set: (commands: readonly AppCommand[]) => void
    remove: () => void
}

export type CommandStore = {
    /** Adds an empty group. Groups keep the order they were added in, also when their commands change. */
    add: () => CommandGroup
    /** Every command, group by group. The same array until something changes. */
    getSnapshot: () => readonly AppCommand[]
    subscribe: (listener: () => void) => () => void
}

const NO_COMMANDS: readonly AppCommand[] = []

export function createCommandStore(): CommandStore {
    // A Map keeps insertion order, and set() on an existing key keeps the key's place.
    const groups = new Map<symbol, readonly AppCommand[]>()
    const listeners = new Set<() => void>()
    let snapshot = NO_COMMANDS

    const changed = () => {
        const seen = new Set<string>()
        const next: AppCommand[] = []
        for (const command of [...groups.values()].flat()) {
            if (seen.has(command.id)) {
                console.warn(`Two commands use the id '${command.id}'; only the first is shown.`)
                continue
            }
            seen.add(command.id)
            next.push(command)
        }
        snapshot = next
        for (const listener of listeners) listener()
    }

    return {
        add: () => {
            const key = Symbol('commands')
            groups.set(key, NO_COMMANDS)
            return {
                set: (commands) => {
                    if (!groups.has(key)) return
                    groups.set(key, commands)
                    changed()
                },
                remove: () => {
                    if (groups.delete(key)) changed()
                },
            }
        },
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
    }
}
