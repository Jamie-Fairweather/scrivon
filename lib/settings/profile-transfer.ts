import { errorMessage } from '@/lib/notify'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import { normalizePdfExportProfile } from '@/lib/settings/pdf-export-normalize'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { parseJson, PROFILE_FILE_KIND, SETTINGS_FILE_KIND, TRANSFER_FILE_VERSION } from '@/lib/settings/settings-transfer'
import { readExportImage, saveProfileImage } from '@/lib/tauri/export-image-access'
import { isTauri } from '@/lib/tauri/platform'

/** An image left out of an exported or imported profile, and why. */
export type LeftOutImage = { slot: string; reason: string }

type ImageSlot = {
    slot: string
    get: (profile: PdfExportProfile) => string
    set: (profile: PdfExportProfile, value: string) => void
}

/** The images a profile can name, by the names the export uses for them (lib/markdown/export-assets.ts). */
const IMAGE_SLOTS: ImageSlot[] = [
    { slot: 'Cover image', get: (p) => p.brand.logoPath, set: (p, value) => void (p.brand.logoPath = value) },
    { slot: 'Header left image', get: (p) => p.header.left.imagePath, set: (p, value) => void (p.header.left.imagePath = value) },
    { slot: 'Header right image', get: (p) => p.header.right.imagePath, set: (p, value) => void (p.header.right.imagePath = value) },
    { slot: 'Footer left image', get: (p) => p.footer.left.imagePath, set: (p, value) => void (p.footer.left.imagePath = value) },
    { slot: 'Footer right image', get: (p) => p.footer.right.imagePath, set: (p, value) => void (p.footer.right.imagePath = value) },
]

const isEmbedded = (image: string) => image.startsWith('data:')

/** A copy of `profile` with each image changed by `change`. An image it throws on is left out and listed. */
async function changeImages(
    profile: PdfExportProfile,
    change: (image: string) => Promise<string>
): Promise<{ profile: PdfExportProfile; leftOut: LeftOutImage[] }> {
    const copy = structuredClone(profile)
    const leftOut: LeftOutImage[] = []
    for (const { slot, get, set } of IMAGE_SLOTS) {
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

/**
 * The text of a file holding one export profile, to share it. Its images are embedded, so it works on
 * another computer. An image that can't be read is left out and listed.
 */
export async function profileExportText(profile: PdfExportProfile): Promise<{ text: string; leftOut: LeftOutImage[] }> {
    const embedded = await changeImages(profile, async (image) => (isEmbedded(image) ? image : readExportImage(image)))
    // The id only means something in this computer's settings.
    const shared: Partial<PdfExportProfile> = embedded.profile
    delete shared.id
    const file = { scrivon: PROFILE_FILE_KIND, version: TRANSFER_FILE_VERSION, profile: shared }
    return { text: JSON.stringify(file, null, 2), leftOut: embedded.leftOut }
}

/** A file name for a profile: its name, without the characters Windows can't use in one. */
export function profileFileName(name: string): string {
    const safe = name
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/, '')
        .trim()
    return `${safe || 'Export profile'}.json`
}

/**
 * The profile in an exported profile file, checked and with values out of range put back in range. Its
 * embedded images are saved in Scrivon's data folder and the profile names those; an image that can't be
 * used is left out and listed. Throws an Error saying why for any other file.
 */
export async function readProfileExport(text: string): Promise<{ profile: PdfExportProfile; leftOut: LeftOutImage[] }> {
    const file = parseJson(text) as { scrivon?: unknown; profile?: unknown } | null | undefined
    if (file?.scrivon === SETTINGS_FILE_KIND) throw new Error('This is a settings file. Import it in Settings, Advanced.')
    const raw = file?.scrivon === PROFILE_FILE_KIND ? file.profile : null
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error("This file isn't a Scrivon export profile.")

    const profile = normalizePdfExportProfile(raw, createDefaultPdfExportProfile({ id: 'imported', name: 'Imported profile' }))
    return changeImages(profile, async (image) => {
        // A path names a file on the computer the profile came from.
        if (!isEmbedded(image)) throw new Error("It isn't embedded in the file.")
        // Kept in the profile only outside the desktop app: web storage holds just a few MB.
        return isTauri() ? saveProfileImage(image) : image
    })
}
