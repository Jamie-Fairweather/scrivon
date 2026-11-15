'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { commandShortcut, createCommandStore, type AppCommand, type CommandGroup, type CommandStore } from '@/components/studio/commands/app-command'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

/** A command as the palette and the menus show it: with the keys to press, in the user's current bindings. */
export type ShownCommand = AppCommand & { shortcut?: string }

const CommandStoreContext = createContext<CommandStore | null>(null)

/** Holds the app's commands. Features add theirs with useRegisterCommands; the palette and menu bar read them with useCommands. */
export function CommandRegistryProvider({ children }: { children: ReactNode }) {
    const [store] = useState(createCommandStore)
    return <CommandStoreContext.Provider value={store}>{children}</CommandStoreContext.Provider>
}

/**
 * Adds a feature's commands for as long as the calling component is mounted. Pass a memoized list:
 * each new list replaces the last (keeping its place in the palette). Does nothing without a
 * CommandRegistryProvider above, so the feature also works on its own.
 */
export function useRegisterCommands(commands: readonly AppCommand[]): void {
    const store = useContext(CommandStoreContext)
    const groupRef = useRef<CommandGroup | null>(null)
    const commandsRef = useRef(commands)

    useEffect(() => {
        commandsRef.current = commands
        groupRef.current?.set(commands)
    }, [commands])

    useEffect(() => {
        if (!store) return
        const group = store.add()
        group.set(commandsRef.current)
        groupRef.current = group
        return () => {
            group.remove()
            groupRef.current = null
        }
    }, [store])
}

const NO_STORE_SNAPSHOT: readonly AppCommand[] = []
const noStoreSubscribe = () => () => {}
const noStoreSnapshot = () => NO_STORE_SNAPSHOT

/** Every registered command, in the order the features added them, with its current shortcut. */
export function useCommands(): readonly ShownCommand[] {
    const store = useContext(CommandStoreContext)
    const commands = useSyncExternalStore(store?.subscribe ?? noStoreSubscribe, store?.getSnapshot ?? noStoreSnapshot, noStoreSnapshot)
    const { settings } = useAppSettings()
    const keybinds = settings.keybinds
    return useMemo(() => commands.map((command) => ({ ...command, shortcut: commandShortcut(command, keybinds) })), [commands, keybinds])
}
