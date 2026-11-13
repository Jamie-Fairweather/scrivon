import type { ShownCommand } from '@/components/studio/commands/command-registry'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'

/** A shared command as a palette row: the same label, on/off state, shortcut and reason it can't run as in the menus. */
export function commandToPaletteItem(command: ShownCommand): ActionPaletteItem {
    return {
        kind: 'action',
        value: `action:${command.id}`,
        searchText: command.keywords ?? '',
        label: command.label,
        detail: command.detail,
        shortcut: command.shortcut,
        checked: command.checked,
        disabled: command.disabled,
        disabledReason: command.disabledReason,
        run: command.run,
    }
}
