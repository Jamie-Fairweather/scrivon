import { parsePdfExportFrontMatter } from '@/lib/markdown/export-metadata'

/**
 * The part of a Markdown document the preview shows. YAML front matter is metadata (PDF export reads its title,
 * author and date for the title page), not content, so it is left out, found by the same rule export uses.
 */
export function markdownPreviewBody(source: string): string {
    return parsePdfExportFrontMatter(source).body
}
