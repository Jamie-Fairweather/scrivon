import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { createPdfExportProfile } from '@/lib/settings/pdf-export-profiles'
import { readSettingsExport, settingsExportText } from '@/lib/settings/settings-transfer'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))
vi.mock('@/lib/settings/chord-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/settings/chord-utils')>()),
    isMacPlatform: () => false,
}))

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+'
const COVER = String.raw`C:\Brand\cover.png`
const LOGO = String.raw`C:\Brand\logo.svg`

/** Images on this computer the export may read, by path. */
const images = new Map<string, string>()
let saved = 0

function changedSettings() {
    const settings = createDefaultSettings(false)
    settings.theme.id = 'tokyo-night'
    settings.editor.fontSize = 18
    settings.keybinds['view.toggleEditor'] = [{ key: 'k', ctrl: true, alt: true }]
    settings.pdfExport = createPdfExportProfile(settings.pdfExport, 'Company report')
    return settings
}

type Settings = ReturnType<typeof changedSettings>

/** Settings whose Company report profile has a cover image and a header image, by path. */
function settingsWithImages() {
    const settings = changedSettings()
    const report = settings.pdfExport.profiles[1]!
    report.brand.logoPath = COVER
    report.header.left.imagePath = LOGO
    return settings
}

type SettingsFile = {
    scrivon: string
    version: number
    settings: { schemaVersion: number; theme: unknown; keybinds: unknown; pdfExport: Settings['pdfExport'] }
}

async function exportedFile(settings: Settings) {
    const { text, leftOut } = await settingsExportText(settings)
    return { file: JSON.parse(text) as SettingsFile, text, leftOut }
}

describe('settings export file', () => {
    beforeEach(() => {
        images.clear()
        images.set(COVER, PNG)
        images.set(LOGO, SVG)
        saved = 0
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

    it('reads back the settings it was made from', async () => {
        const settings = changedSettings()

        expect(await readSettingsExport((await settingsExportText(settings)).text)).toEqual({ settings, leftOut: [] })
    })

    it('says what it is, and keeps only the shortcuts the user changed', async () => {
        const { file } = await exportedFile(changedSettings())

        expect(file.scrivon).toBe('settings')
        expect(file.version).toBe(1)
        expect(file.settings.schemaVersion).toBe(1)
        expect(file.settings.theme).toMatchObject({ id: 'tokyo-night' })
        expect(file.settings.keybinds).toEqual({ 'view.toggleEditor': [{ key: 'k', ctrl: true, alt: true }] })
    })

    it("embeds every profile's images, so a backup works on another computer", async () => {
        const settings = settingsWithImages()
        settings.pdfExport.profiles[0]!.footer.right.imagePath = PNG

        const { file, text, leftOut } = await exportedFile(settings)

        const [standard, report] = file.settings.pdfExport.profiles
        expect(report!.brand.logoPath).toBe(PNG)
        expect(report!.header.left.imagePath).toBe(SVG)
        expect(standard!.footer.right.imagePath).toBe(PNG)
        expect(text).not.toContain('Brand')
        expect(leftOut).toEqual([])
        // The settings in use still name the files.
        expect(settings.pdfExport.profiles[1]!.brand.logoPath).toBe(COVER)
    })

    it('leaves out an image it cannot read, and says which profile it was in', async () => {
        images.delete(LOGO)

        const { file, leftOut } = await exportedFile(settingsWithImages())

        expect(file.settings.pdfExport.profiles[1]!.header.left.imagePath).toBe('')
        expect(leftOut).toEqual([{ slot: 'Header left image in "Company report"', reason: 'Choose this image again with Browse.' }])
    })

    it('reads a backup back with its images saved on this computer', async () => {
        const { text } = await settingsExportText(settingsWithImages())
        images.clear()

        const { settings, leftOut } = await readSettingsExport(text)

        const report = settings.pdfExport.profiles[1]!
        expect(report.brand.logoPath).toBe('C:/AppData/profile-images/1.png')
        expect(report.header.left.imagePath).toBe('C:/AppData/profile-images/2.svg')
        expect(report.footer.left.imagePath).toBe('')
        expect(leftOut).toEqual([])
    })

    it('saves an image used in several places once, and every place names that copy', async () => {
        const settings = settingsWithImages()
        settings.pdfExport.profiles[0]!.brand.logoPath = COVER
        settings.pdfExport.profiles[1]!.footer.right.imagePath = COVER
        const { text } = await settingsExportText(settings)

        const [standard, report] = (await readSettingsExport(text)).settings.pdfExport.profiles

        expect(standard!.brand.logoPath).toBe('C:/AppData/profile-images/1.png')
        expect(report!.brand.logoPath).toBe('C:/AppData/profile-images/1.png')
        expect(report!.footer.right.imagePath).toBe('C:/AppData/profile-images/1.png')
        expect(report!.header.left.imagePath).toBe('C:/AppData/profile-images/2.svg')
        expect(saved).toBe(2)
    })

    it('keeps a path from an older backup only when the export can still read it, and says which it dropped', async () => {
        // Backups made before images were embedded name files on the computer they came from.
        const older = settingsWithImages()
        older.pdfExport.profiles[0]!.footer.right.imagePath = 'data:text/html;base64,PGI+'
        const text = JSON.stringify({ scrivon: 'settings', version: 1, settings: older })
        images.delete(LOGO)
        invoke.mockImplementationOnce(async () => {
            throw 'Only PNG, JPEG, GIF, WebP and SVG images can be used.'
        })

        const { settings, leftOut } = await readSettingsExport(text)

        expect(settings.pdfExport.profiles[0]!.footer.right.imagePath).toBe('')
        expect(settings.pdfExport.profiles[1]!.brand.logoPath).toBe(COVER)
        expect(settings.pdfExport.profiles[1]!.header.left.imagePath).toBe('')
        expect(leftOut).toEqual([
            { slot: 'Footer right image in "Default"', reason: 'Only PNG, JPEG, GIF, WebP and SVG images can be used.' },
            { slot: 'Header left image in "Company report"', reason: 'Choose this image again with Browse.' },
        ])
    })

    it("also reads the copy in Scrivon's data folder (settings.json)", async () => {
        const copy = { theme: { id: 'scrivon-light' }, editor: { fontSize: 20 }, schemaVersion: 1 }

        const { settings } = await readSettingsExport(JSON.stringify(copy))

        expect(settings.theme.id).toBe('scrivon-light')
        expect(settings.editor.fontSize).toBe(20)
    })

    it("refuses another app's settings.json, which has no schemaVersion", async () => {
        // Scrivon's own copy always has one, even for settings last saved before 1.5.0 (see storage.test.ts).
        const zed = { theme: { mode: 'system', light: 'One Light', dark: 'One Dark' }, terminal: { font_size: 14 } }
        const notSettings = "This file isn't a Scrivon settings file."

        await expect(readSettingsExport(JSON.stringify(zed))).rejects.toThrow(notSettings)
        await expect(readSettingsExport(JSON.stringify({ theme: { id: 'scrivon-light' } }))).rejects.toThrow(notSettings)
    })

    it('puts values out of range back in range', async () => {
        const text = JSON.stringify({ scrivon: 'settings', version: 1, settings: { editor: { fontSize: 400 }, workspace: { maxRecentFolders: -3 } } })

        const { settings } = await readSettingsExport(text)

        expect(settings.editor.fontSize).toBe(32)
        expect(settings.workspace.maxRecentFolders).toBe(1)
    })

    it('says why a file is refused', async () => {
        const notSettings = "This file isn't a Scrivon settings file."
        await expect(readSettingsExport('{not json')).rejects.toThrow(notSettings)
        await expect(readSettingsExport('[]')).rejects.toThrow(notSettings)
        await expect(readSettingsExport(JSON.stringify({ hello: 'world' }))).rejects.toThrow(notSettings)
        await expect(readSettingsExport(JSON.stringify({ theme: 'dark', version: '2.0.0' }))).rejects.toThrow(notSettings)
        await expect(readSettingsExport(JSON.stringify({ scrivon: 'settings', settings: 'nope' }))).rejects.toThrow(notSettings)
        await expect(readSettingsExport(JSON.stringify({ scrivon: 'export-profile', version: 1, profile: {} }))).rejects.toThrow(
            'This is an export profile. Import it in Settings, Document export.'
        )
        await expect(readSettingsExport(JSON.stringify({ scrivon: 'settings', version: 2, settings: { schemaVersion: 1 } }))).rejects.toThrow(
            'This file is from a newer Scrivon. Update Scrivon, then import it again.'
        )
    })

    it("puts back the default for a profile colour that isn't hex", async () => {
        const settings = changedSettings()
        const text = (await settingsExportText(settings)).text.replace('"accentColor": "#262626"', '"accentColor": "red} body{color:red"')
        expect(text).toContain('red} body{color:red')

        expect((await readSettingsExport(text)).settings).toEqual(settings)
    })
})
