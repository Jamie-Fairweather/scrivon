import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'

/** One image a profile can name: a file path, or a data URL. */
export type PdfExportImageSlot = {
    /** How messages name it, e.g. `Cover image`. */
    slot: string
    get: (profile: PdfExportProfile) => string
    set: (profile: PdfExportProfile, value: string) => void
    /** Whether an export with this profile shows the image. */
    shown: (profile: PdfExportProfile) => boolean
}

/**
 * Every image a profile can name. The export reads them (lib/markdown/export-assets.ts), profile files
 * embed them (lib/settings/profile-transfer.ts), and the image check knows them (lib/tauri/export-image-access.ts).
 */
export const PDF_EXPORT_IMAGE_SLOTS: readonly PdfExportImageSlot[] = [
    {
        slot: 'Cover image',
        get: (p) => p.brand.logoPath,
        set: (p, value) => void (p.brand.logoPath = value),
        shown: (p) => p.frontMatter.titlePage,
    },
    {
        slot: 'Header left image',
        get: (p) => p.header.left.imagePath,
        set: (p, value) => void (p.header.left.imagePath = value),
        shown: (p) => p.header.enabled,
    },
    {
        slot: 'Header right image',
        get: (p) => p.header.right.imagePath,
        set: (p, value) => void (p.header.right.imagePath = value),
        shown: (p) => p.header.enabled,
    },
    // Page numbers alone show a bare footer; its images need the Footer switch on.
    {
        slot: 'Footer left image',
        get: (p) => p.footer.left.imagePath,
        set: (p, value) => void (p.footer.left.imagePath = value),
        shown: (p) => p.footer.enabled,
    },
    {
        slot: 'Footer right image',
        get: (p) => p.footer.right.imagePath,
        set: (p, value) => void (p.footer.right.imagePath = value),
        shown: (p) => p.footer.enabled,
    },
]
