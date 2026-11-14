import { describe, expect, it } from 'vitest'
import { createDefaultPdfExportProfile, createDefaultPdfExportSettings, DEFAULT_PDF_EXPORT_PROFILE_ID } from '@/lib/settings/pdf-export-defaults'
import { normalizePdfExportProfile, normalizePdfExportSettings } from '@/lib/settings/pdf-export-normalize'
import {
    createPdfExportProfile,
    deletePdfExportProfile,
    duplicatePdfExportProfile,
    getActivePdfExportProfile,
    importPdfExportProfile,
    otherProfileNamed,
    PDF_AUTO_BAR_HEIGHT_MM,
    pdfBodyHeightMm,
    pdfBodyWidthMm,
    pdfPageWidthWarning,
    renamePdfExportProfile,
    setActivePdfExportProfile,
    uniqueProfileName,
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
        expect(normalized.profiles[0]!.typography.justify).toBe(false)
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

    it('counts every page unless a profile numbers its pages from the body', () => {
        expect(normalizePdfExportProfile({ footer: { pageNumbers: 'number' } }).footer.numberFromBody).toBe(false)
        expect(normalizePdfExportProfile({ footer: { numberFromBody: 'yes' } }).footer.numberFromBody).toBe(false)
        expect(normalizePdfExportProfile({ footer: { numberFromBody: true } }).footer.numberFromBody).toBe(true)
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

    it('gives profiles saved before custom page sizes an A4 custom size, and keeps the new sizes', () => {
        const old = normalizePdfExportProfile({ page: { size: 'letter', orientation: 'portrait' } })
        expect(old.page).toMatchObject({ size: 'letter', customSizeMm: { width: 210, height: 297 } })

        for (const size of ['a3', 'a5', 'legal', 'custom']) expect(normalizePdfExportProfile({ page: { size } }).page.size).toBe(size)
        expect(normalizePdfExportProfile({ page: { size: 'b5' } }).page.size).toBe('a4')
    })

    it('gives profiles saved before the Contents title setting the old "Contents" heading', () => {
        expect(normalizePdfExportProfile({ frontMatter: { toc: true, tocDepth: 2 } }).frontMatter.tocTitle).toBe('Contents')
        expect(normalizePdfExportProfile({ frontMatter: { tocTitle: 'Inhalt' } }).frontMatter.tocTitle).toBe('Inhalt')
        expect(normalizePdfExportProfile({ frontMatter: { tocTitle: '' } }).frontMatter.tocTitle).toBe('')
        expect(normalizePdfExportProfile({ frontMatter: { tocTitle: 7 } }).frontMatter.tocTitle).toBe('Contents')
    })

    it('keeps the newer code themes', () => {
        for (const codeTheme of ['one-light', 'solarized-dark', 'nord', 'dracula'])
            expect(normalizePdfExportProfile({ content: { codeTheme } }).content.codeTheme).toBe(codeTheme)
        expect(normalizePdfExportProfile({ content: { codeTheme: 'monokai' } }).content.codeTheme).toBe('github-light')
    })

    it('keeps a custom page size inside what PDF and Word can print', () => {
        const page = (customSizeMm: unknown) => normalizePdfExportProfile({ page: { size: 'custom', customSizeMm } }).page.customSizeMm
        expect(page({ width: 120.5, height: 180 })).toEqual({ width: 120.5, height: 180 })
        expect(page({ width: 20, height: 9000 })).toEqual({ width: 100, height: 550 })
        expect(page({ width: '120', height: null })).toEqual({ width: 210, height: 297 })
        expect(page('A6')).toEqual({ width: 210, height: 297 })
    })

    it('migrates legacy h1StartsNewPage and accepts newPageFromHeading', () => {
        expect(normalizePdfExportProfile({ flow: { h1StartsNewPage: true } }).flow.newPageFromHeading).toBe(1)
        expect(normalizePdfExportProfile({ flow: { h1StartsNewPage: false } }).flow.newPageFromHeading).toBe(0)
        expect(normalizePdfExportProfile({ flow: { newPageFromHeading: 3 } }).flow.newPageFromHeading).toBe(3)
        expect(normalizePdfExportProfile({ flow: { newPageFromHeading: '4' } }).flow.newPageFromHeading).toBe(4)
        expect(normalizePdfExportProfile({ flow: { newPageFromHeading: 9 } }).flow.newPageFromHeading).toBe(0)
    })

    it('quotes saved font names that are not valid CSS', () => {
        const profile = normalizePdfExportProfile({
            typography: { headingFont: 'Calibri, sans-serif', bodyFont: 'A&B Sans, sans-serif', monoFont: '0xProto, sans-serif' },
        })
        expect(profile.typography).toMatchObject({
            headingFont: 'Calibri, sans-serif',
            bodyFont: '"A&B Sans", sans-serif',
            monoFont: '"0xProto", monospace',
        })
    })

    it('gives a Monospace font saved by the old system picker a monospace fallback', () => {
        const mono = (monoFont: string) => normalizePdfExportProfile({ typography: { monoFont } }).typography.monoFont
        expect(mono('"Cascadia Code", sans-serif')).toBe('"Cascadia Code", monospace')
        expect(mono('Fira Code, sans-serif')).toBe('"Fira Code", monospace')
        // Curated stacks, new picks and anything longer are left as saved.
        expect(mono('Consolas, "Courier New", monospace')).toBe('Consolas, "Courier New", monospace')
        expect(mono('"Fira Code", monospace')).toBe('"Fira Code", monospace')
        expect(mono('"Segoe UI", Tahoma, sans-serif')).toBe('"Segoe UI", Tahoma, sans-serif')
        // Only the Monospace slot: a sans font picked for headings keeps its sans fallback.
        expect(normalizePdfExportProfile({ typography: { headingFont: '"Cascadia Code", sans-serif' } }).typography.headingFont).toBe(
            '"Cascadia Code", sans-serif'
        )
    })

    it('gives repeated profile ids new ones so each profile can be changed on its own', () => {
        const normalized = normalizePdfExportSettings({
            profiles: [
                { id: 'a', name: 'First' },
                { id: 'a', name: 'Second' },
                { id: 'a-1', name: 'Third' },
            ],
            activeProfileId: 'a',
        })
        const ids = normalized.profiles.map((profile) => profile.id)
        expect(ids[0]).toBe('a')
        expect(new Set(ids).size).toBe(3)
        expect(normalized.activeProfileId).toBe('a')

        const afterDelete = deletePdfExportProfile(normalized, 'a')
        expect(afterDelete.profiles.map((profile) => profile.name)).toEqual(['Second', 'Third'])
        expect(afterDelete.activeProfileId).toBe(ids[1])
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

    it('gives new profiles names the pickers can tell apart', () => {
        let settings = createDefaultPdfExportSettings()
        settings = createPdfExportProfile(settings)
        settings = createPdfExportProfile(settings)
        settings = createPdfExportProfile(settings)
        expect(settings.profiles.map((profile) => profile.name)).toEqual(['Default', 'New profile', 'New profile 2', 'New profile 3'])

        // Names are compared trimmed and ignoring case.
        expect(createPdfExportProfile(settings, ' default ').profiles.at(-1)!.name).toBe('default 2')
    })

    it('numbers copies instead of stacking "copy copy"', () => {
        let settings = createDefaultPdfExportSettings()
        settings = duplicatePdfExportProfile(settings, DEFAULT_PDF_EXPORT_PROFILE_ID)
        const firstCopyId = settings.activeProfileId
        settings = duplicatePdfExportProfile(settings, DEFAULT_PDF_EXPORT_PROFILE_ID)
        settings = duplicatePdfExportProfile(settings, firstCopyId)
        settings = duplicatePdfExportProfile(settings, settings.activeProfileId)
        expect(settings.profiles.map((profile) => profile.name)).toEqual([
            'Default',
            'Default copy',
            'Default copy 2',
            'Default copy 3',
            'Default copy 4',
        ])
    })

    it('uniqueProfileName keeps a free name and counts up from 2', () => {
        expect(uniqueProfileName([], 'Report')).toBe('Report')
        expect(uniqueProfileName([{ name: 'Report' }], 'Report')).toBe('Report 2')
        expect(uniqueProfileName([{ name: 'Report' }, { name: 'report 2' }], 'Report')).toBe('Report 3')
    })

    it('otherProfileNamed finds a different profile with the same name, ignoring case and spaces', () => {
        const profiles = [
            { id: 'a', name: 'Default' },
            { id: 'b', name: 'Report' },
        ]
        expect(otherProfileNamed(profiles, 'b', ' default ')).toBe(profiles[0])
        // A profile never clashes with itself, and an empty name clashes with nothing.
        expect(otherProfileNamed(profiles, 'a', 'Default')).toBeUndefined()
        expect(otherProfileNamed(profiles, 'b', 'Report 2')).toBeUndefined()
        expect(otherProfileNamed([...profiles, { id: 'c', name: '' }], 'b', '  ')).toBeUndefined()
    })

    it('never deletes the last profiles, even when they share an id', () => {
        const profile = createDefaultPdfExportProfile({ id: 'a' })
        const settings = { profiles: [profile, { ...profile, name: 'Twin' }], activeProfileId: 'a' }
        expect(deletePdfExportProfile(settings, 'a')).toBe(settings)
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

    it('adds an imported profile under a new id and a free name, and picks it', () => {
        let settings = createPdfExportProfile(createDefaultPdfExportSettings(), 'Report')
        const imported = {
            ...createDefaultPdfExportProfile({ id: DEFAULT_PDF_EXPORT_PROFILE_ID, name: ' report ' }),
            page: { ...settings.profiles[0]!.page, size: 'letter' as const },
        }

        settings = importPdfExportProfile(settings, imported)

        const added = settings.profiles[2]!
        expect(settings.profiles.map((profile) => profile.name)).toEqual(['Default', 'Report', 'report 2'])
        expect(added.id).not.toBe(DEFAULT_PDF_EXPORT_PROFILE_ID)
        expect(new Set(settings.profiles.map((profile) => profile.id)).size).toBe(3)
        expect(settings.activeProfileId).toBe(added.id)
        expect(added.page.size).toBe('letter')
    })

    it('names an imported profile without a name', () => {
        const settings = importPdfExportProfile(createDefaultPdfExportSettings(), createDefaultPdfExportProfile({ name: '  ' }))

        expect(settings.profiles[1]!.name).toBe('Imported profile')
    })
})

describe('pdfBodyWidthMm and pdfPageWidthWarning', () => {
    it('is the page width minus the side margins, the way the sheet is turned', () => {
        const profile = createDefaultPdfExportProfile()
        expect(pdfBodyWidthMm(profile)).toBe(210 - 10 - 10)
        profile.page = { ...profile.page, orientation: 'landscape' }
        expect(pdfBodyWidthMm(profile)).toBe(297 - 10 - 10)
        expect(pdfPageWidthWarning(profile)).toBe('')
    })

    it('warns when the side margins leave a custom page little or no width', () => {
        const profile = createDefaultPdfExportProfile()
        profile.page = {
            ...profile.page,
            size: 'custom',
            customSizeMm: { width: 130, height: 200 },
            marginsMm: { top: 10, right: 50, bottom: 10, left: 50 },
        }
        expect(pdfBodyWidthMm(profile)).toBe(30)
        expect(pdfPageWidthWarning(profile)).toBe('The side margins leave only 30 mm of page width for the text.')
        profile.page = { ...profile.page, customSizeMm: { width: 100, height: 200 } }
        expect(pdfPageWidthWarning(profile)).toBe('The side margins are wider than the page, so there is no room left for the text.')
        // Turned on its side, the 200 mm edge is the width.
        profile.page = { ...profile.page, orientation: 'landscape' }
        expect(pdfPageWidthWarning(profile)).toBe('')
    })
})

describe('pdfBodyHeightMm', () => {
    const bar = (heightMm: number, gapMm: number, ignoreMargins: boolean) => ({ enabled: true, heightMm, gapMm, ignoreMargins })

    it('is the page height minus the top and bottom margins when no bar shows', () => {
        const profile = createDefaultPdfExportProfile()
        expect(pdfBodyHeightMm(profile)).toBe(297 - 10 - 10)
        // A hidden bar takes no room, whatever its size.
        profile.header = { ...profile.header, heightMm: 60, gapMm: 60 }
        expect(pdfBodyHeightMm(profile)).toBe(277)
        profile.page = { ...profile.page, size: 'letter', orientation: 'landscape' }
        expect(pdfBodyHeightMm(profile)).toBeCloseTo(215.9 - 20)
    })

    it('adds a bar inside the margins, and counts a bleeding bar only past the margin', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header = { ...profile.header, ...bar(20, 5, false) }
        expect(pdfBodyHeightMm(profile)).toBe(297 - (10 + 25) - 10)
        profile.header = { ...profile.header, ...bar(5, 2, true) }
        expect(pdfBodyHeightMm(profile)).toBe(297 - 10 - 10)
        profile.footer = { ...profile.footer, ...bar(30, 10, true) }
        expect(pdfBodyHeightMm(profile)).toBe(297 - 10 - 40)
    })

    it('estimates the height of a bar that fits its content, as the export does', () => {
        const profile = createDefaultPdfExportProfile()
        profile.header = { ...profile.header, ...bar(0, 3, false) }
        expect(pdfBodyHeightMm(profile)).toBe(297 - (10 + PDF_AUTO_BAR_HEIGHT_MM + 3) - 10)
        // Bleeding into a 10 mm margin, the 12 mm row still pushes the body down a little.
        profile.header = { ...profile.header, ...bar(0, 0, true) }
        expect(pdfBodyHeightMm(profile)).toBe(297 - PDF_AUTO_BAR_HEIGHT_MM - 10)
    })

    it('goes negative when the bars outgrow a landscape A4 page', () => {
        const profile = createDefaultPdfExportProfile()
        profile.page = { ...profile.page, orientation: 'landscape' }
        profile.header = { ...profile.header, ...bar(60, 60, true) }
        profile.footer = { ...profile.footer, ...bar(60, 60, true) }
        expect(pdfBodyHeightMm(profile)).toBe(210 - 120 - 120)
    })

    it('leaves out the size, gap and bleed of a switched-off footer that prints only page numbers', () => {
        const profile = createDefaultPdfExportProfile()
        profile.footer = { ...profile.footer, heightMm: 20, gapMm: 15, ignoreMargins: true, pageNumbers: 'number' }
        expect(pdfBodyHeightMm(profile)).toBe(297 - 10 - (10 + PDF_AUTO_BAR_HEIGHT_MM))
        profile.footer = { ...profile.footer, enabled: true }
        expect(pdfBodyHeightMm(profile)).toBe(297 - 10 - 35)
    })
})
