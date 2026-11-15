import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { adoptExportImages, profileImagePaths, readExportImage, rememberExportImage, saveProfileImage } from '@/lib/tauri/export-image-access'
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

    it('reads an image the export may use as a data URL', async () => {
        invoke.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=')

        await expect(readExportImage('C:/brand/logo.png')).resolves.toBe('data:image/png;base64,iVBORw0KGgo=')
        expect(invoke).toHaveBeenCalledWith('read_export_image', { path: 'C:/brand/logo.png' })
    })

    it('saves an embedded image from an imported profile and gives its path', async () => {
        invoke.mockResolvedValue('C:/AppData/profile-images/a.png')

        await expect(saveProfileImage('data:image/png;base64,iVBORw0KGgo=')).resolves.toBe('C:/AppData/profile-images/a.png')
        expect(invoke).toHaveBeenCalledWith('save_profile_image', { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' })
    })

    it('says why an image could not be read or saved', async () => {
        invoke.mockRejectedValue('Choose this image again with Browse.')
        await expect(readExportImage('C:/brand/logo.png')).rejects.toThrow('Choose this image again with Browse.')
        await expect(saveProfileImage('data:image/png;base64,abc')).rejects.toThrow('Choose this image again with Browse.')

        isTauri.mockReturnValue(false)
        await expect(readExportImage('C:/brand/logo.png')).rejects.toThrow('Images can only be read in the desktop app.')
    })

    it('only logs when Rust refuses', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        invoke.mockRejectedValue('Command remember_export_image not found')

        await expect(rememberExportImage('C:/brand/logo.png')).resolves.toBeUndefined()
        await expect(adoptExportImages(settingsWithImages())).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalledTimes(2)
    })
})
