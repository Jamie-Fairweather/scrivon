import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'
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

/** Every image path the profiles name (logo, header and footer images), each once. */
export function profileImagePaths(settings: PdfExportSettings): string[] {
    const paths = settings.profiles.flatMap((profile) => [
        profile.brand.logoPath,
        profile.header.left.imagePath,
        profile.header.right.imagePath,
        profile.footer.left.imagePath,
        profile.footer.right.imagePath,
    ])
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
