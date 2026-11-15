import { errorMessage } from '@/lib/notify'
import { PDF_EXPORT_IMAGE_SLOTS } from '@/lib/settings/pdf-export-images'
import type { PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'
import { readExportImage } from '@/lib/tauri/export-image-access'

/** A profile image the export needed but could not load, so it was left out. */
export type PdfExportMissingImage = {
    /** Which setting names the image, e.g. `Cover image` or `Footer left image`. */
    slot: string
    path: string
    reason: string
}

export type PdfExportLoadedAssets = {
    assets: PdfExportResolvedAssets
    missing: PdfExportMissingImage[]
}

type ImageRead = { dataUrl: string; error?: string }

async function readImageDataUrl(path: string): Promise<ImageRead> {
    if (!path) return { dataUrl: '' }
    if (path.startsWith('data:')) return { dataUrl: path }
    try {
        return { dataUrl: await readExportImage(path) }
    } catch (err) {
        return { dataUrl: '', error: errorMessage(err) }
    }
}

/**
 * Reads the profile's images as data URLs, skipping the ones this export won't show.
 * An image that can't be read is left out and listed in `missing`, so the caller can say so.
 */
export async function resolvePdfExportAssets(profile: PdfExportProfile): Promise<PdfExportLoadedAssets> {
    const paths = PDF_EXPORT_IMAGE_SLOTS.map(({ get, shown }) => (shown(profile) ? get(profile).trim() : ''))
    const reads = await Promise.all(paths.map(readImageDataUrl))
    // The profile with each image swapped for what was read, so each lands in its own place below.
    const loaded = structuredClone(profile)
    const missing: PdfExportMissingImage[] = []
    PDF_EXPORT_IMAGE_SLOTS.forEach(({ slot, set }, index) => {
        const { dataUrl, error } = reads[index]!
        set(loaded, dataUrl)
        if (error) missing.push({ slot, path: paths[index]!, reason: error })
    })
    return {
        assets: {
            logoDataUrl: loaded.brand.logoPath,
            header: { left: loaded.header.left.imagePath, right: loaded.header.right.imagePath },
            footer: { left: loaded.footer.left.imagePath, right: loaded.footer.right.imagePath },
        },
        missing,
    }
}
