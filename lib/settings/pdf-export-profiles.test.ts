import { describe, expect, it } from 'vitest'
import { createDefaultPdfExportSettings, DEFAULT_PDF_EXPORT_PROFILE_ID } from '@/lib/settings/pdf-export-defaults'
import { normalizePdfExportProfile, normalizePdfExportSettings } from '@/lib/settings/pdf-export-normalize'
import {
    createPdfExportProfile,
    deletePdfExportProfile,
    duplicatePdfExportProfile,
    getActivePdfExportProfile,
    renamePdfExportProfile,
    setActivePdfExportProfile,
    updatePdfExportProfile,
} from '@/lib/settings/pdf-export-profiles'

describe('pdf export defaults', () => {
    it('creates a single default profile settings blob', () => {
        const settings = createDefaultPdfExportSettings()
        expect(settings.profiles).toHaveLength(1)
        expect(settings.activeProfileId).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(settings.profiles[0]!.page.size).toBe('a4')
        expect(settings.profiles[0]!.frontMatter.titlePage).toBe(false)
    })
})

describe('normalizePdfExportSettings', () => {
    it('returns defaults for invalid input', () => {
        expect(normalizePdfExportSettings(null)).toEqual(createDefaultPdfExportSettings())
        expect(normalizePdfExportSettings('x')).toEqual(createDefaultPdfExportSettings())
    })

    it('normalizes partial profiles and clamps values', () => {
        const normalized = normalizePdfExportSettings({
            activeProfileId: 'missing',
            profiles: [
                {
                    id: 'a',
                    name: 'Report',
                    page: { size: 'letter', orientation: 'landscape', marginsMm: { top: 99, right: -1 } },
                    typography: { bodySizePt: 3, lineHeight: 9 },
                    content: { codeTheme: 'nope', mermaidThemeId: 'nope', watermark: 'DRAFT' },
                    frontMatter: { tocDepth: 9 },
                    footer: { pageNumbers: 'page-n' },
                },
            ],
        })

        expect(normalized.profiles).toHaveLength(1)
        expect(normalized.activeProfileId).toBe('a')
        expect(normalized.profiles[0]!.name).toBe('Report')
        expect(normalized.profiles[0]!.page.size).toBe('letter')
        expect(normalized.profiles[0]!.page.orientation).toBe('landscape')
        expect(normalized.profiles[0]!.page.marginsMm.top).toBe(50)
        expect(normalized.profiles[0]!.page.marginsMm.right).toBe(0)
        expect(normalized.profiles[0]!.typography.bodySizePt).toBe(8)
        expect(normalized.profiles[0]!.typography.lineHeight).toBe(2.5)
        expect(normalized.profiles[0]!.content.codeTheme).toBe('github-light')
        expect(normalized.profiles[0]!.content.watermark).toBe('DRAFT')
        expect(normalized.profiles[0]!.frontMatter.tocDepth).toBe(3)
        expect(normalized.profiles[0]!.footer.pageNumbers).toBe('page-n')
    })

    it('defaults and clamps chrome layout options', () => {
        const legacy = normalizePdfExportProfile({ header: { enabled: true }, footer: { text: 'x' }, brand: { logoPath: 'a.png' } })
        expect(legacy.header).toMatchObject({ textColor: '', heightMm: 0, gapMm: 0, ignoreMargins: false })
        expect(legacy.footer).toMatchObject({ textColor: '', heightMm: 0, gapMm: 0, ignoreMargins: false })
        expect(legacy.brand.logoIgnoreMargins).toBe(false)

        const custom = normalizePdfExportProfile({
            header: { textColor: '#fff', heightMm: 999, gapMm: 5, ignoreMargins: true },
            footer: { textColor: 42, heightMm: -3, gapMm: '5', ignoreMargins: 'yes' },
            brand: { logoIgnoreMargins: true },
        })
        expect(custom.header).toMatchObject({ textColor: '#fff', heightMm: 60, gapMm: 5, ignoreMargins: true })
        expect(custom.footer).toMatchObject({ textColor: '', heightMm: 0, gapMm: 0, ignoreMargins: false })
        expect(custom.brand.logoIgnoreMargins).toBe(true)
    })

    it('moves single-sided legacy chrome to the left and accepts two-sided chrome', () => {
        const legacy = normalizePdfExportProfile({
            header: { text: 'Acme', imagePath: 'C:/logo.png' },
            footer: { text: 'Confidential', pageNumbers: 'number' },
        })
        expect(legacy.header.left).toEqual({ text: 'Acme', imagePath: 'C:/logo.png' })
        expect(legacy.header.right).toEqual({ text: '', imagePath: '' })
        expect(legacy.footer.left).toEqual({ text: 'Confidential', imagePath: '' })
        expect(legacy.footer.pageNumbers).toBe('number')

        const sided = normalizePdfExportProfile({
            header: { left: { imagePath: 'C:/l.png' }, right: { text: 'Right', imagePath: 7 } },
            footer: { right: { text: 'Page {{page}}' }, pageNumbers: 'custom' },
        })
        expect(sided.header.left).toEqual({ text: '', imagePath: 'C:/l.png' })
        expect(sided.header.right).toEqual({ text: 'Right', imagePath: '' })
        expect(sided.footer.right).toEqual({ text: 'Page {{page}}', imagePath: '' })
        expect(sided.footer.pageNumbers).toBe('custom')
        expect(normalizePdfExportProfile({ footer: { pageNumbers: 'roman' } }).footer.pageNumbers).toBe('none')
    })

    it('migrates legacy h1StartsNewPage and accepts newPageFromHeading', () => {
        expect(normalizePdfExportProfile({ flow: { h1StartsNewPage: true } }).flow.newPageFromHeading).toBe(1)
        expect(normalizePdfExportProfile({ flow: { h1StartsNewPage: false } }).flow.newPageFromHeading).toBe(0)
        expect(normalizePdfExportProfile({ flow: { newPageFromHeading: 3 } }).flow.newPageFromHeading).toBe(3)
        expect(normalizePdfExportProfile({ flow: { newPageFromHeading: '4' } }).flow.newPageFromHeading).toBe(4)
        expect(normalizePdfExportProfile({ flow: { newPageFromHeading: 9 } }).flow.newPageFromHeading).toBe(0)
    })

    it('falls back to defaults when profiles array is empty', () => {
        const normalized = normalizePdfExportSettings({ profiles: [], activeProfileId: 'x' })
        expect(normalized).toEqual(createDefaultPdfExportSettings())
    })

    it('normalizes empty ids/names and non-array profiles', () => {
        expect(normalizePdfExportProfile(null).id).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(normalizePdfExportProfile({ id: '', name: '' }).id).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(normalizePdfExportProfile({ id: '', name: '' }).name).toBe('Default')
        expect(normalizePdfExportSettings({ profiles: 'nope', activeProfileId: 'x' })).toEqual(createDefaultPdfExportSettings())
        expect(
            normalizePdfExportSettings({
                profiles: [{ id: 'ok', content: { mermaidThemeId: 'scrivon-light' }, frontMatter: { tocDepth: '2' } }],
                activeProfileId: 'ok',
            }).profiles[0]!.frontMatter.tocDepth
        ).toBe(2)
    })
})

describe('pdf export profile CRUD', () => {
    it('gets and sets the active profile', () => {
        let settings = createDefaultPdfExportSettings()
        expect(getActivePdfExportProfile(settings).id).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)

        settings = createPdfExportProfile(settings, 'Client')
        const clientId = settings.activeProfileId
        expect(settings.profiles).toHaveLength(2)
        expect(getActivePdfExportProfile(settings)).toMatchObject({ id: clientId, name: 'Client' })

        settings = setActivePdfExportProfile(settings, DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(settings.activeProfileId).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(setActivePdfExportProfile(settings, 'missing')).toEqual(settings)
    })

    it('duplicates, renames, updates, and deletes profiles', () => {
        let settings = createDefaultPdfExportSettings()
        settings = duplicatePdfExportProfile(settings, DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(settings.profiles).toHaveLength(2)
        expect(getActivePdfExportProfile(settings).name).toBe('Default copy')

        const copyId = settings.activeProfileId
        settings = renamePdfExportProfile(settings, copyId, '  Branded  ')
        expect(getActivePdfExportProfile(settings).name).toBe('Branded')
        expect(renamePdfExportProfile(settings, copyId, '   ')).toEqual(settings)

        settings = updatePdfExportProfile(settings, copyId, (profile) => ({
            ...profile,
            brand: { ...profile.brand, accentColor: '#ff0000' },
        }))
        expect(getActivePdfExportProfile(settings).brand.accentColor).toBe('#ff0000')

        settings = deletePdfExportProfile(settings, copyId)
        expect(settings.profiles).toHaveLength(1)
        expect(settings.activeProfileId).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)

        expect(deletePdfExportProfile(settings, DEFAULT_PDF_EXPORT_PROFILE_ID)).toEqual(settings)
        expect(duplicatePdfExportProfile(settings, 'missing')).toEqual(settings)
        expect(deletePdfExportProfile(settings, 'missing')).toEqual(settings)
    })

    it('falls back when the active profile id is missing', () => {
        const settings = createDefaultPdfExportSettings()
        settings.activeProfileId = 'missing'
        expect(getActivePdfExportProfile(settings).id).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
    })

    it('keeps active id when deleting a non-active profile', () => {
        let settings = createDefaultPdfExportSettings()
        settings = createPdfExportProfile(settings, 'Extra')
        const extraId = settings.activeProfileId
        settings = setActivePdfExportProfile(settings, DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(deletePdfExportProfile(settings, 'missing')).toEqual(settings)
        settings = deletePdfExportProfile(settings, extraId)
        expect(settings.activeProfileId).toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(settings.profiles).toHaveLength(1)
    })
})
