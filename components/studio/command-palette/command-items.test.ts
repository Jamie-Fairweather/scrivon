import { describe, expect, it, vi } from 'vitest'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'

describe('commandToPaletteItem', () => {
    it('shows a shared command in the palette exactly as the menus do', () => {
        const run = vi.fn()
        const item = commandToPaletteItem({
            id: 'toggle-explorer',
            label: 'Explorer',
            keywords: 'explorer sidebar toggle',
            keybind: 'view.toggleExplorer',
            shortcut: 'Ctrl+B',
            checked: true,
            disabled: true,
            disabledReason: 'No folder open',
            run,
        })

        expect(item).toEqual({
            kind: 'action',
            value: 'action:toggle-explorer',
            searchText: 'explorer sidebar toggle',
            label: 'Explorer',
            detail: undefined,
            shortcut: 'Ctrl+B',
            checked: true,
            disabled: true,
            disabledReason: 'No folder open',
            run,
        })
    })

    it('matches on the label alone when a command has no extra words', () => {
        expect(commandToPaletteItem({ id: 'about', label: 'About', run: () => {} }).searchText).toBe('')
    })
})
