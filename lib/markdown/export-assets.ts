import { invoke } from '@tauri-apps/api/core'
import { errorMessage } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import type { PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

/** A profile image the export needed but could not load, so it was left out. */
export type PdfExportMissingImage = {
    /** Which setting names the image, e.g. `Logo` or `Footer left image`. */
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
    if (!isTauri()) return { dataUrl: '', error: 'Images can only be read in the desktop app.' }
    try {
        return { dataUrl: await invoke<string>('read_export_image', { path }) }
    } catch (err) {
        return { dataUrl: '', error: errorMessage(err, 'Could not read image.') }
    }
}

/**
 * Reads the profile's images as data URLs, skipping the ones this export won't show.
 * An image that can't be read is left out and listed in `missing`, so the caller can say so.
 */
export async function resolvePdfExportAssets(profile: PdfExportProfile): Promise<PdfExportLoadedAssets> {
    const slots: { slot: string; path: string; used: boolean }[] = [
        { slot: 'Logo', path: profile.brand.logoPath, used: profile.frontMatter.titlePage },
        { slot: 'Header left image', path: profile.header.left.imagePath, used: profile.header.enabled },
        { slot: 'Header right image', path: profile.header.right.imagePath, used: profile.header.enabled },
        // Page numbers alone show a bare footer; its images need the Footer switch on.
        { slot: 'Footer left image', path: profile.footer.left.imagePath, used: profile.footer.enabled },
        { slot: 'Footer right image', path: profile.footer.right.imagePath, used: profile.footer.enabled },
    ]
    const reads = await Promise.all(slots.map(({ path, used }) => readImageDataUrl(used ? path.trim() : '')))
    const missing = slots.flatMap(({ slot, path }, index) => {
        const error = reads[index]!.error
        return error ? [{ slot, path: path.trim(), reason: error }] : []
    })
    const [logo, headerLeft, headerRight, footerLeft, footerRight] = reads.map((read) => read.dataUrl)
    return {
        assets: {
            logoDataUrl: logo!,
            header: { left: headerLeft!, right: headerRight! },
            footer: { left: footerLeft!, right: footerRight! },
        },
        missing,
    }
}
