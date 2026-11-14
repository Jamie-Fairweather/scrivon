'use client'

import { useMemo } from 'react'
import { useOptionalCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import type { PaletteMode } from '@/components/studio/command-palette/types'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'

const NO_COMMANDS: AppCommand[] = []

/**
 * Opening the palette, so the menus can too. The keys are run by GlobalKeybindsProvider itself, which
 * skips these commands, so like the keys they work with no folder open too.
 */
export function buildPaletteCommands(openMode: (mode: PaletteMode) => void): AppCommand[] {
    return [
        {
            id: 'command-palette',
            label: 'Command Palette…',
            keywords: 'commands actions search show all',
            keybind: 'palette.open',
            run: () => openMode('all'),
        },
        {
            id: 'go-to-file',
            label: 'Go to File…',
            keywords: 'open quick file name search',
            keybind: 'palette.openFiles',
            run: () => openMode('files'),
        },
        {
            id: 'find-in-workspace',
            label: 'Find in Workspace…',
            keywords: 'search text files folder contents',
            keybind: 'palette.openText',
            run: () => openMode('text'),
        },
    ]
}

/** Nothing without a palette above, as in tests of the menus on their own. */
export function usePaletteCommands(): void {
    const openMode = useOptionalCommandPalette()?.openMode
    const commands = useMemo(() => (openMode ? buildPaletteCommands(openMode) : NO_COMMANDS), [openMode])
    useRegisterCommands(commands)
}
