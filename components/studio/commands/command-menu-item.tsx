'use client'

import type { ShownCommand } from '@/components/studio/commands/command-registry'
import { MenuCheckboxItem, MenuItem, MenuShortcut } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

/** The keys for a menu item, right-aligned. Renders nothing when there are none (or the user cleared them). */
export function MenuHint({ shortcut, className }: { shortcut: string | undefined; className?: string }) {
    return shortcut ? <MenuShortcut className={cn('ps-6 tracking-normal', className)}>{shortcut}</MenuShortcut> : null
}

/** Checkbox rows keep their label in a grid cell, so lay out label and hint as a row inside it. */
function CheckboxLabelWithHint({ label, shortcut }: { label: string; shortcut: string | undefined }) {
    return (
        <span className="flex items-center">
            {label}
            {/* Checkbox rows have more end padding than plain items; pull the hint out to line up with them. */}
            <MenuHint shortcut={shortcut} className="-me-2" />
        </span>
    )
}

/**
 * A menu item for a shared command, with the same label, tick, shortcut and enabled state as the
 * palette shows. Nothing shows while no feature has registered the command. `label` replaces the
 * command's own where its submenu already says it (`PDF…` under Export).
 */
export function CommandMenuItem({ command, variant, label }: { command: ShownCommand | undefined; variant?: 'switch'; label?: string }) {
    if (!command) return null
    const run = () => void command.run()
    if (command.checked !== undefined) {
        return (
            <MenuCheckboxItem variant={variant} checked={command.checked} disabled={command.disabled} onCheckedChange={run}>
                {variant === 'switch' ? command.label : <CheckboxLabelWithHint label={command.label} shortcut={command.shortcut} />}
            </MenuCheckboxItem>
        )
    }
    return (
        <MenuItem disabled={command.disabled} onClick={run}>
            {label ?? command.label}
            <MenuHint shortcut={command.shortcut} />
        </MenuItem>
    )
}
