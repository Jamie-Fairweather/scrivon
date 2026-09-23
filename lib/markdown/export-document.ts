import type { Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { collectPdfExportOutline, filterPdfExportOutline, type PdfExportOutlineItem } from '@/lib/markdown/export-outline'
import { resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportMetadata, PdfExportMetadataOverrides, PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

export type ExportFormat = 'pdf' | 'docx'

export type BuildExportDocumentOptions = {
    profile?: PdfExportProfile
    tabName?: string
    overrides?: PdfExportMetadataOverrides
    assets?: PdfExportResolvedAssets
}

const EMPTY_ASSETS: PdfExportResolvedAssets = {
    logoDataUrl: '',
    header: { left: '', right: '' },
    footer: { left: '', right: '' },
}

/**
 * The format-neutral document both renderers consume. Markdown has been parsed,
 * front matter resolved, and the outline stamped onto heading nodes. A renderer
 * turns this into one format; add a format by adding a renderer, not a new parse.
 */
export type ExportDocument = {
    metadata: PdfExportMetadata
    profile: PdfExportProfile
    assets: PdfExportResolvedAssets
    tree: Root
    outline: PdfExportOutlineItem[]
    toc: PdfExportOutlineItem[]
}

/**
 * Markdown + profile (+ overrides) → the document PDF and Word both render.
 * Throws `Nothing to export.` when the body is empty after front matter is removed.
 */
export function buildExportDocument(source: string, options: BuildExportDocumentOptions = {}): ExportDocument {
    const profile = options.profile ?? createDefaultPdfExportProfile()
    const assets = options.assets ?? EMPTY_ASSETS
    const { metadata, body } = resolvePdfExportMetadata(source, options.tabName, options.overrides)
    const trimmed = body.trim()
    if (!trimmed) {
        throw new Error('Nothing to export.')
    }

    const tree = unified().use(remarkParse).use(remarkGfm).parse(trimmed) as Root
    const outline = collectPdfExportOutline(tree)
    const toc = profile.frontMatter.toc ? filterPdfExportOutline(outline, profile.frontMatter.tocDepth, profile.frontMatter.tocExcludeH1) : []

    return { metadata, profile, assets, tree, outline, toc }
}
