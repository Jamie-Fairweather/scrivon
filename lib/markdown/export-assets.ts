import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'
import type { PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

async function readImageDataUrl(path: string): Promise<string> {
    const trimmed = path.trim()
    if (!trimmed) return ''
    if (trimmed.startsWith('data:')) return trimmed
    if (!isTauri()) return ''
    try {
        return await invoke<string>('read_export_image', { path: trimmed })
    } catch {
        return ''
    }
}

export async function resolvePdfExportAssets(profile: PdfExportProfile): Promise<PdfExportResolvedAssets> {
    const [logoDataUrl, headerLeft, headerRight, footerLeft, footerRight] = await Promise.all([
        readImageDataUrl(profile.brand.logoPath),
        readImageDataUrl(profile.header.left.imagePath),
        readImageDataUrl(profile.header.right.imagePath),
        readImageDataUrl(profile.footer.left.imagePath),
        readImageDataUrl(profile.footer.right.imagePath),
    ])
    return {
        logoDataUrl,
        header: { left: headerLeft, right: headerRight },
        footer: { left: footerLeft, right: footerRight },
    }
}
