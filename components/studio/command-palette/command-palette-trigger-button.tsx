'use client'

import { SearchIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'

type CommandPaletteTriggerButtonProps = Omit<ComponentProps<typeof Button>, 'children' | 'onClick'>

export function CommandPaletteTriggerButton({ title = 'Search (F1)', ...props }: CommandPaletteTriggerButtonProps) {
    const { isDesktop } = useWorkspaceSession()
    const { open } = useCommandPalette()

    if (!isDesktop) return null

    return (
        <Button aria-label="Search" size="icon-sm" title={title} variant="ghost" onClick={() => open()} {...props}>
            <SearchIcon className="size-4" />
        </Button>
    )
}
