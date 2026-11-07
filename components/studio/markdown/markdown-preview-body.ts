import { guessDocumentLanguage, parsePdfExportFrontMatter } from '@/lib/markdown/export-metadata'

/**
 * The part of a Markdown document the preview shows. YAML front matter is metadata (PDF export reads its title,
 * author and date for the title page), not content, so it is left out, found by the same rule export uses.
 */
export function markdownPreviewBody(source: string): string {
    return parsePdfExportFrontMatter(source).body
}

/** A fenced code block, ``` or ~~~, closed by a fence at least as long, or running to the end when never closed. */
const FENCED_CODE = /^ {0,3}(([`~])\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|$(?![\s\S]))/gm

/** How much prose the language guess reads: plenty to tell the language, and cheap enough for every keystroke. */
const LANGUAGE_SAMPLE_CHARS = 20_000

/**
 * The language to tag the preview with, as PDF export tags the PDF: the front matter's `lang:`, else a guess from
 * the prose (`en` when unsure). The browser picks the glyph shapes of shared Han characters by language, so this
 * makes a Japanese document's kanji look the same in the preview as in the PDF. Code is left out of the guess, as
 * export leaves it out: it reads as English whatever the text is in.
 */
export function markdownPreviewLang(source: string): string {
    const { body, lang } = parsePdfExportFrontMatter(source)
    if (lang) return lang
    return guessDocumentLanguage(body.replace(FENCED_CODE, '\n').slice(0, LANGUAGE_SAMPLE_CHARS))
}
