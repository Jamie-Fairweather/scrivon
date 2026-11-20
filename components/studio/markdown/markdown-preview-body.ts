import type { Element, ElementContent, Root as HastRoot } from 'hast'
import type { Root } from 'mdast'
import type { VFile } from 'vfile'
import { guessProseLanguage, parsePdfExportFrontMatter } from '@/lib/markdown/export-metadata'

declare module 'vfile' {
    interface DataMap {
        /** The language the preview is tagged with. See {@link remarkPreviewLang}. */
        previewLang: string
    }
}

/**
 * What the preview needs from a Markdown document: `body`, the part it shows, and `lang`, the front matter's `lang:`
 * if it has one. YAML front matter is metadata (PDF export reads its title, author and date for the title page), not
 * content, so it is left out of the body, found by the same rule export uses.
 */
export function markdownPreviewDocument(source: string): { body: string; lang?: string } {
    const { body, lang } = parsePdfExportFrontMatter(source)
    return { body, lang }
}

/** The part of a Markdown document the preview shows. See {@link markdownPreviewDocument}. */
export function markdownPreviewBody(source: string): string {
    return markdownPreviewDocument(source).body
}

/** The line of `source` its preview body (see {@link markdownPreviewBody}) starts on, counting from 1. */
export function markdownBodyFirstLine(source: string, body: string): number {
    const frontMatter = source.slice(0, source.length - body.length)
    return 1 + (frontMatter.match(/\r\n|\r|\n/g)?.length ?? 0)
}

/**
 * Remark plugin that works out the language to tag the preview with, as PDF export tags the PDF: `lang` (the front
 * matter's `lang:`), else a guess from the prose ({@link guessProseLanguage}, which export uses too), so code, math
 * and image links don't count. It reads the tree the preview draws, so the document isn't parsed twice. The browser
 * picks the glyph shapes of shared Han characters by language, so this makes a Japanese document's kanji look the
 * same in the preview as in the PDF.
 */
export function remarkPreviewLang(lang: string | undefined) {
    return () => (tree: Root, file: VFile) => {
        file.data.previewLang = lang ?? guessProseLanguage(tree)
    }
}

/** Rehype plugin that puts the whole document in one `<article>`, tagged with the language {@link remarkPreviewLang} found. */
export function rehypePreviewArticle(className: string) {
    return () => (tree: HastRoot, file: VFile) => {
        const article: Element = {
            type: 'element',
            tagName: 'article',
            properties: { lang: file.data.previewLang ?? 'en', className: className.split(' ') },
            children: tree.children.filter((node): node is ElementContent => node.type !== 'doctype'),
        }
        tree.children = [article]
    }
}

/** Whitespace between blocks, or an HTML comment: nothing a slide would show. */
function isBlank(node: ElementContent): boolean {
    if (node.type === 'comment') return true
    return node.type === 'text' && node.value.trim() === ''
}

/** remark-rehype's list of footnote definitions, which it puts at the end of the document. */
function isFootnotes(node: ElementContent): boolean {
    return node.type === 'element' && node.tagName === 'section' && node.properties.dataFootnotes !== undefined
}

/**
 * Splits the `<article>` {@link rehypePreviewArticle} built into slides: one `<section>` for each run of its
 * top-level children between `<hr>`s (a `---` thematic break, or raw HTML `<hr>`), which are dropped. A break inside
 * a list or quote isn't at the top level, so it stays where it is. A slide with nothing in it (a break at the start
 * or the end, or two in a row) is left out. The footnotes go at the end of the last slide, numbered as in the
 * preview. Each section takes the article's `lang` and `dir`, and is numbered from 0 in `data-slide`, with how many
 * there are in `data-slides`.
 */
export function splitArticleIntoSlides(tree: HastRoot): void {
    const article = tree.children.find((node): node is Element => node.type === 'element' && node.tagName === 'article')
    if (!article) return

    const groups: ElementContent[][] = [[]]
    const footnotes: ElementContent[] = []
    for (const node of article.children) {
        if (node.type === 'element' && node.tagName === 'hr') groups.push([])
        else if (isFootnotes(node)) footnotes.push(node)
        else groups.at(-1)!.push(node)
    }
    const slides = groups.filter((group) => !group.every(isBlank))
    if (footnotes.length > 0) {
        if (slides.length === 0) slides.push([])
        slides.at(-1)!.push(...footnotes)
    }

    const { lang, dir } = article.properties
    article.children = slides.map((children, index): Element => ({
        type: 'element',
        tagName: 'section',
        properties: {
            ...(lang !== undefined && { lang }),
            ...(dir !== undefined && { dir }),
            dataSlide: index,
            dataSlides: slides.length,
        },
        children,
    }))
}

/** Rehype plugin for {@link splitArticleIntoSlides}, run after {@link rehypePreviewArticle}. */
export function rehypePreviewSlides() {
    return splitArticleIntoSlides
}
