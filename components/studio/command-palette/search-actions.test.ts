import { describe, expect, it } from 'vitest'
import { matchesCommandName, searchActions } from '@/components/studio/command-palette/search-actions'
import type { ActionPaletteItem } from '@/components/studio/command-palette/types'

function action(id: string, label: string, disabled = false): ActionPaletteItem {
    return {
        kind: 'action',
        value: `action:${id}`,
        searchText: label.toLowerCase(),
        label,
        disabled,
        disabledReason: disabled ? 'No tab open' : undefined,
        run: () => {},
    }
}

const actions = [
    action('open-settings', 'Open Settings'),
    action('close-tab', 'Close Tab', true),
    action('close-folder', 'Close Folder'),
    action('close-all-tabs', 'Close All Tabs', true),
    action('toggle-theme', 'Switch to Dark Theme'),
]

function values(items: ActionPaletteItem[]): string[] {
    return items.map((item) => item.value)
}

describe('searchActions', () => {
    it('lists runnable commands before unavailable ones when nothing is typed, keeping their order', () => {
        expect(values(searchActions(actions, ''))).toEqual([
            'action:open-settings',
            'action:close-folder',
            'action:toggle-theme',
            'action:close-tab',
            'action:close-all-tabs',
        ])
    })

    it('keeps the best match on top while typing, even when it cannot run', () => {
        // Moving Close Tab down would make Enter close the folder instead.
        expect(values(searchActions(actions, 'close tab'))[0]).toBe('action:close-tab')
        expect(values(searchActions(actions, 'close')).indexOf('action:close-tab')).toBeLessThan(
            values(searchActions(actions, 'close')).indexOf('action:close-folder')
        )
    })
})

describe('matchesCommandName', () => {
    const theme = action('toggle-theme', 'Switch to Dark Theme')
    const editor = action('toggle-editor', 'Hide Editor')

    it('matches when every typed word starts a word of the name, in any order and case', () => {
        expect(matchesCommandName(theme, 'theme')).toBe(true)
        expect(matchesCommandName(theme, 'dark th')).toBe(true)
        expect(matchesCommandName(theme, 'THEME dark')).toBe(true)
    })

    it('does not match letters scattered across the name', () => {
        // 'todo' and 'data' are letters-in-order matches for these names, not words in them.
        expect(matchesCommandName(editor, 'todo')).toBe(false)
        expect(matchesCommandName(theme, 'data')).toBe(false)
        expect(matchesCommandName(theme, 'heme')).toBe(false)
    })

    it('needs every typed word to match', () => {
        expect(matchesCommandName(theme, 'dark folder')).toBe(false)
    })

    it('matches nothing when only punctuation is typed', () => {
        expect(matchesCommandName(theme, '::')).toBe(false)
    })
})
