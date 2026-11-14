import { errorMessage } from '@/lib/notify'
import { PDF_EXPORT_IMAGE_SLOTS } from '@/lib/settings/pdf-export-images'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { readExportImage } from '@/lib/tauri/export-image-access'

/** An image left out of an exported or imported profile, and why. */
export type LeftOutImage = { slot: string; reason: string }

/** True for an image held in the file itself (a data URL), not a path. */
export const isEmbedded = (image: string) => image.startsWith('data:')

/** The images left out, for a message: each one and why. */
export function describeLeftOut(leftOut: LeftOutImage[]): string {
    return leftOut.map(({ slot, reason }) => `${slot}: ${reason}`).join(' ')
}

/** A copy of `profile` with each image changed by `change`. An image it throws on is left out and listed. */
export async function changeImages(
    profile: PdfExportProfile,
    change: (image: string) => Promise<string>
): Promise<{ profile: PdfExportProfile; leftOut: LeftOutImage[] }> {
    const copy = structuredClone(profile)
    const leftOut: LeftOutImage[] = []
    for (const { slot, get, set } of PDF_EXPORT_IMAGE_SLOTS) {
        const image = get(copy).trim()
        if (!image) continue
        try {
            set(copy, await change(image))
        } catch (err) {
            set(copy, '')
            leftOut.push({ slot, reason: errorMessage(err) })
        }
    }
    return { profile: copy, leftOut }
}

/** A copy of `profile` with its images in it as data URLs, so it works on another computer. */
export function embedImages(profile: PdfExportProfile): Promise<{ profile: PdfExportProfile; leftOut: LeftOutImage[] }> {
    return changeImages(profile, async (image) => (isEmbedded(image) ? image : readExportImage(image)))
}
