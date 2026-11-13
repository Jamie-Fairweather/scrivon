'use client'

import { useMemo, type ReactNode } from 'react'
import type { PaletteMode } from '@/components/studio/command-palette/types'
import { useCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import { useCommands } from '@/components/studio/commands/command-registry'
import { useGlobalKeybinds, type KeybindHandlers } from '@/components/studio/hooks/use-global-keybinds'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

type GlobalKeybindsProviderProps = {
    children: ReactNode
}

/**
 * Runs the app's shortcuts. Each runs the shared command that names it as its `keybind`, so the keys
 * do what the menu item and the palette row do, and nothing while the command is greyed out there.
 */
export function GlobalKeybindsProvider({ children }: GlobalKeybindsProviderProps) {
    const { isDesktop, workspaceRoot } = useWorkspaceSession()
    const { settings, settingsOpen } = useAppSettings()
    const { openMode } = useCommandPalette()
    const commands = useCommands()

    const handlers = useMemo(() => {
        // The palette's own keys: the palette isn't a command in itself.
        const result: KeybindHandlers = {
            'palette.open': () => {
                openMode('all' satisfies PaletteMode)
                return true
            },
            'palette.openText': () => {
                openMode('text' satisfies PaletteMode)
                return true
            },
            'palette.openFiles': () => {
                openMode('files' satisfies PaletteMode)
                return true
            },
        }
        for (const command of commands) {
            if (!command.keybind || result[command.keybind]) continue
            result[command.keybind] = () => {
                if (!command.disabled) void command.run()
                // Taken even while the command is off, so the keys never reach the web view (Ctrl+R reloads it).
                return true
            }
        }
        return result
    }, [commands, openMode])

    // Off while Settings is open, so recording a shortcut there never also runs the action it's bound to.
    useGlobalKeybinds(settings.keybinds, handlers, { enabled: isDesktop && !settingsOpen, hasWorkspace: Boolean(workspaceRoot) })

    return children
}
