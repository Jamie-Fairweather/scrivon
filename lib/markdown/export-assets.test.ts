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

describe('resolvePdfExportAssets', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(true)
    })

    it('returns empty strings when paths are blank or not in tauri', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        isTauri.mockReturnValue(false)
        const profile = createDefaultPdfExportProfile()
        profile.brand.logoPath = 'logo.png'
        await expect(resolvePdfExportAssets(profile)).resolves.toEqual(EMPTY)
        expect(invoke).not.toHaveBeenCalled()
    })

    it('passes through data urls and reads files through the native command', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        invoke.mockImplementation(async (_cmd: string, args: { path: string }) => {
            if (args.path.includes('header.jpg')) throw new Error('missing')
            return `data:image/png;base64,${args.path.includes('Untitled') ? 'Zg==' : 'YQ=='}`
        })

        const profile = createDefaultPdfExportProfile()
        profile.brand.logoPath = 'data:image/png;base64,abc'
        profile.header.left.imagePath = 'C:/header.jpg'
        profile.header.right.imagePath = 'C:/right.png'
        profile.footer.left.imagePath = String.raw`G:\My Drive\Pictures\coffee\Untitled.png`

        const assets = await resolvePdfExportAssets(profile)
        expect(assets.logoDataUrl).toBe('data:image/png;base64,abc')
        expect(assets.header).toEqual({ left: '', right: 'data:image/png;base64,YQ==' })
        expect(assets.footer).toEqual({ left: 'data:image/png;base64,Zg==', right: '' })
        expect(invoke).toHaveBeenCalledWith('read_export_image', { path: 'C:/header.jpg' })
        expect(invoke).toHaveBeenCalledWith('read_export_image', {
            path: String.raw`G:\My Drive\Pictures\coffee\Untitled.png`,
        })
        expect(invoke).toHaveBeenCalledTimes(3)
    })

    it('omits blank paths without invoking rust', async () => {
        const { resolvePdfExportAssets } = await import('@/lib/markdown/export-assets')
        const profile = createDefaultPdfExportProfile()
        await expect(resolvePdfExportAssets(profile)).resolves.toEqual(EMPTY)
        expect(invoke).not.toHaveBeenCalled()
    })
})
