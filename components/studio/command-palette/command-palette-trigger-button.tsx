'use client'

import { SearchIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'

type CommandPaletteTriggerButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick' | 'title'>

export function CommandPaletteTriggerButton(props: CommandPaletteTriggerButtonProps) {
    const { isDesktop } = useWorkspaceSession()
    const { open } = useCommandPalette()
    const { settings } = useAppSettings()

    if (!isDesktop) return null

    // The user's own shortcut, which can be changed or cleared in Settings > Keyboard.
    const keys = formatKeybindForAction('palette.open', settings.keybinds)

    return (
        <IconTooltip label={keys ? `Search (${keys})` : 'Search'}>
            <Button aria-label="Search" size="icon-sm" variant="ghost" onClick={() => open()} {...props}>
                <SearchIcon className="size-4" />
            </Button>
        </IconTooltip>
    )
}
