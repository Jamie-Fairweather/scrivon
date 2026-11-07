import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({
    invoke,
}))

vi.mock('@/lib/tauri/platform', () => ({
    isTauri,
}))

const EMPTY = { logoDataUrl: '', header: { left: '', right: '' }, footer: { left: '', right: '' } }

/** A profile that shows the title page, header and footer, so every image slot is used. */
function profileWithEveryImage() {
    const profile = createDefaultPdfExportProfile()
    profile.frontMatter.titlePage = true
    profile.header.enabled = true
    profile.footer.enabled = true
    return profile
}

describe('resolvePdfExportAssets', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(true)
    })

    it('says file images can only be read in the desktop app', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        isTauri.mockReturnValue(false)
        const profile = profileWithEveryImage()
        profile.brand.logoPath = 'logo.png'
        await expect(resolvePdfExportAssets(profile)).resolves.toEqual({
            assets: EMPTY,
            missing: [{ slot: 'Logo', path: 'logo.png', reason: 'Images can only be read in the desktop app.' }],
        })
        expect(invoke).not.toHaveBeenCalled()
    })

    it('passes through data urls, reads files through the native command, and lists the ones that failed', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        invoke.mockImplementation(async (_cmd: string, args: { path: string }) => {
            if (args.path.includes('header.jpg')) throw 'Could not read image: The system cannot find the file specified. (os error 2)'
            if (args.path.includes('huge.png')) throw 'Image is too large to embed in the PDF.'
            return `data:image/png;base64,${args.path.includes('Untitled') ? 'Zg==' : 'YQ=='}`
        })

        const profile = profileWithEveryImage()
        profile.brand.logoPath = 'data:image/png;base64,abc'
        profile.header.left.imagePath = ' C:/header.jpg '
        profile.header.right.imagePath = 'C:/right.png'
        profile.footer.left.imagePath = String.raw`G:\My Drive\Pictures\coffee\Untitled.png`
        profile.footer.right.imagePath = 'C:/huge.png'

        const { assets, missing } = await resolvePdfExportAssets(profile)
        expect(assets.logoDataUrl).toBe('data:image/png;base64,abc')
        expect(assets.header).toEqual({ left: '', right: 'data:image/png;base64,YQ==' })
        expect(assets.footer).toEqual({ left: 'data:image/png;base64,Zg==', right: '' })
        expect(missing).toEqual([
            {
                slot: 'Header left image',
                path: 'C:/header.jpg',
                reason: 'Could not read image: The system cannot find the file specified. (os error 2)',
            },
            { slot: 'Footer right image', path: 'C:/huge.png', reason: 'Image is too large to embed in the PDF.' },
        ])
        expect(invoke).toHaveBeenCalledWith('read_export_image', { path: 'C:/header.jpg' })
        expect(invoke).toHaveBeenCalledWith('read_export_image', {
            path: String.raw`G:\My Drive\Pictures\coffee\Untitled.png`,
        })
        expect(invoke).toHaveBeenCalledTimes(4)
    })

    it('omits blank paths without invoking rust', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        await expect(resolvePdfExportAssets(profileWithEveryImage())).resolves.toEqual({ assets: EMPTY, missing: [] })
        expect(invoke).not.toHaveBeenCalled()
    })

    it('skips images the export will not show, so a stale path there is no problem', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        const profile = createDefaultPdfExportProfile()
        profile.brand.logoPath = 'C:/moved/logo.png'
        profile.header.left.imagePath = 'C:/moved/header.png'
        profile.footer.left.imagePath = 'C:/moved/footer.png'
        // No title page or header, and the footer is off: page numbers alone show no footer images.
        profile.footer.pageNumbers = 'number'
        await expect(resolvePdfExportAssets(profile)).resolves.toEqual({ assets: EMPTY, missing: [] })
        expect(invoke).not.toHaveBeenCalled()
    })
})
