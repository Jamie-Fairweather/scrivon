import { invoke } from '@tauri-apps/api/core'
import { errorMessage } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { PDF_EXPORT_IMAGE_SLOTS } from '@/lib/settings/pdf-export-images'
import type { PdfExportSettings } from '@/lib/settings/pdf-export-types'

/**
 * The export only reads images the user chose (src-tauri/src/pdf_export/export_image_access.rs).
 * Call this right after the user picks one, so it still exports after a restart.
 */
export async function rememberExportImage(path: string): Promise<void> {
    if (!isTauri() || !path.trim()) return
    try {
        await invoke('remember_export_image', { path })
    } catch (err) {
        // The image still exports this session, and that first export records it too.
        console.warn("Couldn't remember the chosen image", err)
    }
}

/** An image the export may use, as a data URL. Throws an Error saying why when it can't be read. */
export async function readExportImage(path: string): Promise<string> {
    if (!isTauri()) throw new Error('Images can only be read in the desktop app.')
    try {
        return await invoke<string>('read_export_image', { path })
    } catch (err) {
        throw new Error(errorMessage(err, 'Could not read image.'))
    }
}

/**
 * Saves an image embedded in an imported profile (a data URL) as a file in Scrivon's data folder, which the
 * export may then read. Resolves to its path. Throws an Error saying why when Rust refuses it.
 */
export async function saveProfileImage(dataUrl: string): Promise<string> {
    try {
        return await invoke<string>('save_profile_image', { dataUrl })
    } catch (err) {
        throw new Error(errorMessage(err, 'Could not save the image.'))
    }
}

/** Every image path the profiles name (logo, header and footer images), each once. */
export function profileImagePaths(settings: PdfExportSettings): string[] {
    const paths = settings.profiles.flatMap((profile) => PDF_EXPORT_IMAGE_SLOTS.map(({ get }) => get(profile)))
    return [...new Set(paths.map((path) => path.trim()).filter((path) => path !== '' && !path.startsWith('data:')))]
}

/**
 * Hands the images of profiles saved before the image check to Rust, so they keep exporting.
 * Rust only takes them the first time, while it has no list of chosen images yet, and ignores later calls.
 */
export async function adoptExportImages(settings: PdfExportSettings): Promise<void> {
    if (!isTauri()) return
    try {
        await invoke('adopt_export_images', { paths: profileImagePaths(settings) })
    } catch (err) {
        console.warn("Couldn't hand over the export profiles' images", err)
    }
}
