import { describe, expect, it } from 'vitest'
import { buildPdfExportCss } from '@/lib/markdown/export-html-css'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { normalizePdfExportProfile, normalizePdfExportSettings } from '@/lib/settings/pdf-export-normalize'

const BEACON = 'red} body{background:url(https://example.invalid/beacon)} h1{display:none'

describe('normalizePdfExportProfile colours and fonts', () => {
    it('keeps hex colours, and empty where the export picks the colour', () => {
        const profile = normalizePdfExportProfile({
            brand: { accentColor: '#ABC', linkColor: ' ' },
            header: { backgroundColor: '#11223380', textColor: '' },
            footer: { backgroundColor: '', textColor: '#ffffff' },
        })

        expect(profile.brand).toMatchObject({ accentColor: '#ABC', linkColor: '' })
        expect(profile.header).toMatchObject({ backgroundColor: '#11223380', textColor: '' })
        expect(profile.footer).toMatchObject({ backgroundColor: '', textColor: '#ffffff' })
    })

    it('puts back the default for a colour that is not hex, so it cannot add CSS rules to the export', () => {
        const defaults = createDefaultPdfExportProfile()
        const profile = normalizePdfExportProfile({
            brand: { accentColor: BEACON, linkColor: 'blue' },
            header: { backgroundColor: BEACON, textColor: 'rgb(0, 0, 0)' },
            footer: { backgroundColor: BEACON, textColor: BEACON },
        })

        expect(profile.brand.accentColor).toBe(defaults.brand.accentColor)
        expect(profile.brand.linkColor).toBe(defaults.brand.linkColor)
        expect(profile.header).toMatchObject({ backgroundColor: defaults.header.backgroundColor, textColor: defaults.header.textColor })
        expect(profile.footer).toMatchObject({ backgroundColor: defaults.footer.backgroundColor, textColor: defaults.footer.textColor })
        expect(buildPdfExportCss({ ...profile, header: { ...profile.header, enabled: true } })).not.toContain('example.invalid')
    })

    it('keeps a font name with a line break inside its quotes, so it cannot end the CSS string early', () => {
        const profile = normalizePdfExportProfile({
            typography: { bodyFont: `"x\n} body{background:url(https://example.invalid/beacon)} h1{", serif` },
        })

        expect(profile.typography.bodyFont).not.toContain('\n')
        expect(buildPdfExportCss(profile)).not.toMatch(/^\s*\} body\{/m)
        expect(buildPdfExportCss(profile)).toContain(
            String.raw`font-family: "\"x } body{background:url(https://example.invalid/beacon)} h1{\"", serif;`
        )
    })
})

describe('normalizePdfExportSettings repeated ids', () => {
    it("doesn't give a repeated id one that a later profile saved, so the active profile stays the same", () => {
        const normalized = normalizePdfExportSettings({
            profiles: [
                { id: 'a', name: 'First' },
                { id: 'a', name: 'Second' },
                { id: 'a-1', name: 'Third' },
            ],
            activeProfileId: 'a-1',
        })

        const ids = normalized.profiles.map((profile) => profile.id)
        expect(new Set(ids).size).toBe(3)
        expect(ids[0]).toBe('a')
        expect(ids[2]).toBe('a-1')
        expect(normalized.profiles.find((profile) => profile.id === normalized.activeProfileId)?.name).toBe('Third')
    })

    it('skips every saved id when it picks a new one', () => {
        const normalized = normalizePdfExportSettings({
            profiles: [
                { id: 'a', name: 'First' },
                { id: 'a-2', name: 'Second' },
                { id: 'a', name: 'Third' },
                { id: 'a-3', name: 'Fourth' },
                { id: 'a', name: 'Fifth' },
            ],
            activeProfileId: 'a-3',
        })

        const ids = normalized.profiles.map((profile) => profile.id)
        expect(new Set(ids).size).toBe(5)
        expect(ids.slice(0, 2)).toEqual(['a', 'a-2'])
        expect(ids[3]).toBe('a-3')
        expect(normalized.profiles.find((profile) => profile.id === normalized.activeProfileId)?.name).toBe('Fourth')
    })
})
