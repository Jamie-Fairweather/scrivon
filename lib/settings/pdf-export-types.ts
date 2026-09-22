import type { AppThemeId } from '@/lib/theme/catalog'
import type { ShikiTheme } from '@/lib/markdown/shiki-highlighter'

export type PdfPageSize = 'a4' | 'letter'
export type PdfPageOrientation = 'portrait' | 'landscape'

export type PdfMarginsMm = {
    top: number
    right: number
    bottom: number
    left: number
}

export type PdfHideOnFirstPages = 'none' | 'title' | 'title+toc'
/** `custom` renders `footer.right.text`, which may use `{{page}}` and `{{total}}`. */
export type PdfPageNumberFormat = 'none' | 'number' | 'page-n' | 'n-of-total' | 'custom'
export type PdfTocDepth = 1 | 2 | 3 | 4

/** 0 = off; N = H1…HN start a new page (chosen level and all above). */
export type PdfNewPageFromHeading = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** One end of a header/footer bar. The image always sits outermost, nearest the page edge. */
export type PdfExportChromeSide = {
    text: string
    imagePath: string
}

export type PdfExportChrome = {
    enabled: boolean
    left: PdfExportChromeSide
    right: PdfExportChromeSide
    backgroundColor: string
    /** Empty = default chrome text colour. */
    textColor: string
    /** 0 = auto height (fits content). */
    heightMm: number
    /** Extra space between the bar and the body content. */
    gapMm: number
    /** Bleed to the page edge instead of sitting inside the page margins. */
    ignoreMargins: boolean
    hideOnFirstPages: PdfHideOnFirstPages
}

export type PdfExportFooter = PdfExportChrome & {
    /** Owns the right-hand text slot: a preset counter, or `custom` to render `right.text`. */
    pageNumbers: PdfPageNumberFormat
}

export type PdfExportProfile = {
    id: string
    name: string
    page: {
        size: PdfPageSize
        orientation: PdfPageOrientation
        marginsMm: PdfMarginsMm
    }
    typography: {
        headingFont: string
        bodyFont: string
        monoFont: string
        bodySizePt: number
        lineHeight: number
    }
    brand: {
        accentColor: string
        linkColor: string
        logoPath: string
        /** Stretch the title-page image to the page edges instead of the content area. */
        logoIgnoreMargins: boolean
    }
    frontMatter: {
        titlePage: boolean
        toc: boolean
        tocDepth: PdfTocDepth
        tocExcludeH1: boolean
    }
    header: PdfExportChrome
    footer: PdfExportFooter
    flow: {
        newPageFromHeading: PdfNewPageFromHeading
    }
    content: {
        codeTheme: ShikiTheme
        mermaidThemeId: AppThemeId
        watermark: string
    }
}

export type PdfExportSettings = {
    profiles: PdfExportProfile[]
    activeProfileId: string
}

export type PdfExportMetadataOverrides = {
    title?: string
    subtitle?: string
    author?: string
    date?: string
}

export type PdfExportMetadata = {
    title: string
    subtitle: string
    author: string
    date: string
}

export type PdfExportResolvedChromeImages = {
    left: string
    right: string
}

export type PdfExportResolvedAssets = {
    logoDataUrl: string
    header: PdfExportResolvedChromeImages
    footer: PdfExportResolvedChromeImages
}

/**
 * Everything the print engine needs alongside the HTML. Field names mirror
 * `PdfPrintOptions` in `src-tauri/src/pdf_export.rs` (camelCase over the wire).
 */
export type PdfPrintOptions = {
    /** Portrait sheet size; `landscape` rotates it. */
    pageWidthMm: number
    pageHeightMm: number
    landscape: boolean
    marginTopMm: number
    marginRightMm: number
    marginBottomMm: number
    marginLeftMm: number
    /** Stamper format: a preset name, `custom:<template>`, or `none`. */
    pageNumberFormat: string
    /** Hex colour for the stamped label; empty for the default chrome colour. */
    pageNumberColor: string
}

/** The branded document plus what the printer needs to turn it into a PDF, produced by one call. */
export type PdfExportDocument = {
    html: string
    metadata: PdfExportMetadata
    print: PdfPrintOptions
}
