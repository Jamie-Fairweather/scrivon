import { describe, expect, it } from 'vitest'
import { FOLLOW_SYSTEM, type ThemeSetting } from '@/lib/settings/types'
import { diagramExportThemeId } from './diagram-export-theme'

const fixed = (id: ThemeSetting['id']): ThemeSetting => ({ id, light: 'github-light', dark: 'one-dark' })
const followWindows: ThemeSetting = { id: FOLLOW_SYSTEM, light: 'github-light', dark: 'one-dark' }

describe('diagramExportThemeId', () => {
    it('draws in the theme on screen for "app"', () => {
        expect(diagramExportThemeId('app', 'nord', fixed('nord'))).toBe('nord')
        expect(diagramExportThemeId('app', 'github-light', followWindows)).toBe('github-light')
    })

    it('keeps the theme on screen when it is already light or dark as asked', () => {
        expect(diagramExportThemeId('light', 'catppuccin-latte', fixed('catppuccin-latte'))).toBe('catppuccin-latte')
        expect(diagramExportThemeId('dark', 'dracula', fixed('dracula'))).toBe('dracula')
    })

    it("uses the other half of the theme's family for a fixed theme", () => {
        expect(diagramExportThemeId('light', 'nord', fixed('nord'))).toBe('nord-light')
        expect(diagramExportThemeId('dark', 'scrivon-light', fixed('scrivon-light'))).toBe('scrivon-dark')
    })

    it("uses the user's light or dark theme for one with no other half", () => {
        expect(diagramExportThemeId('light', 'dracula', fixed('dracula'))).toBe('github-light')
    })

    it('uses the theme Windows light or dark would show when following Windows', () => {
        // github-light's own twin is github-dark, but the user picked One Dark for dark Windows.
        expect(diagramExportThemeId('dark', 'github-light', followWindows)).toBe('one-dark')
        expect(diagramExportThemeId('light', 'one-dark', followWindows)).toBe('github-light')
    })
})
