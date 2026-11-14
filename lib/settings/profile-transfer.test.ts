import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { profileExportText, profileFileName, readProfileExport } from '@/lib/settings/profile-transfer'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+'

/** Images on this computer the export may read, by path. */
const images = new Map<string, string>()
let saved = 0

function brandedProfile() {
    const profile = createDefaultPdfExportProfile({ id: 'company', name: 'Company report' })
    profile.page.size = 'letter'
    profile.brand.logoPath = 'C:/brand/cover.png'
    profile.header.left.imagePath = 'C:/brand/logo.svg'
    profile.footer.right.imagePath = PNG
    return profile
}

type ProfileFile = { scrivon: string; version: number; profile: Record<string, unknown> & ReturnType<typeof brandedProfile> }

describe('export profile files', () => {
    beforeEach(() => {
        images.clear()
        images.set('C:/brand/cover.png', PNG)
        images.set('C:/brand/logo.svg', SVG)
        saved = 0
        isTauri.mockReturnValue(true)
        invoke.mockReset()
        invoke.mockImplementation(async (command: string, args: { path?: string; dataUrl?: string }) => {
            if (command === 'read_export_image') {
                const image = images.get(args.path!)
                if (!image) throw 'Choose this image again with Browse.'
                return image
            }
            if (command === 'save_profile_image') return `C:/AppData/profile-images/${++saved}.${args.dataUrl!.includes('svg') ? 'svg' : 'png'}`
            throw new Error(`unexpected ${command}`)
        })
    })

    it('embeds every image the profile uses, so the file works on another computer', async () => {
        const { text, leftOut } = await profileExportText(brandedProfile())

        const file = JSON.parse(text) as ProfileFile
        expect(file.scrivon).toBe('export-profile')
        expect(file.version).toBe(1)
        expect(file.profile.name).toBe('Company report')
        expect(file.profile.id).toBeUndefined()
        expect(file.profile.brand.logoPath).toBe(PNG)
        expect(file.profile.header.left.imagePath).toBe(SVG)
        expect(file.profile.footer.right.imagePath).toBe(PNG)
        expect(file.profile.footer.left.imagePath).toBe('')
        expect(leftOut).toEqual([])
    })

    it('leaves out an image it cannot read, and says which and why', async () => {
        images.delete('C:/brand/logo.svg')

        const { text, leftOut } = await profileExportText(brandedProfile())

        expect((JSON.parse(text) as ProfileFile).profile.header.left.imagePath).toBe('')
        expect(leftOut).toEqual([{ slot: 'Header left image', reason: 'Choose this image again with Browse.' }])
    })

    it('reads a profile back with its images saved on this computer, each image once', async () => {
        const { text } = await profileExportText(brandedProfile())

        const { profile, leftOut } = await readProfileExport(text)

        expect(leftOut).toEqual([])
        expect(profile.name).toBe('Company report')
        expect(profile.page.size).toBe('letter')
        expect(profile.brand.logoPath).toBe('C:/AppData/profile-images/1.png')
        expect(profile.header.left.imagePath).toBe('C:/AppData/profile-images/2.svg')
        // The cover and the footer use the same image, so they share one copy.
        expect(profile.footer.right.imagePath).toBe('C:/AppData/profile-images/1.png')
        expect(profile.footer.left.imagePath).toBe('')
        expect(saved).toBe(2)
    })

    it("drops images that weren't embedded or that Scrivon refuses, and says why", async () => {
        const file = { scrivon: 'export-profile', version: 1, profile: brandedProfile() }
        file.profile.brand.logoPath = String.raw`D:\Somebody else\cover.png`
        file.profile.header.left.imagePath = 'data:text/html;base64,PGI+'
        invoke.mockImplementation(async (_command: string, args: { dataUrl: string }) => {
            if (args.dataUrl.startsWith('data:image/png')) return 'C:/AppData/profile-images/1.png'
            throw 'Only PNG, JPEG, GIF, WebP and SVG images can be used.'
        })

        const { profile, leftOut } = await readProfileExport(JSON.stringify(file))

        expect(profile.brand.logoPath).toBe('')
        expect(profile.header.left.imagePath).toBe('')
        expect(profile.footer.right.imagePath).toBe('C:/AppData/profile-images/1.png')
        expect(leftOut).toEqual([
            { slot: 'Cover image', reason: "It isn't embedded in the file." },
            { slot: 'Header left image', reason: 'Only PNG, JPEG, GIF, WebP and SVG images can be used.' },
        ])
    })

    it('puts values out of range back in range, and fills in what is missing', async () => {
        const text = JSON.stringify({ scrivon: 'export-profile', version: 1, profile: { name: 'Big', typography: { bodySizePt: 100 } } })

        const { profile } = await readProfileExport(text)

        expect(profile.name).toBe('Big')
        expect(profile.typography.bodySizePt).toBe(24)
        expect(profile.page).toEqual(createDefaultPdfExportProfile().page)
    })

    it('keeps a custom page size, the Contents title and a newer code theme through export and import', async () => {
        const original = createDefaultPdfExportProfile({ id: 'booklet', name: 'Booklet' })
        original.page = { ...original.page, size: 'custom', customSizeMm: { width: 120.5, height: 180 } }
        original.frontMatter = { ...original.frontMatter, toc: true, tocTitle: 'Inhalt' }
        original.content = { ...original.content, codeTheme: 'nord' }

        const { profile } = await readProfileExport((await profileExportText(original)).text)

        expect(profile.page).toEqual(original.page)
        expect(profile.frontMatter.tocTitle).toBe('Inhalt')
        expect(profile.content.codeTheme).toBe('nord')
    })

    it('puts a custom page size that is out of range back in range', async () => {
        const page = { size: 'custom', customSizeMm: { width: 20, height: 9000 } }
        const text = JSON.stringify({ scrivon: 'export-profile', version: 1, profile: { name: 'Odd', page } })

        const { profile } = await readProfileExport(text)

        expect(profile.page.size).toBe('custom')
        expect(profile.page.customSizeMm).toEqual({ width: 100, height: 550 })
    })

    it('puts back the default for a colour that is not hex', async () => {
        const beacon = 'red} body{background:url(https://example.invalid/beacon)} h1{display:none'
        const file = { scrivon: 'export-profile', version: 1, profile: { name: 'Shared', brand: { accentColor: beacon, linkColor: '#0000FF' } } }

        const { profile } = await readProfileExport(JSON.stringify(file))

        expect(profile.brand.accentColor).toBe(createDefaultPdfExportProfile().brand.accentColor)
        expect(profile.brand.linkColor).toBe('#0000FF')
    })

    it("names the file after the profile, without characters Windows can't use", () => {
        expect(profileFileName('Company report')).toBe('Company report.json')
        expect(profileFileName('Q3: Sales/Final?  ')).toBe('Q3 Sales Final.json')
        expect(profileFileName('Notes...')).toBe('Notes.json')
        expect(profileFileName('***')).toBe('Export profile.json')
    })

    it('says why a file is refused', async () => {
        const notProfile = "This file isn't a Scrivon export profile."
        await expect(readProfileExport('{not json')).rejects.toThrow(notProfile)
        await expect(readProfileExport('[]')).rejects.toThrow(notProfile)
        await expect(readProfileExport(JSON.stringify({ name: 'Report' }))).rejects.toThrow(notProfile)
        await expect(readProfileExport(JSON.stringify({ scrivon: 'export-profile', profile: [] }))).rejects.toThrow(notProfile)
        await expect(readProfileExport(JSON.stringify({ scrivon: 'settings', version: 1, settings: {} }))).rejects.toThrow(
            'This is a settings file. Import it in Settings, Advanced.'
        )
        await expect(readProfileExport(JSON.stringify({ scrivon: 'export-profile', version: 2, profile: { name: 'Next' } }))).rejects.toThrow(
            'This file is from a newer Scrivon. Update Scrivon, then import it again.'
        )
    })
})
