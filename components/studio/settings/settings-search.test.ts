import { describe, expect, it } from 'vitest'
import { searchSettings } from '@/components/studio/settings/settings-search'

const BROWSER = { desktop: false }

describe('searchSettings', () => {
    it('finds a setting by its label and says which section it is in', () => {
        expect(searchSettings('minimap', BROWSER)).toEqual([expect.objectContaining({ section: 'editor', label: 'Minimap' })])
    })

    it('ignores case, extra spaces and word order', () => {
        expect(searchSettings('  NUMBERS   page ', BROWSER)).toEqual([
            expect.objectContaining({ section: 'pdf-export', label: 'Page numbers', group: 'Footer' }),
        ])
    })

    it('finds nothing for an empty search', () => {
        expect(searchSettings('', BROWSER)).toEqual([])
        expect(searchSettings('   ', BROWSER)).toEqual([])
    })

    it('finds nothing when no setting matches', () => {
        expect(searchSettings('xyzzy', BROWSER)).toEqual([])
    })

    it('tells apart settings with the same label by their group', () => {
        expect(searchSettings('background colour', BROWSER)).toEqual([
            expect.objectContaining({ section: 'pdf-export', label: 'Background colour', group: 'Header' }),
            expect.objectContaining({ section: 'pdf-export', label: 'Background colour', group: 'Footer' }),
        ])
    })

    it('matches other words people use for a setting', () => {
        expect(searchSettings('paper', BROWSER)).toEqual([expect.objectContaining({ label: 'Page size' })])
        expect(searchSettings('color', BROWSER).map((entry) => entry.label)).toContain('Brand colour')
    })

    it('finds keyboard shortcuts and themes', () => {
        expect(searchSettings('go to file', BROWSER)).toEqual([expect.objectContaining({ section: 'keyboard', label: 'Go to file' })])
        expect(searchSettings('nord', BROWSER)).toEqual([
            expect.objectContaining({ section: 'appearance', label: 'Nord', group: 'Dark themes' }),
            expect.objectContaining({ section: 'appearance', label: 'Nord Light', group: 'Light themes' }),
        ])
    })

    it('lists settings whose name starts with the search first', () => {
        const labels = searchSettings('margin', BROWSER).map((entry) => entry.label)
        expect(labels.slice(0, 4)).toEqual(['Margin top (mm)', 'Margin right (mm)', 'Margin bottom (mm)', 'Margin left (mm)'])
        expect(labels).toContain('Ignore margins')
    })

    it('only finds the update check in the desktop app, where it is shown', () => {
        expect(searchSettings('updates', { desktop: false })).toEqual([])
        expect(searchSettings('updates', { desktop: true })).toEqual([
            expect.objectContaining({ section: 'advanced', label: 'Check for updates on launch' }),
        ])
    })

    it('only finds Reopen last folder in the desktop app, where it is shown', () => {
        expect(searchSettings('last folder', { desktop: false })).toEqual([])
        expect(searchSettings('last folder', { desktop: true })).toEqual([
            expect.objectContaining({ section: 'advanced', label: 'Reopen last folder on startup' }),
        ])
    })

    it('finds the status bar', () => {
        expect(searchSettings('word count', BROWSER)).toEqual([expect.objectContaining({ section: 'editor', label: 'Status bar' })])
    })
})
