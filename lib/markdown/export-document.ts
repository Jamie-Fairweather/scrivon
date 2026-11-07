import type { Root, Text } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { applyPdfFooterSwitch } from '@/lib/markdown/export-html-css'
import { collectPdfExportOutline, filterPdfExportOutline, type PdfExportOutlineItem } from '@/lib/markdown/export-outline'
import { guessDocumentLanguage, resolvePdfExportMetadata } from '@/lib/markdown/export-metadata'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'
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
    /** Language tag of the text: the front matter's `lang:`, else a guess from its script (`en` when unsure). */
    lang: string
    /** Whether `lang` was guessed from the text rather than set by `lang:`. A guessed `en` only means no other script leads. */
    langGuessed: boolean
    profile: PdfExportProfile
    assets: PdfExportResolvedAssets
    tree: Root
    outline: PdfExportOutlineItem[]
    toc: PdfExportOutlineItem[]
}

/** The document's prose for guessing its language. Code is left out: it reads as English whatever the text is in. */
function proseText(tree: Root): string {
    const parts: string[] = []
    visit(tree, 'text', (node: Text) => {
        parts.push(node.value)
    })
    return parts.join(' ')
}

/**
 * Markdown + profile (+ overrides) → the document PDF and Word both render.
 * Throws `Nothing to export.` when the body is empty after front matter is removed.
 */
export function buildExportDocument(source: string, options: BuildExportDocumentOptions = {}): ExportDocument {
    const profile = applyPdfFooterSwitch(options.profile ?? createDefaultPdfExportProfile())
    const given = options.assets ?? EMPTY_ASSETS
    // A switched-off footer shows only its page number, never its images.
    const assets = profile.footer.enabled ? given : { ...given, footer: EMPTY_ASSETS.footer }
    const { metadata, body, lang } = resolvePdfExportMetadata(source, options.tabName, options.overrides)
    if (!body.trim()) {
        throw new Error('Nothing to export.')
    }

    // Only leading blank lines go: trimming the first line's indent would turn an opening indented code block into a paragraph.
    const tree = unified()
        .use(remarkParse)
        .use(markdownRemarkPlugins)
        .parse(body.replace(/^(?:[ \t]*\r?\n)+/, '')) as Root
    const outline = collectPdfExportOutline(tree)
    const toc = profile.frontMatter.toc ? filterPdfExportOutline(outline, profile.frontMatter.tocDepth, profile.frontMatter.tocExcludeH1) : []

    return { metadata, lang: lang ?? guessDocumentLanguage(proseText(tree)), langGuessed: lang === undefined, profile, assets, tree, outline, toc }
}
