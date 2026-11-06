import type { Heading, Root } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { nodeText } from '@/lib/markdown/export-outline'
import type { PdfExportMetadata, PdfExportMetadataOverrides, PdfExportProfile } from '@/lib/settings/pdf-export-types'

const FRONT_MATTER_KEYS = new Set(['title', 'subtitle', 'author', 'date'])

const PAGE_PLACEHOLDER = /\{\{\s*(page|total)\s*\}\}/

/** Fills the document placeholders a header/footer text may use. */
export function resolvePdfChromeText(text: string, metadata: PdfExportMetadata): string {
    return text.replaceAll('{{title}}', metadata.title).replaceAll('{{date}}', metadata.date).trim()
}

/**
 * A custom footer text that needs the page count, with the document placeholders
 * already filled. Empty when numbering is off, a preset is chosen, or the custom
 * text is static (then it is ordinary HTML text and never reaches the stamper).
 */
export function pdfPageNumberTemplate(profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    if (profile.footer.pageNumbers !== 'custom') return ''
    const template = resolvePdfChromeText(profile.footer.right.text, metadata)
    return PAGE_PLACEHOLDER.test(template) ? template : ''
}

/**
 * Format string for the page-number stamper: a preset name, `custom:<template>`
 * (the stamper fills `{{page}}` / `{{total}}`), or `none`.
 */
export function pdfPageNumberFormat(profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    const format = profile.footer.pageNumbers
    if (format !== 'custom') return format
    const template = pdfPageNumberTemplate(profile, metadata)
    return template ? `custom:${template}` : 'none'
}

function stripQuotes(value: string): string {
    const trimmed = value.trim()
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1)
    }
    return trimmed
}

/** A YAML `key:` line, the kind of line front matter is made of. */
const YAML_KEY_LINE = /^[A-Za-z_][\w-]*\s*:/
/** What YAML allows after a key: indented (nested) values, list items and comments. */
const YAML_CONTINUATION_LINE = /^(?:\s|-\s|-$|#)/

/**
 * Whether the text between two leading `---` lines is front matter rather than
 * ordinary Markdown between two horizontal rules. Only `key: value` lines (and
 * the values nested under them) count, so paragraphs between rules are kept.
 */
function isFrontMatterBlock(block: string): boolean {
    let sawKey = false
    for (const line of block.split(/\r?\n/)) {
        if (!line.trim()) continue
        if (YAML_KEY_LINE.test(line)) sawKey = true
        else if (!sawKey || !YAML_CONTINUATION_LINE.test(line)) return false
    }
    return true
}

export function parsePdfExportFrontMatter(source: string): { matter: Partial<PdfExportMetadata>; body: string } {
    // The closing fence is a `---` line of its own: `----` or a `---|---` table divider doesn't close it.
    const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
    if (!match || !isFrontMatterBlock(match[1]!)) return { matter: {}, body: source }

    const matter: Partial<PdfExportMetadata> = {}
    for (const line of match[1]!.split(/\r?\n/)) {
        const colon = line.indexOf(':')
        if (colon <= 0) continue
        const key = line.slice(0, colon).trim().toLowerCase()
        if (!FRONT_MATTER_KEYS.has(key)) continue
        const value = stripQuotes(line.slice(colon + 1))
        if (!value) continue
        matter[key as keyof PdfExportMetadata] = value
    }

    return { matter, body: match[2]! }
}

/**
 * The plain text of the document's first top-level H1, ATX or setext. Read from the parsed
 * tree, so a `# comment` in fenced code never wins and inline markup drops out.
 */
function firstHeadingText(body: string): string {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(body) as Root
    const heading = tree.children.find((node): node is Heading => node.type === 'heading' && node.depth === 1)
    return heading ? nodeText(heading).replace(/\s+/g, ' ').trim() : ''
}

export function fallbackPdfExportTitle(body: string, tabName: string | undefined): string {
    const heading = firstHeadingText(body)
    if (heading) return heading
    if (!tabName) return 'Document'
    const base = tabName.replace(/\.md$/i, '').trim()
    return base || 'Document'
}

export function resolvePdfExportMetadata(
    source: string,
    tabName: string | undefined,
    overrides: PdfExportMetadataOverrides = {}
): { metadata: PdfExportMetadata; body: string } {
    const { matter, body } = parsePdfExportFrontMatter(source)
    const title = overrides.title?.trim() || matter.title?.trim() || fallbackPdfExportTitle(body, tabName)
    return {
        metadata: {
            title,
            subtitle: overrides.subtitle?.trim() || matter.subtitle?.trim() || '',
            author: overrides.author?.trim() || matter.author?.trim() || '',
            date: overrides.date?.trim() || matter.date?.trim() || '',
        },
        body,
    }
}
