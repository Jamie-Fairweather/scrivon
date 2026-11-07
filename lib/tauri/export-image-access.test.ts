import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { adoptExportImages, profileImagePaths, rememberExportImage } from '@/lib/tauri/export-image-access'
import type { PdfExportSettings } from '@/lib/settings/pdf-export-types'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri }))

function settingsWithImages(): PdfExportSettings {
    const report = createDefaultPdfExportProfile()
    report.brand.logoPath = ' C:/brand/cover.png '
    report.header.left.imagePath = 'C:/brand/logo.png'
    report.footer.right.imagePath = 'data:image/png;base64,abc'
    const letter = { ...createDefaultPdfExportProfile(), id: 'letter' }
    letter.footer = { ...letter.footer, left: { text: '', imagePath: 'C:/brand/logo.png' } }
    letter.header = { ...letter.header, right: { text: '', imagePath: String.raw`G:\My Drive\seal.svg` } }
    return { profiles: [report, letter], activeProfileId: report.id }
}

describe('export image access', () => {
    beforeEach(() => {
        invoke.mockReset()
        invoke.mockResolvedValue(true)
        isTauri.mockReturnValue(true)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("lists every profile's image files once, without blanks or embedded images", () => {
        expect(profileImagePaths(settingsWithImages())).toEqual(['C:/brand/cover.png', 'C:/brand/logo.png', String.raw`G:\My Drive\seal.svg`])
    })

    it("hands the profiles' images to Rust", async () => {
        await adoptExportImages(settingsWithImages())

        expect(invoke).toHaveBeenCalledWith('adopt_export_images', {
            paths: ['C:/brand/cover.png', 'C:/brand/logo.png', String.raw`G:\My Drive\seal.svg`],
        })
    })

    it('records an image the user picked', async () => {
        await rememberExportImage('C:/brand/logo.png')

        expect(invoke).toHaveBeenCalledWith('remember_export_image', { path: 'C:/brand/logo.png' })
    })

    it('does nothing outside the desktop app or for an empty path', async () => {
        await rememberExportImage('  ')
        isTauri.mockReturnValue(false)
        await rememberExportImage('C:/brand/logo.png')
        await adoptExportImages(settingsWithImages())

        expect(invoke).not.toHaveBeenCalled()
    })

    it('only logs when Rust refuses', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        invoke.mockRejectedValue('Command remember_export_image not found')

        await expect(rememberExportImage('C:/brand/logo.png')).resolves.toBeUndefined()
        await expect(adoptExportImages(settingsWithImages())).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledTimes(2)
    })
})
