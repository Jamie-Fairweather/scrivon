import {
    AlignmentType,
    Bookmark,
    BookmarkEnd,
    BookmarkStart,
    BorderStyle,
    BuilderElement,
    Document,
    ExternalHyperlink,
    Footer,
    FootnoteReferenceRun,
    Header,
    HeadingLevel,
    HeightRule,
    HorizontalPositionAlign,
    HorizontalPositionRelativeFrom,
    ImageRun,
    InternalHyperlink,
    LeaderType,
    LevelFormat,
    LineRuleType,
    Packer,
    PageBreak,
    PageNumber,
    PageOrientation,
    Paragraph,
    ShadingType,
    StringContainer,
    Tab,
    TabStopType,
    Table,
    TableCell,
    TableLayoutType,
    TableRow,
    TextRun,
    SectionType,
    TextWrappingType,
    UnderlineType,
    VerticalAlignSection,
    VerticalAlignTable,
    VerticalPositionAlign,
    VerticalPositionRelativeFrom,
    WidthType,
    convertMillimetersToTwip,
    type ILevelsOptions,
    type ISectionOptions,
    type ParagraphChild,
} from 'docx'
import type { Root as HastRoot, RootContent as HastContent } from 'hast'
import type {
    Blockquote,
    Break,
    Code,
    Definition,
    FootnoteDefinition,
    Heading,
    Html,
    Image,
    ImageReference,
    InlineCode,
    Link,
    LinkReference,
    List,
    ListItem,
    Paragraph as MdParagraph,
    PhrasingContent,
    Root,
    RootContent,
    Table as MdTable,
    TableCell as MdTableCell,
    TableRow as MdTableRow,
    Text,
} from 'mdast'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'
import { visit } from 'unist-util-visit'
import { notifyWarning } from '@/lib/notify'
import type { ExportDocument } from '@/lib/markdown/export-document'
import type { PdfExportOutlineItem } from '@/lib/markdown/export-outline'
import { pdfChromeShown, pdfPageSizeMm, resolvePdfExportLayout } from '@/lib/markdown/export-html-css'
import { resolveHeadingAnchor, safeExportHref } from '@/lib/markdown/export-links'
import { exportSanitizeSchema } from '@/lib/markdown/html-sanitize-schema'
import { hanScriptOfTag, pdfPageNumberTemplate, resolvePdfChromeText } from '@/lib/markdown/export-metadata'
import { highlightFencedCodeTokens, type HighlightedToken } from '@/lib/markdown/shiki-highlighter'
import { isRtl, RTL_LETTER } from '@/lib/markdown/text-direction'
import { diagramAltText, type DiagramAltText } from '@/lib/mermaid/diagram-alt-text'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { svgToPngBlob } from '@/lib/mermaid/export'
import { EMPTY_DIAGRAM_MESSAGE, getSvgDimensions } from '@/lib/mermaid/svg-dimensions'
import type { AppThemeId } from '@/lib/theme/catalog'
import { familyName, splitFontStack } from '@/lib/settings/font-stack'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'

type Block = Paragraph | Table
type ImageKind = 'png' | 'jpg' | 'gif' | 'bmp'
type PreparedCode =
    | { kind: 'code'; lines: HighlightedToken[][] }
    /** `size` is the SVG's own size, which the PDF draws it at. The PNG is drawn at 2x that. */
    | { kind: 'diagram'; png: Uint8Array | null; size: { width: number; height: number } | null; source: string; alt: DiagramAltText }
    | { kind: 'error'; message: string }

type Marks = {
    bold?: boolean
    italics?: boolean
    strike?: boolean
    code?: boolean
    quote?: boolean
    link?: boolean
    /** Half-points. Set on heading runs so they don't inherit the body size. */
    headingSize?: number
}

const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-monospace', 'ui-serif', 'ui-sans-serif'])
const SKIP_FONTS = new Set(['blinkmacsystemfont', 'sfmono-regular'])
/** Fonts only Macs have. Windows has no substitute for them, so a later name in the stack wins when there is one. */
const MAC_ONLY_FONTS = new Set(['menlo', 'monaco', 'sf mono', 'helvetica neue', 'lucida grande', 'geneva', 'apple color emoji'])
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const GRID_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'E5E5E5' }
/** Same cap the PDF cover uses (`max-height: 150mm`). */
const LOGO_MAX_HEIGHT_MM = 150
/** The PDF's heading sizes, h1 to h6, in em of the body text, so headings grow and shrink with the Body size. */
const HEADING_EM = [1.64, 1.36, 1.23, 1.09, 1, 0.9] as const
/** The PDF's code block, cover title and Contents title sizes, in em of the body text. */
const CODE_EM = 0.82
const TITLE_EM = 2.18
const CONTENTS_TITLE_EM = 1.8
/** CSS heading margins, in twips. 1rem = 240. */
const HEADING_SPACING = [
    { before: 0, after: 240 },
    { before: 360, after: 180 },
    { before: 300, after: 120 },
    { before: 240, after: 120 },
    { before: 200, after: 80 },
    { before: 160, after: 80 },
] as const
/** PDF list items step in `margin-inline-start: 1.25rem`, about this. The marker hangs inside it, not in the page margin. */
const LIST_STEP = 360
/** PDF quotes are `padding-inline-start: 1rem` beside the bar. Each nested quote steps in this far. */
const QUOTE_STEP = 240
/** PDF table cells are `padding: 0.5rem 0.75rem`. */
const TABLE_CELL_MARGIN = { marginUnitType: WidthType.DXA, top: 120, bottom: 120, left: 180, right: 180 }
const HEADING_LEVELS = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
] as const

/**
 * The font families a CSS stack names, in order, without generic families and browser-only names. Quoted names
 * lose their quotes and escapes, and a comma inside one doesn't split it.
 */
function fontNames(stack: string): string[] {
    return splitFontStack(stack)
        .map(familyName)
        .filter((name) => name && !name.startsWith('-') && !GENERIC_FONTS.has(name.toLowerCase()) && !SKIP_FONTS.has(name.toLowerCase()))
}

function wordFont(stack: string, fallback: string): string {
    const names = fontNames(stack)
    return names.find((name) => !MAC_ONLY_FONTS.has(name.toLowerCase())) ?? names[0] ?? fallback
}

/**
 * A font for Chinese, Japanese or Korean text, and its Word charset so Word swaps in one of the same script if it's
 * missing. No charset when the script isn't known.
 */
type EastAsianFont = { name: string; charset?: string }

const EAST_ASIAN_FONTS = {
    japanese: { name: 'Yu Gothic', charset: '80' },
    korean: { name: 'Malgun Gothic', charset: '81' },
    // Simplified glyph shapes. A Traditional Chinese language tag (zh-TW, zh-HK, zh-Hant) gets JhengHei instead.
    chinese: { name: 'Microsoft YaHei', charset: '86' },
    traditional: { name: 'Microsoft JhengHei', charset: '88' },
} as const satisfies Record<string, EastAsianFont>

/** Word's four font slots. Word draws Chinese, Japanese and Korean characters with `eastAsia` and everything else with the rest. */
type WordFont = { ascii: string; hAnsi: string; cs: string; eastAsia?: string }

const KANA = /[぀-ヿㇰ-ㇿｦ-ﾟ]/g
const HANGUL = /[ᄀ-ᇿ㄰-㆏ꥠ-꥿가-힯]/g
const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{3FFFD}]/u
const HAN_ALL = new RegExp(HAN.source, 'gu')

/** Language tags Word reads with its East Asian and right-to-left language settings. */
const CJK_LANGUAGE = /^(?:ja|ko|zh)(?:-|$)/i
const RTL_LANGUAGE = /^(?:ar|fa|he|ps|ur|yi)(?:-|$)/i

/** The East Asian font a language tag asks for. Undefined when it isn't Chinese, Japanese or Korean. */
function languageEastAsianFont(lang: string): EastAsianFont | undefined {
    if (/^ja(?:-|$)/i.test(lang)) return EAST_ASIAN_FONTS.japanese
    if (/^ko(?:-|$)/i.test(lang)) return EAST_ASIAN_FONTS.korean
    if (/^zh(?:-|$)/i.test(lang)) return hanScriptOfTag(lang) === 'Hant' ? EAST_ASIAN_FONTS.traditional : EAST_ASIAN_FONTS.chinese
    return undefined
}

/**
 * The East Asian font for the document. Its language decides first (the front matter's `lang:`, or the guess from
 * its text). A document in another language that still has some such text gets one from the script that leads, as
 * the language guess weighs them: Hangul leading means Korean, kana in its Chinese characters Japanese, else Chinese.
 * Undefined with no such text, so Word keeps its own choice.
 */
function eastAsianFont(document: ExportDocument): EastAsianFont | undefined {
    const fromLanguage = languageEastAsianFont(document.lang)
    if (fromLanguage) return fromLanguage
    const { metadata, profile, tree } = document
    const parts = [metadata.title, metadata.subtitle, metadata.author, metadata.date, profile.content.watermark]
    for (const chrome of [profile.header, profile.footer]) parts.push(chrome.left.text, chrome.right.text)
    visit(tree, (node) => {
        if (node.type === 'html') return
        if ('value' in node && typeof node.value === 'string') parts.push(node.value)
        if ('alt' in node && typeof node.alt === 'string') parts.push(node.alt)
    })
    const text = parts.join('\n')
    const kana = text.match(KANA)?.length ?? 0
    const hangul = text.match(HANGUL)?.length ?? 0
    const han = text.match(HAN_ALL)?.length ?? 0
    if (kana + hangul + han === 0) return undefined
    if (hangul >= kana + han) return EAST_ASIAN_FONTS.korean
    // Japanese mixes kana into its kanji, so one stray kana ('ツ', '・') doesn't make Chinese text Japanese.
    return kana * 10 >= han ? EAST_ASIAN_FONTS.japanese : EAST_ASIAN_FONTS.chinese
}

/**
 * The document's language for Word's spelling and line breaking, with its East Asian and right-to-left parts.
 * Undefined, leaving Word to use the reader's own language, when it is only the `en` the guess falls back to:
 * a German or French document would otherwise be spell-checked as English.
 */
function wordLanguage({ lang, langGuessed }: ExportDocument): { value: string; eastAsia?: string; bidirectional?: string } | undefined {
    if (langGuessed && lang === 'en') return undefined
    return { value: lang, eastAsia: CJK_LANGUAGE.test(lang) ? lang : undefined, bidirectional: RTL_LANGUAGE.test(lang) ? lang : undefined }
}

/** Fonts made for Chinese, Japanese or Korean, by name, with their script's charset. Null where the name doesn't say which script. */
const CJK_FONT_NAMES: [pattern: RegExp, charset: string | null][] = [
    [/^(?:yu (?:gothic|mincho)|meiryo|ms p?(?:gothic|mincho)|ms ui gothic|biz ud|hiragino|noto (?:sans|serif)(?: cjk)? jp)/i, '80'],
    [/^(?:malgun gothic|gulim|dotum|batang|gungsuh|noto (?:sans|serif)(?: cjk)? kr)/i, '81'],
    [/^(?:microsoft yahei|dengxian|n?simsun|simhei|kaiti|fangsong|noto (?:sans|serif)(?: cjk)? sc|pingfang sc)/i, '86'],
    [/^(?:microsoft jhenghei|p?mingliu|dfkai-sb|noto (?:sans|serif)(?: cjk)? (?:tc|hk)|pingfang (?:tc|hk))/i, '88'],
    [/^(?:noto (?:sans|serif) cjk|source han (?:sans|serif)|pingfang)/i, null],
]

/** The charset a font name says it is for, null when it is a CJK font of no known script, undefined when it isn't one. */
function cjkCharset(name: string): string | null | undefined {
    const known = CJK_FONT_NAMES.find(([pattern]) => pattern.test(name))
    if (known) return known[1]
    // A name written in kana or Hangul, such as メイリオ or 맑은 고딕, is a Japanese or Korean font; one in Chinese characters is CJK.
    if (name.search(KANA) >= 0) return '80'
    if (name.search(HANGUL) >= 0) return '81'
    return HAN.test(name) ? null : undefined
}

/**
 * The first Chinese, Japanese or Korean font a CSS stack names, which is what the PDF draws such text with.
 * Undefined when the stack names none. A font of no known script takes the document's.
 */
function stackEastAsianFont(stack: string, script: EastAsianFont | undefined): EastAsianFont | undefined {
    for (const name of fontNames(stack)) {
        const charset = cjkCharset(name)
        if (charset !== undefined) return { name, charset: charset ?? script?.charset }
    }
    return undefined
}

function wordFontSlots(name: string, eastAsian: EastAsianFont | undefined): WordFont {
    return { ascii: name, hAnsi: name, cs: name, eastAsia: eastAsian?.name }
}

/**
 * Characters XML 1.0 doesn't allow: control characters other than tab, line feed and carriage return,
 * U+FFFE/U+FFFF, and half surrogate pairs. docx writes them as they are, and one of them makes Word refuse the whole file.
 */
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿\uD800-\uDFFF]/gu

/** Text Word can open. A form feed is whitespace in the PDF's HTML, so it becomes a space; the others are dropped. */
function xmlSafe(text: string): string {
    return text.replace(XML_ILLEGAL, (char) => (char === '\f' ? ' ' : ''))
}

/** Copies plain data with every string made {@link xmlSafe}. */
function xmlSafeCopy<T>(value: T): T {
    if (typeof value === 'string') return xmlSafe(value) as T
    if (Array.isArray(value)) return value.map(xmlSafeCopy) as T
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, xmlSafeCopy(item)])) as T
    return value
}

/**
 * The document with every piece of text Word will get made safe: body, code, alt text, links, title and other
 * metadata, contents, header and footer text, and the watermark. The Settings images are only decoded, so they stay as they are.
 */
function xmlSafeDocument(document: ExportDocument): ExportDocument {
    const { assets, ...text } = document
    return { ...xmlSafeCopy(text), assets }
}

/** Raw HTML read and cleaned as the PDF does it (see renderExportPdf): safe tags kept, comments, scripts and styles dropped. */
const htmlCleaner = unified().use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize, exportSanitizeSchema).freeze()

/** Tags that are blocks on the page, so each starts a line of its own in the Word file. */
const HTML_BLOCK_TAGS = new Set([
    ...['blockquote', 'caption', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'ol', 'p', 'pre', 'section'],
    ...['summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
])
const HTML_BOLD_TAGS = new Set(['b', 'strong', 'summary', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const HTML_ITALIC_TAGS = new Set(['i', 'em', 'cite', 'dfn', 'var'])
const HTML_STRIKE_TAGS = new Set(['del', 's', 'strike'])
const HTML_CODE_TAGS = new Set(['code', 'kbd', 'samp', 'tt'])

type HtmlMarks = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean; href?: string }
/** A piece of a line of raw HTML: some text, a picture, a line break or an anchor, with the marks of the tags around it. */
type HtmlLeaf = { node: Text | InlineCode | Image | Break | Html; marks: HtmlMarks }
/** A line of raw HTML: a block such as `<p>`, `<summary>` or a table row, and the alignment it asks for. */
type HtmlLine = { align?: string; leaves: HtmlLeaf[] }

/**
 * The id each anchor from raw HTML (`<a name="setup">`, or any tag's `id`) marks, by the empty `html` node standing in
 * for it once the rest of the HTML is gone (expandHtml). Word gets a bookmark there, so `#setup` links still land on it.
 */
const HTML_ANCHORS = new WeakMap<Html, string>()

function htmlAnchor(id: string): Html {
    const node: Html = { type: 'html', value: '' }
    HTML_ANCHORS.set(node, id)
    return node
}

function isTableCell(node: HastContent): boolean {
    return node.type === 'element' && (node.tagName === 'td' || node.tagName === 'th')
}

/**
 * The lines of text cleaned HTML shows, as the PDF does, and the marks of the tags around each piece. Every block
 * tag starts a line, and a table row's cells are split by bars as {@link tableAsText} does. Whitespace collapses as
 * in a browser, except in `<pre>`.
 */
function htmlLines(root: HastRoot): HtmlLine[] {
    const lines: HtmlLine[] = []
    let line: HtmlLine = { leaves: [] }
    const endLine = (align: string | undefined) => {
        if (line.leaves.length > 0) lines.push(line)
        line = { align, leaves: [] }
    }
    const text = (value: string, marks: HtmlMarks) => {
        const safe = xmlSafe(value)
        line.leaves.push({ node: marks.code ? { type: 'inlineCode', value: safe } : { type: 'text', value: safe }, marks })
    }
    const lineBreak = (marks: HtmlMarks) => line.leaves.push({ node: { type: 'break' }, marks })
    const walk = (nodes: HastContent[], marks: HtmlMarks, align: string | undefined, pre: boolean) => {
        nodes.forEach((node, index) => {
            if (node.type === 'text' && pre) {
                node.value.split('\n').forEach((part, at) => {
                    if (at > 0) lineBreak(marks)
                    if (part) text(part, { ...marks, code: true })
                })
            } else if (node.type === 'text') {
                text(node.value.replace(/[ \t\n\f\r]+/g, ' '), marks)
            } else if (node.type === 'element' && node.tagName === 'br') {
                lineBreak(marks)
            } else if (node.type === 'element' && node.tagName === 'img') {
                const { alt, src } = node.properties
                const description = typeof alt === 'string' ? xmlSafe(alt) : ''
                if (typeof src === 'string') line.leaves.push({ node: { type: 'image', url: xmlSafe(src), alt: description }, marks })
                else if (description) text(description, marks)
            } else if (node.type === 'element') {
                const tag = node.tagName
                const { align: own, href, id, name } = node.properties
                const blockAlign = typeof own === 'string' ? own.toLowerCase() : align
                const block = HTML_BLOCK_TAGS.has(tag)
                if (block) endLine(blockAlign)
                if (isTableCell(node) && nodes.slice(0, index).some(isTableCell)) text(' | ', {})
                // The PDF links to any id, and to an old-style <a name> (resolveLinks).
                for (const anchor of [id, tag === 'a' ? name : undefined]) {
                    if (typeof anchor === 'string' && anchor) line.leaves.push({ node: htmlAnchor(xmlSafe(anchor)), marks: {} })
                }
                const inner: HtmlMarks = {
                    bold: marks.bold || HTML_BOLD_TAGS.has(tag) || undefined,
                    italics: marks.italics || HTML_ITALIC_TAGS.has(tag) || undefined,
                    strike: marks.strike || HTML_STRIKE_TAGS.has(tag) || undefined,
                    code: marks.code || HTML_CODE_TAGS.has(tag) || undefined,
                    href: tag === 'a' && typeof href === 'string' ? xmlSafe(href) : marks.href,
                }
                walk(node.children, inner, blockAlign, pre || tag === 'pre')
                if (block) endLine(align)
            }
        })
    }
    walk(root.children, {}, undefined, false)
    endLine(undefined)
    return lines
}

/**
 * The lines of an HTML block that show something or hold an anchor, spaces collapsed across tags. A line of only
 * spaces or breaks is left out.
 */
function visibleHtmlLines(lines: HtmlLine[]): HtmlLine[] {
    return lines.flatMap(({ align, leaves }) => {
        const kept = trimHtmlLine(leaves)
        const shown = kept.some(({ node }) => node.type === 'image' || node.type === 'html' || (node.type !== 'break' && node.value.trim() !== ''))
        return shown ? [{ align, leaves: kept }] : []
    })
}

/** A line with its spaces collapsed across tags, as a browser shows it: none at its ends, never two in a row, and no line break at its end. */
function trimHtmlLine(leaves: HtmlLeaf[]): HtmlLeaf[] {
    let afterSpace = true
    for (const { node } of leaves) {
        if (node.type === 'text') {
            if (afterSpace) node.value = node.value.replace(/^ /, '')
            if (node.value) afterSpace = node.value.endsWith(' ')
        } else if (node.type !== 'html') {
            afterSpace = node.type === 'break'
        }
    }
    const kept = leaves.filter(({ node }) => node.type !== 'text' || node.value !== '')
    // From the end, past anchors, which take no room.
    for (let at = kept.length - 1; at >= 0; at -= 1) {
        const node = kept[at]!.node
        if (node.type === 'html') continue
        if (node.type === 'text') node.value = node.value.replace(/ $/, '')
        if (node.type === 'break' || (node.type === 'text' && !node.value)) kept.splice(at, 1)
        else break
    }
    return kept
}

/** The Markdown a line's pieces stand for: runs of the same marks inside one bold, italic, struck-through or link node. */
function htmlPhrasing(leaves: HtmlLeaf[]): PhrasingContent[] {
    const phrasing: PhrasingContent[] = []
    const key = ({ bold, italics, strike, href }: HtmlMarks) => JSON.stringify([bold, italics, strike, href])
    for (let start = 0; start < leaves.length; ) {
        const marks = leaves[start]!.marks
        let end = start
        const nodes: PhrasingContent[] = []
        for (; end < leaves.length && key(leaves[end]!.marks) === key(marks); end += 1) {
            const node = leaves[end]!.node
            const previous = nodes[nodes.length - 1]
            if (node.type === 'text' && previous?.type === 'text') previous.value += node.value
            else nodes.push(node)
        }
        let wrapped = nodes
        if (marks.strike) wrapped = [{ type: 'delete', children: wrapped }]
        if (marks.italics) wrapped = [{ type: 'emphasis', children: wrapped }]
        if (marks.bold) wrapped = [{ type: 'strong', children: wrapped }]
        if (marks.href !== undefined) wrapped = [{ type: 'link', url: marks.href, children: wrapped }]
        phrasing.push(...wrapped)
        start = end
    }
    return phrasing
}

/** Where raw HTML is a block of its own. Anywhere else it is a tag inside a line of text. */
const HTML_BLOCK_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition'])

/**
 * Swaps raw HTML in `tree` for the Markdown it shows, as the preview and PDF show it: a block becomes a paragraph
 * per line (keeping a `<p align>`'s alignment), and a tag in a line its picture or line break. Only tags, comments
 * and what the PDF drops (scripts, styles) are left out. The rest of the Word export then needs no HTML of its own,
 * so the page estimate, pictures, language guess and text direction all count it.
 */
function expandHtml(tree: Root): void {
    const cleaned = new Map<string, HastRoot>()
    visit(tree, 'html', (node: Html, index, parent) => {
        if (!parent || index === undefined) return
        let hast = cleaned.get(node.value)
        if (!hast) {
            hast = htmlCleaner.runSync({ type: 'root', children: [{ type: 'html', value: node.value }] }) as HastRoot
            cleaned.set(node.value, hast)
        }
        const lines = htmlLines(hast)
        // A tag in a line of text holds no words of its own: at most a picture or a line break, kept as they are.
        const replacement: RootContent[] = HTML_BLOCK_PARENTS.has(parent.type)
            ? visibleHtmlLines(lines).map(
                  (line): MdParagraph => ({
                      type: 'paragraph',
                      data: line.align ? { hProperties: { align: line.align } } : undefined,
                      children: htmlPhrasing(line.leaves),
                  })
              )
            : lines.flatMap((line) => htmlPhrasing(line.leaves))
        // The visit goes on after the replacement, so the empty html nodes standing for its anchors stay as they are.
        ;(parent.children as RootContent[]).splice(index, 1, ...replacement)
        return index + replacement.length
    })
}

function escapeXml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * docx only lists embedded fonts, so Word gets no hint about the code font.
 * Marking it fixed-pitch makes Word swap in another monospace font when it isn't installed.
 * Each East Asian font's charset does the same for its script, so a missing Yu Gothic becomes another Japanese font.
 */
function fontTableXml(monoFont: string, eastAsian: EastAsianFont[]): string {
    const entry = (name: string, charset: string | undefined, family: string, pitch: string) =>
        `<w:font w:name="${escapeXml(name)}">${charset ? `<w:charset w:val="${charset}"/>` : ''}<w:family w:val="${family}"/><w:pitch w:val="${pitch}"/></w:font>`
    // A CJK code font is listed once, as the code font, with its charset.
    const mono = eastAsian.find((font) => font.name === monoFont)
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        entry(monoFont, mono?.charset, 'modern', 'fixed'),
        ...eastAsian.filter((font) => font !== mono).map((font) => entry(font.name, font.charset, 'swiss', 'variable')),
        '</w:fonts>',
    ].join('')
}

/**
 * CSS hex (3, 4, 6 or 8 digits) to Word's 6-digit colour. Word has no see-through text or shading,
 * so a colour with alpha is blended onto what sits behind it: the white page unless `backdrop` says otherwise.
 */
function hexColor(value: string, fallback: string, backdrop = 'FFFFFF'): string {
    let raw = value.trim().replace(/^#/, '')
    if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return fallback
    if (raw.length <= 4)
        raw = raw
            .split('')
            .map((char) => `${char}${char}`)
            .join('')
    const alpha = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1
    return [0, 2, 4]
        .map((offset) => {
            const channel = parseInt(raw.slice(offset, offset + 2), 16)
            const behind = parseInt(backdrop.slice(offset, offset + 2), 16)
            return Math.round(channel * alpha + behind * (1 - alpha))
                .toString(16)
                .padStart(2, '0')
        })
        .join('')
        .toUpperCase()
}

function readU32BE(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}

function imageKind(bytes: Uint8Array): ImageKind | null {
    const head = String.fromCharCode(...bytes.subarray(0, 8))
    if (head.startsWith('\u0089PNG')) return 'png'
    if (head.startsWith('\u00ff\u00d8')) return 'jpg'
    if (head.startsWith('GIF')) return 'gif'
    if (head.startsWith('BM')) return 'bmp'
    return null
}

function readU16BE(bytes: Uint8Array, offset: number): number {
    return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
    let offset = 2
    while (offset + 8 < bytes.length) {
        if (bytes[offset] !== 0xff) return null
        let marker = bytes[offset + 1]!
        while (marker === 0xff && offset + 2 < bytes.length) {
            offset += 1
            marker = bytes[offset + 1]!
        }
        if (marker === 0xd8 || marker === 0xd9 || marker === 0xda) return null
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2
            continue
        }
        const length = readU16BE(bytes, offset + 2)
        if (length < 2 || offset + 2 + length > bytes.length) return null
        const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (isStartOfFrame) {
            const height = readU16BE(bytes, offset + 5)
            const width = readU16BE(bytes, offset + 7)
            return width > 0 && height > 0 ? { width, height } : null
        }
        offset += 2 + length
    }
    return null
}

function imageSize(kind: ImageKind, bytes: Uint8Array): { width: number; height: number } | null {
    if (kind === 'png' && bytes.length >= 24) return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) }
    if (kind === 'gif' && bytes.length >= 10) {
        const width = bytes[6]! | (bytes[7]! << 8)
        const height = bytes[8]! | (bytes[9]! << 8)
        return width > 0 && height > 0 ? { width, height } : null
    }
    if (kind === 'bmp' && bytes.length >= 26) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        const width = view.getInt32(18, true)
        const height = Math.abs(view.getInt32(22, true))
        return width > 0 && height > 0 ? { width, height } : null
    }
    if (kind === 'jpg') return jpegSize(bytes)
    return null
}

function fit(size: { width: number; height: number }, maxWidth: number, maxHeight: number): { width: number; height: number } {
    const scale = Math.min(maxWidth / Math.max(size.width, 1), maxHeight / Math.max(size.height, 1), 1)
    return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
    const trimmed = dataUrl.trim()
    if (!trimmed) return null
    // Parameters such as `;charset=utf-8` may come before `;base64` and the comma.
    const match = /^data:[^,]*?(;base64)?,([\s\S]*)$/i.exec(trimmed)
    if (!match) return null
    const payload = match[2]!
    try {
        if (match[1]) {
            const binary = atob(payload)
            const bytes = new Uint8Array(binary.length)
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
            return bytes
        }
        return new TextEncoder().encode(decodeURIComponent(payload))
    } catch {
        return null
    }
}

/** Image bytes Word can embed, and the size the PDF shows the picture at (null when the file doesn't say). */
type DecodedImage = { kind: ImageKind; bytes: Uint8Array; size: { width: number; height: number } | null }

/** A data URL as Word-ready bytes: as is for PNG/JPEG/GIF/BMP, else the PNG or JPEG {@link convertImages} made from it. */
function decodeImage(converted: Map<string, DecodedImage>, dataUrl: string): DecodedImage | null {
    const redrawn = converted.get(dataUrl.trim())
    if (redrawn) return redrawn
    const bytes = decodeDataUrl(dataUrl)
    const kind = bytes ? imageKind(bytes) : null
    return bytes && kind ? { kind, bytes, size: imageSize(kind, bytes) } : null
}

function embeddedImage(image: DecodedImage | null, maxWidth: number, maxHeight: number, name: string, description = name): ImageRun | null {
    if (!image) return null
    const size = fit(image.size ?? { width: maxWidth, height: maxHeight }, maxWidth, maxHeight)
    return new ImageRun({ type: image.kind, data: image.bytes, transformation: size, altText: { name, description } })
}

/** Longest side a redrawn image gets, well inside browser canvas limits. */
const MAX_REDRAW_SIDE = 4096

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        // `Image` alone is the mdast type here.
        const img = new globalThis.Image()
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Image could not be read.'))
        img.src = src
    })
}

/** The size an SVG shows at in an `<img>`: its width and height, else its viewBox. */
function svgSize(markup: string): { width: number; height: number } | null {
    const tag = /<svg\b[^>]*>/i.exec(markup)?.[0]
    if (!tag) return null
    const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]?.trim() ?? ''
    const length = (value: string) => (/^\d*\.?\d+(px)?$/i.test(value) ? parseFloat(value) : 0)
    const width = length(attribute('width'))
    const height = length(attribute('height'))
    if (width > 0 && height > 0) return { width, height }
    const box = attribute('viewBox')
        .split(/[\s,]+/)
        .map(Number)
    const boxWidth = box.length === 4 ? box[2]! : 0
    const boxHeight = box.length === 4 ? box[3]! : 0
    if (!(boxWidth > 0 && boxHeight > 0)) return null
    if (width > 0) return { width, height: (width * boxHeight) / boxWidth }
    if (height > 0) return { width: (height * boxWidth) / boxHeight, height }
    return { width: boxWidth, height: boxHeight }
}

const SVG_DATA_URL = /^data:image\/svg\+xml[;,]/i

/** Rows of pixels read at a time when a redrawn picture is checked for see-through parts, so a big one isn't copied whole. */
const ALPHA_BAND_ROWS = 256

/** Whether every pixel on the canvas is fully opaque. False when the pixels can't be read, so the picture stays a PNG. */
function canvasIsOpaque(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
    try {
        for (let top = 0; top < height; top += ALPHA_BAND_ROWS) {
            const { data } = ctx.getImageData(0, top, width, Math.min(ALPHA_BAND_ROWS, height - top))
            for (let index = 3; index < data.length; index += 4) if (data[index]! < 255) return false
        }
        return true
    } catch {
        return false
    }
}

/**
 * Draws an image Word can't take (SVG, WebP…) the way the PDF's `<img>` shows it. Null where that fails.
 * A picture with no see-through parts becomes a JPEG, since a photo as a lossless PNG can be many megabytes;
 * SVG art and pictures with transparency become a PNG.
 * `size` stays the image's own size; `shownWidth` is a wider size it will be stretched to, so vector art is drawn for that.
 */
async function redrawForWord(dataUrl: string, shownWidth = 0): Promise<DecodedImage | null> {
    if (typeof document === 'undefined' || typeof globalThis.Image === 'undefined') return null
    const bytes = decodeDataUrl(dataUrl)
    if (!bytes || imageKind(bytes)) return null
    try {
        const img = await loadImage(dataUrl)
        const svg = SVG_DATA_URL.test(dataUrl)
        const natural = img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null
        const size = (svg ? svgSize(new TextDecoder().decode(bytes)) : null) ?? natural
        if (!size) return null
        // Vector art is drawn at 2x the size it is shown at, so it stays sharp; pictures keep their own pixels.
        const scale = Math.min(svg ? (2 * Math.max(size.width, shownWidth)) / size.width : 1, MAX_REDRAW_SIDE / Math.max(size.width, size.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(size.width * scale))
        canvas.height = Math.max(1, Math.round(size.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const jpeg = !svg && canvasIsOpaque(ctx, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((value) => resolve(value), jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.9 : undefined)
        )
        if (!blob) return null
        const redrawn = new Uint8Array(await blob.arrayBuffer())
        // A browser that can't write JPEG hands back a PNG instead, so the bytes say which it is.
        const kind = imageKind(redrawn)
        return kind ? { kind, bytes: redrawn, size } : null
    } catch {
        return null
    }
}

/** Redraws, once each, every logo, bar and body image that Word can't embed as it is. */
async function convertImages(exportDocument: ExportDocument): Promise<Map<string, DecodedImage>> {
    const { assets, tree } = exportDocument
    const urls = new Set(
        [assets.logoDataUrl, assets.header.left, assets.header.right, assets.footer.left, assets.footer.right].map((url) => url.trim())
    )
    visit(tree, 'image', (node: Image) => {
        urls.add(node.url.trim())
    })
    const definitions = collectDefinitions(tree)
    visit(tree, 'imageReference', (node: ImageReference) => {
        const url = definitions.get(node.identifier)
        if (url !== undefined) urls.add(url.trim())
    })
    const converted = new Map<string, DecodedImage>()
    await Promise.all(
        [...urls]
            .filter((url) => url.startsWith('data:'))
            .map(async (url) => {
                const image = await redrawForWord(url)
                if (image) converted.set(url, image)
            })
    )
    return converted
}

/** The logo and bar images come from Settings and have no alt text to fall back to, so say when one is left out. */
function warnAboutDroppedImages(state: RenderState) {
    const { profile, assets } = state.document
    const layout = resolvePdfExportLayout(profile)
    const slots: [used: boolean, dataUrl: string, label: string][] = [
        [profile.frontMatter.titlePage, assets.logoDataUrl, 'cover image'],
        [layout.showHeader, assets.header.left, 'header image'],
        [layout.showHeader, assets.header.right, 'header image'],
        [layout.showFooter, assets.footer.left, 'footer image'],
        [layout.showFooter, assets.footer.right, 'footer image'],
    ]
    const dropped = [
        ...new Set(slots.filter(([used, url]) => used && url.trim() !== '' && !decodeImage(state.images, url)).map(([, , label]) => label)),
    ]
    if (dropped.length === 0) return
    const list = dropped.length === 1 ? dropped[0] : `${dropped.slice(0, -1).join(', ')} and ${dropped[dropped.length - 1]}`
    notifyWarning("Some images aren't in the Word file", { description: `Couldn't add the ${list}. Try a PNG or JPEG file instead.` })
}

function mmToPx(mm: number): number {
    return Math.round((mm * 96) / 25.4)
}

function pxToTwip(px: number): number {
    return Math.round(px * 15)
}

function twipToEmu(twip: number): number {
    return Math.round(twip * 635)
}

type Picture = { data: Uint8Array; width: number; height: number }

/** The PDF watermark is `font-size: 4rem`. It is drawn at twice that so it stays sharp. */
const WATERMARK_FONT_PX = 64 * 2
const WATERMARK_ANGLE = Math.PI / 6

/**
 * Diagonal watermark drawn like the PDF's: bold body font at 8% black, turned 30°.
 * The canvas is sized to the turned text so nothing is clipped. Width and height are display
 * pixels, never wider than `maxWidth`. Null where canvas is unavailable; the caller then writes the words into the header.
 */
async function createWatermarkPng(text: string, fontFamily: string, maxWidth: number): Promise<Picture | null> {
    const trimmed = text.trim()
    if (!trimmed) return null
    try {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        const setFont = () => {
            // An invalid stack is ignored by the canvas, so the plain sans-serif stays.
            ctx.font = `700 ${WATERMARK_FONT_PX}px sans-serif`
            ctx.font = `700 ${WATERMARK_FONT_PX}px ${fontFamily}`
        }
        setFont()
        const textWidth = ctx.measureText(trimmed).width
        const textHeight = WATERMARK_FONT_PX * 1.2
        const pad = WATERMARK_FONT_PX * 0.25
        const cos = Math.cos(WATERMARK_ANGLE)
        const sin = Math.sin(WATERMARK_ANGLE)
        const boxWidth = textWidth * cos + textHeight * sin + pad * 2
        const boxHeight = textWidth * sin + textHeight * cos + pad * 2
        const scale = Math.min(1, (maxWidth * 2) / boxWidth)
        canvas.width = Math.max(1, Math.ceil(boxWidth * scale))
        canvas.height = Math.max(1, Math.ceil(boxHeight * scale))
        // Resizing the canvas resets the context, so style it after.
        setFont()
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(-WATERMARK_ANGLE)
        ctx.scale(scale, scale)
        ctx.fillText(trimmed, 0, 0)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'))
        if (!blob) return null
        return {
            data: new Uint8Array(await blob.arrayBuffer()),
            width: Math.max(1, Math.round(canvas.width / 2)),
            height: Math.max(1, Math.round(canvas.height / 2)),
        }
    } catch {
        return null
    }
}

async function diagramPng(svg: string, themeId: AppThemeId): Promise<Uint8Array | null> {
    try {
        const blob = await svgToPngBlob(svg, themeId, 2)
        return new Uint8Array(await blob.arrayBuffer())
    } catch {
        return null
    }
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

type TextNode = { type?: string; value?: string; children?: unknown[] }

/** The words of a node. Raw HTML is already the Markdown it shows (expandHtml), so any left has no words. */
function plainText(node: TextNode): string {
    if (node.type === 'html') return ''
    if (typeof node.value === 'string') return node.value
    if (!Array.isArray(node.children)) return ''
    return node.children.map((child) => plainText(child as TextNode)).join('')
}

/**
 * Whether Word should mark a run right-to-left: it has right-to-left letters and no left-to-right ones, as Word
 * marks text typed in Hebrew or Arabic. A run with Latin words in it is left unmarked, since the mark would
 * also turn the spaces between those words right-to-left and swap their order.
 */
function runIsRtl(text: string): boolean {
    let rtl = false
    for (const [letter] of text.matchAll(/\p{L}/gu)) {
        if (!RTL_LETTER.test(letter)) return false
        rtl = true
    }
    return rtl
}

/** Paragraph direction for Word: set only for right-to-left text, so other paragraphs stay as they were. */
function bidi(text: string): true | undefined {
    return isRtl(text) || undefined
}

type RenderState = {
    document: ExportDocument
    prepared: Map<Code, PreparedCode>
    /** PNGs redrawn from images Word can't take, keyed by their data URL. */
    images: Map<string, DecodedImage>
    /** The cover logo, decoded once. Null when there is none or it can't be embedded. */
    logo: DecodedImage | null
    numbering: { reference: string; levels: ILevelsOptions[] }[]
    nextList: number
    /** The numbering each bullet list shares, by depth and indent. Bullets never restart, so one each is enough. */
    bulletLists: Map<string, string>
    footnotes: Record<number, { children: Paragraph[] }>
    definitions: Map<string, string>
    footnoteIds: Map<string, number>
    /** The Chinese, Japanese or Korean fonts the body, heading and code fonts use, once each, for the font table. */
    eastAsianFonts: EastAsianFont[]
    bodyFont: WordFont
    headingFont: WordFont
    monoFont: WordFont
    accent: string
    link: string
    bodyHalfPoints: number
    contentPx: number
    contentTwip: number
    pageWidthTwip: number
    /** Extra left indent, in twips, for blocks nested in list items and quotes. */
    extraLeft: number
    /** How many quotes the blocks being rendered sit inside. */
    quoteDepth: number
    /** Set while a footnote's text is rendered: smaller type, and no footnotes inside it. */
    inFootnote: boolean
    /** Text width, in pixels, of the table cell being rendered, so its pictures fit inside it. Null outside tables. */
    cellPx: number | null
    /** The contents entries, worded as their headings are in the body. */
    toc: PdfExportOutlineItem[]
    /** Each heading id's bookmark number, then each id an anchor from raw HTML marks. See {@link headingBookmarks}. */
    bookmarks: Map<string, number>
    /** The bookmark numbers of anchors from raw HTML not written yet, so each is written once. See {@link anchorBookmarks}. */
    unwrittenAnchors: Set<number>
    /** Bookmarks of anchors in a paragraph that shows nothing, for the start of the next one written. */
    pendingAnchors: Bookmark[]
}

/**
 * A number for each heading's bookmark, in document order. Heading ids are slugs, which can be longer than the
 * 40 characters Word allows or start with a digit (`1-introduction`). Word drops such a bookmark, and the contents
 * page number pointing at it then reads "Error! Bookmark not defined." after an update. See {@link bookmarkName}.
 */
function headingBookmarks(tree: ExportDocument['tree']): Map<string, number> {
    const numbers = new Map<string, number>()
    visit(tree, 'heading', (node: Heading) => {
        const id = headingId(node)
        if (id && !numbers.has(id)) numbers.set(id, numbers.size + 1)
    })
    return numbers
}

/**
 * Numbers each id an anchor from raw HTML marks after the headings' (see {@link HTML_ANCHORS}), so links to it work
 * as they do in the PDF. A heading with the same id keeps it. Returns the numbers given.
 */
function anchorBookmarks(tree: ExportDocument['tree'], numbers: Map<string, number>): Set<number> {
    const anchors = new Set<number>()
    visit(tree, 'html', (node: Html) => {
        const id = HTML_ANCHORS.get(node)
        if (id === undefined || numbers.has(id)) return
        numbers.set(id, numbers.size + 1)
        anchors.add(numbers.size)
    })
    return anchors
}

/** A hidden bookmark name, like the `_Ref` ones Word makes for cross-references: always valid, and kept out of Word's bookmark list. */
function bookmarkName(number: number): string {
    return `_Ref${number}`
}

/** Where a link to `#id` goes in Word: the heading's bookmark, else the id as it is. */
function anchorFor(state: RenderState, id: string): string {
    const number = state.bookmarks.get(id)
    return number === undefined ? id : bookmarkName(number)
}

/** A heading's or an anchor's bookmark. docx gives every Bookmark the number 1, and Word needs each to have its own, so it is set here. */
function headingBookmark(number: number, children: ParagraphChild[]): Bookmark {
    const name = bookmarkName(number)
    return Object.assign(new Bookmark({ id: name, children }), { start: new BookmarkStart(name, number), end: new BookmarkEnd(number) })
}

/**
 * The contents entries with each heading's words as the body shows them. The outline's text keeps raw HTML,
 * so a hidden comment or tag in a heading would be printed on the Contents page; an entry with no words left is dropped.
 */
function tocEntries(document: ExportDocument): PdfExportOutlineItem[] {
    const words = new Map<string, string>()
    visit(document.tree, 'heading', (node: Heading) => {
        const id = headingId(node)
        if (id) words.set(id, plainText(node).trim())
    })
    return document.toc.flatMap((item) => {
        const text = words.get(item.id) ?? ''
        return text ? [{ ...item, text }] : []
    })
}

function createState(document: ExportDocument, prepared: Map<Code, PreparedCode>, images: Map<string, DecodedImage>): RenderState {
    const { profile } = document
    const portrait = pdfPageSizeMm(profile)
    const landscape = profile.page.orientation === 'landscape'
    const widthMm = landscape ? portrait.height : portrait.width
    const marginLeft = convertMillimetersToTwip(profile.page.marginsMm.left)
    const marginRight = convertMillimetersToTwip(profile.page.marginsMm.right)
    const widthTwip = convertMillimetersToTwip(widthMm)
    // A CJK font the stack names wins, as in the PDF. The script's Windows font stands in only when it names none.
    const script = eastAsianFont(document)
    const [bodyEast, headingEast, monoEast] = [profile.typography.bodyFont, profile.typography.headingFont, profile.typography.monoFont].map(
        (stack) => stackEastAsianFont(stack, script) ?? script
    )
    const eastAsianFonts = [bodyEast, headingEast, monoEast].filter(
        (font, index, all): font is EastAsianFont => font !== undefined && all.findIndex((other) => other?.name === font.name) === index
    )
    const bookmarks = headingBookmarks(document.tree)
    return {
        document,
        prepared,
        images,
        logo: decodeImage(images, document.assets.logoDataUrl),
        numbering: [],
        nextList: 1,
        bulletLists: new Map(),
        footnotes: {},
        definitions: collectDefinitions(document.tree),
        footnoteIds: new Map(),
        eastAsianFonts,
        bodyFont: wordFontSlots(wordFont(profile.typography.bodyFont, 'Calibri'), bodyEast),
        headingFont: wordFontSlots(wordFont(profile.typography.headingFont, 'Calibri'), headingEast),
        monoFont: wordFontSlots(wordFont(profile.typography.monoFont, 'Consolas'), monoEast),
        accent: hexColor(profile.brand.accentColor, '262626'),
        link: hexColor(profile.brand.linkColor.trim() || profile.brand.accentColor, '262626'),
        bodyHalfPoints: Math.round(profile.typography.bodySizePt * 2),
        contentPx: mmToPx(widthMm - profile.page.marginsMm.left - profile.page.marginsMm.right),
        contentTwip: widthTwip - marginLeft - marginRight,
        pageWidthTwip: widthTwip,
        extraLeft: 0,
        quoteDepth: 0,
        inFootnote: false,
        cellPx: null,
        toc: tocEntries(document),
        bookmarks,
        unwrittenAnchors: anchorBookmarks(document.tree, bookmarks),
        pendingAnchors: [],
    }
}

/**
 * The PDF setting is a CSS line-height: a multiple of the font size.
 * Word's "multiple" line spacing is a multiple of the font's own single spacing, which is taller.
 * This is the line box in twips, `atLeast` so a taller image on the line can still grow it.
 */
function lineBoxTwip(halfPoints: number, lineHeight: number): number {
    return Math.max(1, Math.round(halfPoints * 10 * lineHeight))
}

function bodyLineSpacing(state: RenderState): { line: number; lineRule: (typeof LineRuleType)['AT_LEAST'] } {
    return { line: lineBoxTwip(state.bodyHalfPoints, state.document.profile.typography.lineHeight), lineRule: LineRuleType.AT_LEAST }
}

/** Left indent for a block nested in a list item or quote. Empty at the top level, where the page margins are enough. */
function contentIndent(state: RenderState): { left: number } | undefined {
    return state.extraLeft > 0 ? { left: state.extraLeft } : undefined
}

/** Width left for a picture once nested blocks have stepped in, or inside the table cell it sits in. */
function availablePx(state: RenderState): number {
    const width = Math.max(1, state.contentPx - Math.round(state.extraLeft / 15))
    return state.cellPx === null ? width : Math.min(width, state.cellPx)
}

/** The quote bar's width, in eighths of a point, and its gap to the text, in points. */
const QUOTE_BAR = { size: 12, space: 11 } as const
/** How far left of a quoted paragraph's text Word draws the middle of its bar, in twips: the gap, then half the bar. */
const QUOTE_BAR_INSET = QUOTE_BAR.space * 20 + (QUOTE_BAR.size * 20) / 8 / 2

/** The quote's accent bar, on every block inside a quote. Word draws it `space` points left of the text, at the quote's edge. */
function quoteBorder(state: RenderState) {
    return state.quoteDepth > 0 ? { left: { style: BorderStyle.SINGLE, ...QUOTE_BAR, color: state.accent } } : undefined
}

/** Quote text is grey and italic, as in the PDF. */
function quoteMarks(state: RenderState): Marks {
    return state.quoteDepth > 0 ? { quote: true } : {}
}

/** Runs `render` with the content `extraLeft` twips further in, as it is drawn there. */
function withExtraLeft<T>(state: RenderState, extraLeft: number, render: () => T): T {
    const saved = state.extraLeft
    state.extraLeft += extraLeft
    try {
        return render()
    } finally {
        state.extraLeft = saved
    }
}

/** Renders blocks nested one step in: under a list item's text, or inside a quote. */
async function nested<T>(state: RenderState, extraLeft: number, quote: boolean, render: () => Promise<T>): Promise<T> {
    const saved = { extraLeft: state.extraLeft, quoteDepth: state.quoteDepth }
    state.extraLeft += extraLeft
    if (quote) state.quoteDepth += 1
    try {
        return await render()
    } finally {
        state.extraLeft = saved.extraLeft
        state.quoteDepth = saved.quoteDepth
    }
}

function footnoteId(state: RenderState, identifier: string): number {
    const existing = state.footnoteIds.get(identifier)
    if (existing) return existing
    const id = state.footnoteIds.size + 1
    state.footnoteIds.set(identifier, id)
    return id
}

/** A size `em` times the body text's, in half-points, as the PDF's em sizes work. */
function emHalfPoints(state: RenderState, em: number): number {
    return Math.round(state.bodyHalfPoints * em)
}

/** A heading's size, in half-points. At the 11pt default that is 36, 30, 27, 24, 22 and 20. */
function headingHalfPoints(state: RenderState, depth: number): number {
    return emHalfPoints(state, HEADING_EM[Math.min(Math.max(depth, 1), 6) - 1]!)
}

/** Code block text, in half-points: 9pt with the 11pt default body. */
function codeHalfPoints(state: RenderState): number {
    return emHalfPoints(state, CODE_EM)
}

/** Footnote text is set a little smaller than the body, as Word does. */
function footnoteHalfPoints(state: RenderState): number {
    return Math.max(16, Math.round(state.bodyHalfPoints * 0.85))
}

function textRun(state: RenderState, text: string, marks: Marks = {}): TextRun {
    const heading = marks.headingSize
    const color = marks.link ? state.link : marks.quote ? '525252' : heading !== undefined ? state.accent : undefined
    const size = heading ?? (state.inFootnote ? footnoteHalfPoints(state) : state.bodyHalfPoints)
    return new TextRun({
        text,
        bold: marks.bold || heading !== undefined,
        italics: marks.italics || marks.quote,
        strike: marks.strike,
        font: marks.code ? state.monoFont : heading !== undefined ? state.headingFont : state.bodyFont,
        // Code is 0.85em of the text around it, as in the PDF, so it scales up in a heading.
        size: marks.code ? Math.max(16, Math.round(size * 0.85)) : size,
        color,
        shading: marks.code ? { type: ShadingType.CLEAR, fill: 'F5F5F5' } : undefined,
        underline: marks.link ? { type: UnderlineType.SINGLE, color: state.link } : undefined,
        rightToLeft: runIsRtl(text) || undefined,
    })
}

type InlineChild = TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | FootnoteReferenceRun | Bookmark

/** The bookmarks of a paragraph that showed nothing, for the start of the block written after it. None in a footnote. */
function takePendingAnchors(state: RenderState): Bookmark[] {
    return state.inFootnote ? [] : state.pendingAnchors.splice(0)
}

function renderInlines(state: RenderState, nodes: PhrasingContent[], marks: Marks = {}): InlineChild[] {
    const children: InlineChild[] = takePendingAnchors(state)
    for (const node of nodes) {
        if (node.type === 'text') {
            children.push(textRun(state, (node as Text).value, marks))
        } else if (node.type === 'emphasis') {
            children.push(...renderInlines(state, node.children, { ...marks, italics: true }))
        } else if (node.type === 'strong') {
            children.push(...renderInlines(state, node.children, { ...marks, bold: true }))
        } else if (node.type === 'delete') {
            children.push(...renderInlines(state, node.children, { ...marks, strike: true }))
        } else if (node.type === 'inlineCode') {
            children.push(textRun(state, node.value, { ...marks, code: true }))
        } else if (node.type === 'break') {
            children.push(new TextRun({ break: 1 }))
        } else if (node.type === 'link' || node.type === 'linkReference') {
            children.push(...renderLink(state, node, marks))
        } else if (node.type === 'image' || node.type === 'imageReference') {
            const url = imageUrl(state, node)
            const image = url === undefined ? null : renderImage(state, url, node.alt)
            children.push(image ?? textRun(state, imageText(state, node), marks))
        } else if (node.type === 'footnoteReference') {
            // Word has no footnotes inside footnotes.
            if (!state.inFootnote) children.push(new FootnoteReferenceRun(footnoteId(state, node.identifier)))
        } else if (node.type === 'html') {
            // All that is left of raw HTML by now (expandHtml): an anchor, as an empty bookmark where it was.
            const number = state.bookmarks.get(HTML_ANCHORS.get(node) ?? '')
            if (number !== undefined && state.unwrittenAnchors.delete(number)) children.push(headingBookmark(number, []))
        }
    }
    return children
}

/** Whether a paragraph shows nothing: only anchors from raw HTML (see {@link HTML_ANCHORS}) and spaces, or nothing at all. */
function showsNothing(nodes: PhrasingContent[]): boolean {
    return nodes.every(
        (node) =>
            node.type === 'html' ||
            (node.type === 'text' && !node.value.trim()) ||
            ((node.type === 'emphasis' || node.type === 'strong' || node.type === 'delete') && showsNothing(node.children))
    )
}

/** Link and image definitions by label. When a label is defined twice the first one counts, as in CommonMark and the PDF. */
function collectDefinitions(tree: ExportDocument['tree']): Map<string, string> {
    const urls = new Map<string, string>()
    visit(tree, 'definition', (node: Definition) => {
        if (!urls.has(node.identifier)) urls.set(node.identifier, node.url)
    })
    return urls
}

/** Word's own bookmark for the start of the document. */
const TOP_OF_DOCUMENT = '_top'

/**
 * A link: to a heading's bookmark for `#heading` (matched as {@link resolveHeadingAnchor} does), else to its web,
 * email or relative address. A link the preview would leave dead (`javascript:`, `file:`…) keeps its words as plain text.
 * A bare `#` goes to the top of the document, as in the PDF: a link with no anchor is written as a link to a
 * relationship that doesn't exist, and Word then calls the whole file unreadable.
 */
function renderLink(state: RenderState, node: Link | LinkReference, marks: Marks) {
    const url = node.type === 'link' ? node.url : state.definitions.get(node.identifier)!
    const href = url.startsWith('#') ? url : safeExportHref(url)
    if (href === null) return renderInlines(state, node.children, marks)
    const inner = renderInlines(state, node.children, { ...marks, link: true })
    if (inner.length === 0) return []
    if (href.startsWith('#')) {
        const fragment = href.slice(1)
        const anchor = (fragment && anchorFor(state, resolveHeadingAnchor(fragment, state.bookmarks))) || TOP_OF_DOCUMENT
        // docx links a picture in a link within the document to a relationship it never writes, which makes Word
        // call the file unreadable, so pictures sit outside it.
        return splitLink(
            inner,
            (child) => child instanceof ImageRun,
            (children) => new InternalHyperlink({ anchor, children })
        )
    }
    return splitLink(
        inner,
        () => false,
        (children) => new ExternalHyperlink({ link: href, children })
    )
}

/**
 * A link's words in one or more links, with what can't sit inside one just outside, between the linked words around
 * it: what `outside` picks, and always a bookmark (an anchor from raw HTML), which docx can't write inside a link.
 */
function splitLink(inner: InlineChild[], outside: (child: InlineChild) => boolean, link: (children: InlineChild[]) => InlineChild): InlineChild[] {
    const written: InlineChild[] = []
    let linked: InlineChild[] = []
    const closeLink = () => {
        if (linked.length > 0) written.push(link(linked))
        linked = []
    }
    for (const child of inner) {
        if (child instanceof Bookmark || outside(child)) {
            closeLink()
            written.push(child)
        } else {
            linked.push(child)
        }
    }
    closeLink()
    return written
}

/**
 * What a picture Word can't embed is written as: its alt text, else its address. A data: URL can be
 * megabytes of base64, so it is never written out; a short placeholder stands in for it.
 */
function imageFallbackText(alt: string | null | undefined, url: string): string {
    if (alt) return alt
    return /^\s*data:/i.test(url) ? '[image]' : url
}

/** Where a picture points: its own URL, or for `![alt][ref]` its definition's, as in the PDF. */
function imageUrl(state: RenderState, node: Image | ImageReference): string | undefined {
    return node.type === 'image' ? node.url : state.definitions.get(node.identifier)
}

/** The text written in place of a picture that isn't embedded. */
function imageText(state: RenderState, node: Image | ImageReference): string {
    const url = imageUrl(state, node)
    if (url !== undefined) return imageFallbackText(node.alt, url)
    return node.alt || (node.type === 'imageReference' ? node.identifier : '')
}

/** The tallest a body picture can be, in pixels: the page's text height, less the paragraph's 120-twip (8px) space after, so it fits on one page. */
function pageHeightPx(state: RenderState): number {
    return Math.max(1, Math.floor(pageContentTwip(state, 'body') / 15) - 8)
}

/** The box a picture whose file doesn't give its size is shown in. */
const UNSIZED_IMAGE = { width: 640, height: 480 } as const

/** A body picture's size: its own, as in the PDF, shrunk only to fit `maxWidth` (the text width where it sits) and the page. */
function bodyImageSize(state: RenderState, image: DecodedImage, maxWidth: number): { width: number; height: number } {
    return fit(image.size ?? UNSIZED_IMAGE, maxWidth, pageHeightPx(state))
}

/** A picture with no alt text keeps an empty description, like the PDF's `alt=""`, so Word's checker can flag it. */
function renderImage(state: RenderState, url: string, alt: string | null | undefined): ImageRun | null {
    const image = decodeImage(state.images, url)
    if (!image) return null
    return new ImageRun({
        type: image.kind,
        data: image.bytes,
        transformation: bodyImageSize(state, image, availablePx(state)),
        altText: { name: alt || 'Picture', description: alt ?? '' },
    })
}

function paragraphOptions(state: RenderState) {
    return {
        spacing: { after: 120, ...bodyLineSpacing(state) },
        border: quoteBorder(state),
        indent: contentIndent(state),
    }
}

/** The alignment a paragraph from raw HTML asks for, such as `<p align="center">`, as Word's. Undefined when it asks for none. */
function htmlAlignment(node: MdParagraph, rtl: boolean) {
    const align = node.data?.hProperties?.align
    if (align === 'justify') return AlignmentType.JUSTIFIED
    return align === 'left' || align === 'center' || align === 'right' ? cellAlignment(align, rtl) : undefined
}

function renderParagraph(state: RenderState, node: MdParagraph): Paragraph {
    const justify = state.document.profile.typography.justify && state.quoteDepth === 0
    const rtl = bidi(plainText(node))
    return new Paragraph({
        ...paragraphOptions(state),
        alignment: htmlAlignment(node, rtl === true) ?? (justify ? AlignmentType.JUSTIFIED : undefined),
        bidirectional: rtl,
        children: renderInlines(state, node.children, quoteMarks(state)),
    })
}

function headingId(node: Heading): string {
    const props = node.data?.hProperties as { id?: string } | undefined
    return typeof props?.id === 'string' ? props.id : ''
}

function renderHeading(state: RenderState, node: Heading, isFirstBlock: boolean): Paragraph {
    const depth = Math.min(Math.max(node.depth, 1), 6)
    const level = state.document.profile.flow.newPageFromHeading
    const bookmark = state.bookmarks.get(headingId(node))
    // A heading in a quote keeps its colour and is italic, as in the PDF.
    const size = headingHalfPoints(state, depth)
    const inlines = renderInlines(state, node.children, { headingSize: size, italics: state.quoteDepth > 0 || undefined })
    return new Paragraph({
        heading: HEADING_LEVELS[depth - 1],
        pageBreakBefore: level >= 1 && !isFirstBlock && node.depth <= level,
        keepNext: true,
        bidirectional: bidi(plainText(node)),
        spacing: {
            ...HEADING_SPACING[depth - 1],
            line: lineBoxTwip(size, state.document.profile.typography.lineHeight),
            lineRule: LineRuleType.AT_LEAST,
        },
        indent: contentIndent(state),
        border: quoteBorder(state),
        children: bookmark === undefined ? inlines : [headingBookmark(bookmark, inlines)],
    })
}

function listIndent(state: RenderState, depth: number, hang: boolean): { left: number; hanging: number } {
    return { left: state.extraLeft + LIST_STEP * (depth + 1), hanging: hang ? LIST_STEP : 0 }
}

/** The PDF's bullets: a disc at the top level, a circle one list in, and a square from there on. */
const BULLETS = ['•', '◦', '▪'] as const

/**
 * The numbering a list's items use. Each numbered list gets its own, so it starts at its own number. Bullet lists
 * at the same depth and indent share one, since bullets never restart. (docx 9.12 fills in every list's number in
 * one pass over the document, so many numbered lists stay quick to export.)
 */
function listNumbering(state: RenderState, ordered: boolean, depth: number, start: number): string {
    const bulletKey = ordered ? null : `${depth}:${state.extraLeft}`
    const shared = bulletKey === null ? undefined : state.bulletLists.get(bulletKey)
    if (shared) return shared
    const reference = `list-${state.nextList}`
    state.nextList += 1
    if (bulletKey !== null) state.bulletLists.set(bulletKey, reference)
    state.numbering.push({
        reference,
        levels: [
            {
                level: 0,
                format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
                text: ordered ? '%1.' : BULLETS[Math.min(depth, BULLETS.length - 1)],
                alignment: AlignmentType.START,
                start,
                style: { paragraph: { indent: listIndent(state, depth, true) } },
            },
        ],
    })
    return reference
}

async function renderList(state: RenderState, list: List, depth: number): Promise<Block[]> {
    const ordered = list.ordered === true
    // A list may start at 0, as the PDF's <ol start="0"> does.
    const reference = listNumbering(state, ordered, depth, ordered ? (list.start ?? 1) : 1)
    const blocks: Block[] = []
    for (const item of list.children) blocks.push(...(await renderListItem(state, item, reference, depth, ordered)))
    return blocks
}

async function renderListItem(state: RenderState, item: ListItem, reference: string, depth: number, ordered: boolean): Promise<Block[]> {
    const blocks: Block[] = []
    let markerPlaced = false
    const task = item.checked === true || item.checked === false
    // The checkbox stands in for a bullet, but a numbered task keeps its number, with the box after it.
    const bare = task && !ordered
    const prefix = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : ''
    for (const child of item.children) {
        if (child.type === 'paragraph') {
            const indent = listIndent(state, depth, !bare && !markerPlaced)
            // The item's text starts a list step in, so its pictures are fitted to the width left from there.
            const inlines = withExtraLeft(state, LIST_STEP * (depth + 1), () => renderInlines(state, child.children, quoteMarks(state)))
            if (prefix && !markerPlaced) inlines.unshift(textRun(state, prefix, quoteMarks(state)))
            blocks.push(
                new Paragraph({
                    spacing: { after: 60, ...bodyLineSpacing(state) },
                    indent,
                    border: quoteBorder(state),
                    bidirectional: bidi(plainText(child)),
                    numbering: bare || markerPlaced ? undefined : { reference, level: 0 },
                    children: inlines,
                })
            )
            markerPlaced = true
        } else if (child.type === 'list') {
            blocks.push(...(await renderList(state, child, depth + 1)))
        } else {
            // Code, tables, and quotes line up with the item's text, as in the PDF.
            blocks.push(...(await nested(state, LIST_STEP * (depth + 1), false, () => renderBlocks(state, [child]))))
        }
    }
    if (!markerPlaced) {
        blocks.unshift(
            new Paragraph({
                spacing: { after: 60, ...bodyLineSpacing(state) },
                indent: listIndent(state, depth, true),
                border: quoteBorder(state),
                bidirectional: bidi(plainText(item)),
                numbering: { reference, level: 0 },
            })
        )
    }
    return blocks
}

/** Everything inside a quote, not only its paragraphs, gets the bar, the indent, and the quote text style. */
async function renderBlockquote(state: RenderState, node: Blockquote): Promise<Block[]> {
    return nested(state, QUOTE_STEP, true, () => renderBlocks(state, node.children))
}

/** The header's column count. Like the PDF, short rows are padded to it and extra cells are dropped. */
function tableColumns(table: MdTable): number {
    return Math.max(1, table.align?.length || table.children[0]!.children.length)
}

function renderTable(state: RenderState, table: MdTable): Table {
    // In a quote, the table's left edge carries the quote bar, so it moves out to where the bar runs beside the text.
    const indent = state.quoteDepth > 0 ? state.extraLeft - QUOTE_BAR_INSET : state.extraLeft
    const width = Math.max(1, state.contentTwip - indent)
    const columns = tableColumns(table)
    const widths = columnWidths(state, table, columns, width)
    return new Table({
        width: { size: width, type: WidthType.DXA },
        columnWidths: widths,
        indent: indent !== 0 ? { size: indent, type: WidthType.DXA } : undefined,
        margins: TABLE_CELL_MARGIN,
        layout: TableLayoutType.FIXED,
        // A right-to-left header row puts the first column on the right.
        visuallyRightToLeft: bidi(plainText(table.children[0]!)),
        rows: table.children.map((row, rowIndex) => renderTableRow(state, row, widths, table.align, rowIndex === 0)),
    })
}

/** A picture Word embeds in a cell counts as this many characters when columns are sized. */
const TABLE_IMAGE_UNITS = 20
/** Column weights, in characters, are kept in this range so one long column can't squeeze the rest to nothing. */
const TABLE_WEIGHT_RANGE = { min: 4, max: 60 } as const
/** No column is made narrower than this (0.625in) unless the table is too narrow for that. */
const TABLE_MIN_COLUMN_TWIP = 900

/**
 * How wide a cell's content is, in narrow characters. Bold header text is a little wider. A picture Word can't embed
 * (a web badge, say) is written as its alt text, so it counts as that text, as {@link paragraphTwip} measures it.
 */
function cellUnits(state: RenderState, cell: MdTableCell, header: boolean): number {
    const bold = header ? 1.1 : 1
    let units = textUnits(plainText(cell), 1 / 0.45) * bold
    visit(cell, (node) => {
        if (node.type !== 'image' && node.type !== 'imageReference') return
        const url = imageUrl(state, node)
        units += url !== undefined && decodeImage(state.images, url) ? TABLE_IMAGE_UNITS : textUnits(imageText(state, node), 1 / 0.45) * bold
    })
    return units
}

/**
 * Column widths, in twips, that add up to `width`. Each column gets a share in line with its longest
 * cell, like the PDF's automatic table layout, so a short ID column leaves room for a long description.
 * Every column keeps a minimum width, and the rounding is settled on the last column.
 */
function columnWidths(state: RenderState, table: MdTable, columns: number, width: number): number[] {
    const weights = Array.from({ length: columns }, (_, index) => {
        let longest = 0
        table.children.forEach((row, rowIndex) => {
            const cell = row.children[index]
            if (cell) longest = Math.max(longest, cellUnits(state, cell, rowIndex === 0))
        })
        return Math.min(TABLE_WEIGHT_RANGE.max, Math.max(TABLE_WEIGHT_RANGE.min, longest))
    })
    const floor = Math.min(TABLE_MIN_COLUMN_TWIP, Math.floor(width / columns))
    // Columns whose share would fall under the floor are pinned to it; the rest share what is left by weight.
    const pinned = new Set<number>()
    let widths: number[] = []
    for (let pass = 0; pass <= columns; pass += 1) {
        const free = weights.reduce((sum, weight, index) => (pinned.has(index) ? sum : sum + weight), 0)
        const room = width - floor * pinned.size
        widths = weights.map((weight, index) => (pinned.has(index) ? floor : Math.floor((room * weight) / free)))
        const under = widths.findIndex((size, index) => !pinned.has(index) && size < floor)
        if (under < 0) break
        pinned.add(under)
    }
    widths[columns - 1]! += width - widths.reduce((sum, size) => sum + size, 0)
    return widths
}

/** Text width, in pixels, of a cell in a column `columnTwip` wide. Pictures in the cell are kept inside it. */
function cellTextPx(columnTwip: number): number {
    return Math.max(1, Math.floor((columnTwip - TABLE_CELL_MARGIN.left - TABLE_CELL_MARGIN.right) / 15))
}

function renderTableRow(state: RenderState, row: MdTableRow, widths: number[], align: MdTable['align'], header: boolean): TableRow {
    return new TableRow({
        tableHeader: header,
        children: widths.map((columnTwip, index) =>
            renderTableCell(state, row.children[index] ?? { type: 'tableCell', children: [] }, columnTwip, align?.[index], header, index === 0)
        ),
    })
}

/**
 * A column's alignment for Word. Word's start and end swap sides in a right-to-left cell, but `---:` means the right
 * side whatever the text, as it does in the PDF, so there right is start and left is end. With no alignment, the
 * text's own direction decides, like the PDF's `dir="auto"`.
 */
function cellAlignment(align: 'left' | 'center' | 'right' | null | undefined, rtl: boolean) {
    if (align === 'center') return AlignmentType.CENTER
    if (align === 'right') return rtl ? AlignmentType.START : AlignmentType.END
    if (align === 'left') return rtl ? AlignmentType.END : AlignmentType.START
    return AlignmentType.START
}

function renderTableCell(
    state: RenderState,
    cell: MdTableCell,
    columnTwip: number,
    align: 'left' | 'center' | 'right' | null | undefined,
    header: boolean,
    first: boolean
): TableCell {
    const saved = state.cellPx
    state.cellPx = cellTextPx(columnTwip)
    const rtl = bidi(plainText(cell))
    try {
        return new TableCell({
            width: { size: columnTwip, type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.TOP,
            margins: TABLE_CELL_MARGIN,
            shading: header ? { type: ShadingType.CLEAR, fill: 'F5F5F5' } : undefined,
            borders: {
                top: GRID_BORDER,
                bottom: GRID_BORDER,
                // In a quote, the first column's edge is the quote bar, so the bar runs on past the table.
                left: first && state.quoteDepth > 0 ? { style: BorderStyle.SINGLE, size: QUOTE_BAR.size, color: state.accent } : GRID_BORDER,
                right: GRID_BORDER,
            },
            children: [
                new Paragraph({
                    spacing: { after: 0, ...bodyLineSpacing(state) },
                    alignment: cellAlignment(align, rtl === true),
                    bidirectional: rtl,
                    // Quoted tables have grey italic text too.
                    children: renderInlines(state, cell.children, { ...quoteMarks(state), bold: header || undefined }),
                }),
            ],
        })
    } finally {
        state.cellPx = saved
    }
}

function codeFill(theme: PdfExportProfile['content']['codeTheme']): string {
    return theme === 'github-dark' ? '0D1117' : 'F6F8FA'
}

function codeColor(theme: PdfExportProfile['content']['codeTheme']): string {
    return theme === 'github-dark' ? 'E6EDF3' : '24292F'
}

function renderCodeLines(state: RenderState, lines: HighlightedToken[][]): Paragraph[] {
    const theme = state.document.profile.content.codeTheme
    const fill = codeFill(theme)
    const fallback = codeColor(theme)
    const size = codeHalfPoints(state)
    const anchors = takePendingAnchors(state)
    return lines.map((line, index) => {
        const runs = line.flatMap((token) =>
            token.text
                ? [new TextRun({ text: token.text, font: state.monoFont, size, color: hexColor(token.color ?? fallback, fallback, fill) })]
                : []
        )
        return new Paragraph({
            shading: { type: ShadingType.CLEAR, fill },
            indent: contentIndent(state),
            border: quoteBorder(state),
            spacing: { before: index === 0 ? 80 : 0, after: index === lines.length - 1 ? 80 : 0, line: 276, lineRule: LineRuleType.AUTO },
            children: [...(index === 0 ? anchors : []), ...(runs.length > 0 ? runs : [new TextRun({ text: ' ', font: state.monoFont, size })])],
        })
    })
}

/**
 * A diagram's size on the page: the SVG's own size, as in the PDF, shrunk only to fit `maxWidth` (the text width
 * where it is drawn) and the page height. Null when there is no usable picture, so the source is shown instead.
 */
function diagramDisplaySize(
    state: RenderState,
    prepared: Extract<PreparedCode, { kind: 'diagram' }>,
    maxWidth = availablePx(state)
): { width: number; height: number } | null {
    const pixels = prepared.png ? imageSize('png', prepared.png) : null
    if (!pixels) return null
    // Without an SVG size, half the 2x picture is the same thing.
    const natural = prepared.size ?? { width: pixels.width / 2, height: pixels.height / 2 }
    return fit(natural, maxWidth, pageHeightPx(state))
}

function renderPrepared(state: RenderState, prepared: PreparedCode): Block[] {
    if (prepared.kind === 'error') {
        return [
            new Paragraph({ ...paragraphOptions(state), children: [...takePendingAnchors(state), textRun(state, prepared.message, { code: true })] }),
        ]
    }
    if (prepared.kind === 'diagram') {
        const size = diagramDisplaySize(state, prepared)
        if (!prepared.png || !size)
            return renderCodeLines(
                state,
                prepared.source.split('\n').map((text) => [{ text }])
            )
        return [
            new Paragraph({
                ...paragraphOptions(state),
                children: [
                    ...takePendingAnchors(state),
                    new ImageRun({
                        type: 'png',
                        data: prepared.png,
                        transformation: size,
                        altText: prepared.alt,
                    }),
                ],
            }),
        ]
    }
    return renderCodeLines(state, prepared.lines.length > 0 ? prepared.lines : [[{ text: '' }]])
}

async function renderBlocks(state: RenderState, nodes: RootContent[], parentIsRoot = false): Promise<Block[]> {
    const blocks: Block[] = []
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        // "First" means nothing has been written yet. Link definitions, footnotes, HTML comments and anchors before it write nothing.
        if (node.type === 'heading') blocks.push(renderHeading(state, node, parentIsRoot && blocks.length === 0))
        else if (node.type === 'paragraph' && showsNothing(node.children) && !state.inFootnote) {
            // A paragraph that is only an anchor, like `<a name="setup"></a>` above a heading, isn't a blank line, as in
            // the PDF. Its bookmarks go to the start of the next block written.
            state.pendingAnchors = renderInlines(state, node.children).filter((child) => child instanceof Bookmark)
        } else if (node.type === 'paragraph') blocks.push(renderParagraph(state, node))
        else if (node.type === 'list') blocks.push(...(await renderList(state, node, 0)))
        else if (node.type === 'blockquote') blocks.push(...(await renderBlockquote(state, node)))
        else if (node.type === 'code') blocks.push(...renderPrepared(state, state.prepared.get(node)!))
        else if (node.type === 'table') blocks.push(...(state.inFootnote ? tableAsText(state, node) : [renderTable(state, node)]))
        else if (node.type === 'thematicBreak') {
            blocks.push(
                new Paragraph({
                    border: { bottom: GRID_BORDER, ...quoteBorder(state) },
                    indent: contentIndent(state),
                    spacing: { before: 200, after: 200 },
                    children: takePendingAnchors(state),
                })
            )
        } else if (node.type === 'footnoteDefinition') {
            const id = footnoteId(state, node.identifier)
            state.footnotes[id] = { children: await renderFootnote(state, node) }
        }
        // Raw HTML is paragraphs by now (expandHtml). Link definitions have nothing to show.
    }
    return blocks
}

function footnoteParagraph(children: ReturnType<typeof renderInlines>, text: string): Paragraph {
    return new Paragraph({ style: 'FootnoteText', spacing: { after: 60 }, bidirectional: bidi(text), children })
}

/** Word footnotes hold only paragraphs, so a table in one is written a row per line, its cells split by bars. */
function tableAsText(state: RenderState, table: MdTable): Paragraph[] {
    const columns = tableColumns(table)
    return table.children.map((row) => {
        const text =
            row.children
                .slice(0, columns)
                .map((cell) => plainText(cell).trim())
                .join(' | ') || ' '
        return footnoteParagraph([textRun(state, text)], text)
    })
}

/**
 * A footnote's text with its links, formatting, pictures and paragraphs, in the smaller footnote size.
 * It sits at the foot of the page, so the indent and quote bar of whatever it was written in don't carry over.
 */
async function renderFootnote(state: RenderState, node: FootnoteDefinition): Promise<Paragraph[]> {
    const saved = { extraLeft: state.extraLeft, quoteDepth: state.quoteDepth, inFootnote: state.inFootnote }
    Object.assign(state, { extraLeft: 0, quoteDepth: 0, inFootnote: true })
    try {
        const paragraphs: Paragraph[] = []
        for (const child of node.children) {
            if (child.type === 'paragraph') paragraphs.push(footnoteParagraph(renderInlines(state, child.children), plainText(child)))
            else for (const block of await renderBlocks(state, [child])) if (block instanceof Paragraph) paragraphs.push(block)
        }
        return paragraphs.length > 0 ? paragraphs : [footnoteParagraph([textRun(state, ' ')], '')]
    } finally {
        Object.assign(state, saved)
    }
}

function edgeDistance(bleeds: boolean, marginMm: number): number {
    if (bleeds) return 0
    return convertMillimetersToTwip(Math.min(8, marginMm))
}

/** The PDF bar's default text colour. */
const CHROME_TEXT_COLOR = '404040'

/** The PDF bar's `font-size: 0.85em`. */
function chromeHalfPoints(state: RenderState): number {
    return Math.round(state.bodyHalfPoints * 0.85)
}

function pageNumberRuns(state: RenderState, color: string): TextRun[] {
    const { profile, metadata } = state.document
    const format = profile.footer.pageNumbers
    const run = (text?: string, field?: (typeof PageNumber)[keyof typeof PageNumber]) =>
        new TextRun({ text, children: field ? [field] : undefined, font: state.bodyFont, size: chromeHalfPoints(state), color })
    if (format === 'none') return []
    if (format === 'page-n') return [run('Page '), run(undefined, PageNumber.CURRENT)]
    if (format === 'n-of-total') return [run(undefined, PageNumber.CURRENT), run(' / '), run(undefined, PageNumber.TOTAL_PAGES)]
    if (format === 'custom') {
        const template = pdfPageNumberTemplate(profile, metadata)
        if (!template) {
            const text = resolvePdfChromeText(profile.footer.right.text, metadata)
            return text ? [run(text)] : []
        }
        return template.split(/(\{\{\s*page\s*\}\}|\{\{\s*total\s*\}\})/g).flatMap((part) => {
            if (/\{\{\s*page\s*\}\}/.test(part)) return [run(undefined, PageNumber.CURRENT)]
            if (/\{\{\s*total\s*\}\}/.test(part)) return [run(undefined, PageNumber.TOTAL_PAGES)]
            return part ? [run(part)] : []
        })
    }
    return [run(undefined, PageNumber.CURRENT)]
}

function chromeParagraph(
    state: RenderState,
    kind: 'header' | 'footer',
    align: (typeof AlignmentType)[keyof typeof AlignmentType],
    children: (TextRun | ImageRun)[]
) {
    const { profile } = state.document
    const bleeds = kind === 'header' ? resolvePdfExportLayout(profile).headerBleeds : resolvePdfExportLayout(profile).footerBleeds
    // A bar that runs to the paper edge pads its text out to the page margins, so it lines up with the body.
    const margins = profile.page.marginsMm
    const pad = bleeds
        ? {
              left: align === AlignmentType.RIGHT ? 0 : convertMillimetersToTwip(margins.left),
              right: align === AlignmentType.RIGHT ? convertMillimetersToTwip(margins.right) : 0,
          }
        : { left: 0, right: 0 }
    return new Paragraph({
        alignment: align,
        indent: pad.left > 0 || pad.right > 0 ? pad : undefined,
        spacing: { before: 0, after: 0, line: 240, lineRule: LineRuleType.AUTO },
        children: children.length > 0 ? children : [new TextRun('')],
    })
}

/** Gap between a bleeding bar and the body. Header gap sits under the bar; footer gap sits above it so the bar stays on the paper edge. */
function chromeGap(mm: number): Paragraph {
    return new Paragraph({ spacing: { before: 0, after: 0, line: Math.max(20, convertMillimetersToTwip(mm)), lineRule: LineRuleType.EXACT } })
}

/**
 * The header or footer bar. The page keeps its real side margins, so a bar that ignores them is
 * pulled out to the paper edge with a negative indent. `zeroSides` is a page with no side margins at all (the edge-to-edge cover).
 */
function chromeTable(state: RenderState, kind: 'header' | 'footer', zeroSides: boolean): (Paragraph | Table)[] {
    const { profile, metadata, assets } = state.document
    const layout = resolvePdfExportLayout(profile)
    const chrome = kind === 'header' ? profile.header : profile.footer
    const bleeds = kind === 'header' ? layout.headerBleeds : layout.footerBleeds
    const marginLeft = convertMillimetersToTwip(profile.page.marginsMm.left)
    const indent = bleeds ? (zeroSides ? 0 : -marginLeft) : zeroSides ? marginLeft : 0
    const images = kind === 'header' ? assets.header : assets.footer
    const fill = chrome.backgroundColor.trim() ? hexColor(chrome.backgroundColor, 'FFFFFF') : undefined
    const color = hexColor(chrome.textColor, CHROME_TEXT_COLOR, fill)
    const maxHeight = chrome.heightMm > 0 ? mmToPx(chrome.heightMm) : 28
    const leftImage = embeddedImage(decodeImage(state.images, images.left), 160, maxHeight, `${kind} left`)
    const rightImage = embeddedImage(decodeImage(state.images, images.right), 160, maxHeight, `${kind} right`)
    const leftText = resolvePdfChromeText(chrome.left.text, metadata)
    const rightRuns = kind === 'footer' ? pageNumberRuns(state, color) : textRuns(state, resolvePdfChromeText(chrome.right.text, metadata), color)
    const leftChildren = [...(leftImage ? [leftImage] : []), ...textRuns(state, leftText, color)]
    const rightChildren = [...rightRuns, ...(rightImage ? [rightImage] : [])]
    const width = bleeds ? state.pageWidthTwip : state.contentTwip
    const leftWidth = Math.max(1, Math.round(width / 2))
    const rightWidth = Math.max(1, width - leftWidth)
    const shading = fill ? { type: ShadingType.CLEAR, fill } : undefined
    const cell = (cellWidth: number, children: (TextRun | ImageRun)[], align: (typeof AlignmentType)[keyof typeof AlignmentType]) =>
        new TableCell({
            width: { size: cellWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlignTable.CENTER,
            margins: { marginUnitType: WidthType.DXA, top: 0, bottom: 0, left: 0, right: 0 },
            borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
            shading,
            children: [chromeParagraph(state, kind, align, children)],
        })
    const table = new Table({
        width: { size: width, type: WidthType.DXA },
        columnWidths: [leftWidth, rightWidth],
        indent: indent !== 0 ? { size: indent, type: WidthType.DXA } : undefined,
        layout: TableLayoutType.FIXED,
        margins: { marginUnitType: WidthType.DXA, top: 0, bottom: 0, left: 0, right: 0 },
        borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
        rows: [
            new TableRow({
                height: chrome.heightMm > 0 ? { value: convertMillimetersToTwip(chrome.heightMm), rule: HeightRule.ATLEAST } : undefined,
                children: [cell(leftWidth, leftChildren, AlignmentType.LEFT), cell(rightWidth, rightChildren, AlignmentType.RIGHT)],
            }),
        ],
    })
    const gap = chrome.gapMm > 0 ? [chromeGap(chrome.gapMm)] : []
    return kind === 'footer' ? [...gap, table] : [table, ...gap]
}

function textRuns(state: RenderState, text: string, color: string): TextRun[] {
    return text ? [new TextRun({ text, font: state.bodyFont, size: chromeHalfPoints(state), color })] : []
}

function watermarkBlocks(state: RenderState, picture: Picture | null): Paragraph[] {
    const text = state.document.profile.content.watermark.trim()
    if (!text) return []
    if (!picture) {
        return [
            new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 0, after: 0 },
                children: [new TextRun({ text, bold: true, size: 72, color: 'D9D9D9', font: state.headingFont })],
            }),
        ]
    }
    return [
        new Paragraph({
            spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
            children: [
                new ImageRun({
                    type: 'png',
                    data: picture.data,
                    transformation: { width: picture.width, height: picture.height },
                    floating: {
                        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.CENTER },
                        verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.CENTER },
                        behindDocument: true,
                        wrap: { type: TextWrappingType.NONE },
                    },
                    altText: { name: 'Watermark', description: text },
                }),
            ],
        }),
    ]
}

function headerShowsOnTitle(profile: PdfExportProfile): boolean {
    const layout = resolvePdfExportLayout(profile)
    return layout.showHeader && profile.header.hideOnFirstPages === 'none'
}

/** A cover image that should run to the paper edge. The PDF keys this off the logo path; here the image that actually gets drawn decides. */
function logoHasBleed(state: RenderState): boolean {
    const { profile } = state.document
    return profile.frontMatter.titlePage && profile.brand.logoIgnoreMargins && state.logo !== null
}

/**
 * The cover can be its own zero-margin page when its header/footer differ from
 * the next page. An inline page-width image then reaches the paper edge; a
 * floating image would sit in the margin, which Word on the web clips.
 */
function coverIsInline(state: RenderState): boolean {
    const { profile } = state.document
    if (!logoHasBleed(state) || headerShowsOnTitle(profile)) return false
    const next: 'toc' | 'body' = state.toc.length > 0 ? 'toc' : 'body'
    return (
        pdfChromeShown(profile, 'header', 'title') !== pdfChromeShown(profile, 'header', next) ||
        pdfChromeShown(profile, 'footer', 'title') !== pdfChromeShown(profile, 'footer', next)
    )
}

/** Where the cover image starts, measured from the top of the paper. */
function coverTopTwip(state: RenderState): number {
    const { profile } = state.document
    if (!headerShowsOnTitle(profile)) return 0
    const layout = resolvePdfExportLayout(profile)
    const margin = profile.page.marginsMm.top
    const band = layout.headerBleeds ? Math.max(margin, profile.header.heightMm + profile.header.gapMm) : margin
    return convertMillimetersToTwip(band)
}

function titleSectionTopTwip(state: RenderState): number {
    const { profile } = state.document
    const layout = resolvePdfExportLayout(profile)
    const margin = profile.page.marginsMm.top
    if (headerShowsOnTitle(profile) && layout.headerBleeds)
        return convertMillimetersToTwip(Math.max(margin, profile.header.heightMm + profile.header.gapMm))
    return convertMillimetersToTwip(margin)
}

/** Draw the cover image into the page-width box, cropping like `object-fit: cover`. Null where canvas is unavailable. */
async function cropCover(
    bytes: Uint8Array,
    kind: ImageKind,
    box: { width: number; height: number },
    intrinsic: { width: number; height: number }
): Promise<Uint8Array | null> {
    if (typeof document === 'undefined') return null
    try {
        const canvas = document.createElement('canvas')
        canvas.width = box.width
        canvas.height = box.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        const mime = kind === 'jpg' ? 'image/jpeg' : `image/${kind}`
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: mime }))
        const scale = Math.max(box.width / intrinsic.width, box.height / intrinsic.height)
        const drawnWidth = intrinsic.width * scale
        const drawnHeight = intrinsic.height * scale
        ctx.drawImage(bitmap, (box.width - drawnWidth) / 2, (box.height - drawnHeight) / 2, drawnWidth, drawnHeight)
        bitmap.close()
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'))
        if (!blob) return null
        return new Uint8Array(await blob.arrayBuffer())
    } catch {
        return null
    }
}

async function coverLogo(state: RenderState): Promise<{ run: ImageRun; heightPx: number } | null> {
    const { profile, assets } = state.document
    if (!state.logo) return null
    const bleed = profile.brand.logoIgnoreMargins
    const inline = coverIsInline(state)
    // Stay a hair inside the sheet. Rounding millimetres up to pixels makes the image wider than the page, and Word then wraps it.
    const maxWidth = bleed ? Math.max(1, Math.floor(state.pageWidthTwip / 15)) : state.contentPx
    // A logo that ignores margins is stretched to the page width, so an SVG one is drawn again for that width, not its own small size.
    const logoUrl = assets.logoDataUrl.trim()
    const stretched = bleed && SVG_DATA_URL.test(logoUrl) ? await redrawForWord(logoUrl, maxWidth) : null
    const { bytes, kind, size: intrinsic } = stretched ?? state.logo
    const maxHeight = mmToPx(LOGO_MAX_HEIGHT_MM)
    let width = maxWidth
    let height = maxHeight
    let data = bytes
    let type: ImageKind = kind
    if (intrinsic && !bleed) {
        const scale = Math.min(maxWidth / intrinsic.width, maxHeight / intrinsic.height, 1)
        width = Math.max(1, Math.round(intrinsic.width * scale))
        height = Math.max(1, Math.round(intrinsic.height * scale))
    } else if (intrinsic && bleed) {
        const scaledHeight = Math.round(intrinsic.height * (maxWidth / intrinsic.width))
        width = maxWidth
        height = Math.max(1, Math.min(scaledHeight, maxHeight))
        if (scaledHeight > maxHeight) {
            const cropped = await cropCover(bytes, kind, { width, height }, intrinsic)
            if (cropped) {
                data = cropped
                type = 'png'
            }
        }
    }
    const top = bleed && !inline ? coverTopTwip(state) : 0
    return {
        heightPx: height,
        run: new ImageRun({
            type,
            data,
            transformation: { width: Math.max(1, width), height: Math.max(1, height) },
            floating:
                bleed && !inline
                    ? {
                          horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, align: HorizontalPositionAlign.LEFT },
                          verticalPosition:
                              top === 0
                                  ? { relative: VerticalPositionRelativeFrom.PAGE, align: VerticalPositionAlign.TOP }
                                  : { relative: VerticalPositionRelativeFrom.PAGE, offset: twipToEmu(top) },
                          allowOverlap: true,
                          lockAnchor: true,
                          behindDocument: false,
                          wrap: { type: TextWrappingType.NONE },
                          zIndex: 1,
                      }
                    : undefined,
            altText: { name: 'Cover image', description: 'Cover image' },
        }),
    }
}

/** The edge-to-edge cover page has no margins of its own, so its text is indented by them instead. */
function titleIndent(state: RenderState, edge: boolean): { left: number; right: number } | undefined {
    if (!edge) return undefined
    const { left, right } = state.document.profile.page.marginsMm
    return { left: convertMillimetersToTwip(left), right: convertMillimetersToTwip(right) }
}

async function titleBlocks(state: RenderState): Promise<Block[]> {
    const { metadata, profile } = state.document
    const blocks: Block[] = []
    const logo = await coverLogo(state)
    const edge = coverIsInline(state) && logo !== null
    const floating = profile.brand.logoIgnoreMargins && logo !== null && !edge
    if (logo) {
        blocks.push(
            new Paragraph({
                spacing: floating ? { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT } : { before: 0, after: 0 },
                children: [logo.run],
            })
        )
    }
    const before =
        floating && logo
            ? Math.max(0, coverTopTwip(state) + pxToTwip(logo.heightPx) + convertMillimetersToTwip(10) - titleSectionTopTwip(state) - 20)
            : logo
              ? convertMillimetersToTwip(10)
              : 0
    const indent = titleIndent(state, edge)
    const titleSize = emHalfPoints(state, TITLE_EM)
    blocks.push(
        new Paragraph({
            indent,
            spacing: { before, after: 200, line: lineBoxTwip(titleSize, profile.typography.lineHeight), lineRule: LineRuleType.AT_LEAST },
            bidirectional: bidi(metadata.title),
            children: [
                new TextRun({
                    text: metadata.title,
                    bold: true,
                    font: state.headingFont,
                    size: titleSize,
                    color: state.accent,
                    rightToLeft: runIsRtl(metadata.title) || undefined,
                }),
            ],
        })
    )
    for (const line of [metadata.subtitle, metadata.author, metadata.date]) {
        if (!line) continue
        blocks.push(
            new Paragraph({
                indent,
                spacing: { after: 80 },
                bidirectional: bidi(line),
                children: [
                    new TextRun({
                        text: line,
                        font: state.bodyFont,
                        size: state.bodyHalfPoints,
                        color: '525252',
                        rightToLeft: runIsRtl(line) || undefined,
                    }),
                ],
            })
        )
    }
    return blocks
}

function tocEntrySpacing(level: number, first: boolean): { before: number; after: number; line: number; lineRule: (typeof LineRuleType)['AUTO'] } {
    return { before: level <= 1 ? (first ? 60 : 160) : 20, after: 0, line: 260, lineRule: LineRuleType.AUTO }
}

function pageContentTwip(state: RenderState, group: 'toc' | 'body'): number {
    const { profile } = state.document
    const portrait = pdfPageSizeMm(profile)
    const landscape = profile.page.orientation === 'landscape'
    const page = convertMillimetersToTwip(landscape ? portrait.width : portrait.height)
    const layout = resolvePdfExportLayout(profile)
    const margins = profile.page.marginsMm
    const showHeader = pdfChromeShown(profile, 'header', group)
    const showFooter = pdfChromeShown(profile, 'footer', group)
    const topMm = layout.headerBleeds && showHeader ? Math.max(margins.top, profile.header.heightMm + profile.header.gapMm) : margins.top
    const bottomMm = layout.footerBleeds && showFooter ? Math.max(margins.bottom, profile.footer.heightMm + profile.footer.gapMm) : margins.bottom
    return Math.max(1, page - convertMillimetersToTwip(topMm) - convertMillimetersToTwip(bottomMm))
}

function placeBlock(cursor: { page: number; used: number }, pageHeight: number, block: number, breakBefore = false) {
    if (breakBefore && cursor.used > 0) {
        cursor.page += 1
        cursor.used = 0
    }
    if (block >= pageHeight) {
        if (cursor.used > 0) {
            cursor.page += 1
            cursor.used = 0
        }
        cursor.page += Math.floor(block / pageHeight)
        cursor.used = block % pageHeight
        return
    }
    if (cursor.used > 0 && cursor.used + block > pageHeight) {
        cursor.page += 1
        cursor.used = 0
    }
    cursor.used += block
}

/** Characters a full em wide: Chinese, Japanese and Korean script, full-width forms, and emoji. */
const WIDE_CHAR = /[ᄀ-ᅟ⺀-〿぀-ヿ㄀-ㇿ㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u

/** Length of `text` in narrow-character widths, counted by code point so a surrogate pair is one character. A wide one counts `wide`. */
function textUnits(text: string, wide: number): number {
    let units = 0
    for (const char of text.replace(/\s+/g, ' ').trim()) units += WIDE_CHAR.test(char) ? wide : 1
    return units
}

/** How many lines `text` wraps to in `width` twips. Most characters are about 0.45 em wide; wide ones a full em. */
function lineCount(text: string, halfPoints: number, width: number): number {
    const charTwip = Math.max(60, Math.round(halfPoints * 4.5))
    const perLine = Math.max(8, Math.floor(Math.max(width, charTwip) / charTwip))
    return Math.max(1, Math.ceil(textUnits(text, (halfPoints * 10) / charTwip) / perLine))
}

function textBlockTwip(state: RenderState, text: string, halfPoints: number, width: number, before: number, after: number): number {
    const line = lineBoxTwip(halfPoints, state.document.profile.typography.lineHeight)
    return before + lineCount(text, halfPoints, width) * line + after
}

/**
 * Width, in pixels, a picture or diagram gets in a text column `width` twips wide, as the renderer works it out from
 * the nesting. Never wider than the page's text width, so rounding can't make it bigger than the drawing.
 */
function measuredPx(state: RenderState, width: number): number {
    return Math.max(1, Math.min(state.contentPx, Math.floor(width / 15)))
}

/** Height of a body picture, sized the way {@link renderImage} draws it. */
function imageTwip(state: RenderState, image: DecodedImage, width: number): number {
    return pxToTwip(bodyImageSize(state, image, measuredPx(state, width)).height)
}

function paragraphTwip(state: RenderState, node: MdParagraph, width: number): number {
    let image = 0
    const parts: string[] = []
    const walk = (nodes: PhrasingContent[]) => {
        for (const child of nodes) {
            if (child.type === 'image' || child.type === 'imageReference') {
                // A picture Word can't embed is written as its alt text, so it takes a line, not a picture's height.
                const url = imageUrl(state, child)
                const decoded = url === undefined ? null : decodeImage(state.images, url)
                if (decoded) image = Math.max(image, imageTwip(state, decoded, width))
                else parts.push(imageText(state, child))
            } else if (child.type === 'text' || child.type === 'inlineCode') parts.push(child.value)
            else if ('children' in child) walk(child.children)
        }
    }
    walk(node.children)
    const text = parts.join('')
    const textHeight = text.trim() ? textBlockTwip(state, text, state.bodyHalfPoints, width, 0, 120) : 120
    return image > 0 ? Math.max(textHeight, image + 120) : textHeight
}

/** Height of a code block or diagram in a text column `width` twips wide: a diagram in a list or quote is drawn narrower, so shorter. */
function codeTwip(state: RenderState, node: Code, width: number): number {
    const prepared = state.prepared.get(node)
    const diagram = prepared?.kind === 'diagram' ? diagramDisplaySize(state, prepared, measuredPx(state, width)) : null
    if (diagram) return pxToTwip(diagram.height) + 120
    if (prepared?.kind === 'error') return textBlockTwip(state, prepared.message, state.bodyHalfPoints, width, 0, 120)
    const lines = prepared?.kind === 'code' ? Math.max(1, prepared.lines.length) : Math.max(1, node.value.replace(/\n$/, '').split('\n').length)
    // A code line is about 276 twips with the default 9pt code, and grows with it.
    return 160 + lines * Math.round((276 * codeHalfPoints(state)) / 18)
}

function measureFlow(
    state: RenderState,
    nodes: RootContent[],
    width: number,
    pages: Map<string, number>,
    cursor: { page: number; used: number },
    pageHeight: number,
    parentIsRoot: boolean
) {
    for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!
        if (node.type === 'heading') {
            const depth = Math.min(Math.max(node.depth, 1), 6)
            const spacing = HEADING_SPACING[depth - 1]!
            const breakBefore =
                state.document.profile.flow.newPageFromHeading >= 1 &&
                !(parentIsRoot && index === 0) &&
                node.depth <= state.document.profile.flow.newPageFromHeading
            placeBlock(
                cursor,
                pageHeight,
                textBlockTwip(state, plainText(node), headingHalfPoints(state, depth), width, spacing.before, spacing.after),
                breakBefore
            )
            const id = headingId(node)
            if (id) pages.set(id, cursor.page)
        } else if (node.type === 'paragraph') {
            if (!showsNothing(node.children)) placeBlock(cursor, pageHeight, paragraphTwip(state, node, width))
        } else if (node.type === 'list') {
            measureList(state, node, 0, width, pages, cursor, pageHeight)
        } else if (node.type === 'blockquote') {
            measureFlow(state, node.children, Math.max(200, width - QUOTE_STEP), pages, cursor, pageHeight, false)
        } else if (node.type === 'code') {
            placeBlock(cursor, pageHeight, codeTwip(state, node, width))
        } else if (node.type === 'table') {
            // Each cell wraps in its own column's width, as renderTable sizes them; its margins add 120 above.
            const widths = columnWidths(state, node, tableColumns(node), width)
            let table = 200
            for (const row of node.children) {
                let rowHeight = 240
                row.children.slice(0, widths.length).forEach((cell, index) => {
                    const text = Math.max(200, widths[index]! - TABLE_CELL_MARGIN.left - TABLE_CELL_MARGIN.right)
                    rowHeight = Math.max(rowHeight, 120 + paragraphTwip(state, { type: 'paragraph', children: cell.children }, text))
                })
                table += rowHeight
            }
            placeBlock(cursor, pageHeight, table)
        } else if (node.type === 'thematicBreak') {
            placeBlock(cursor, pageHeight, 400)
        }
    }
}

function measureList(
    state: RenderState,
    list: List,
    depth: number,
    width: number,
    pages: Map<string, number>,
    cursor: { page: number; used: number },
    pageHeight: number
) {
    const itemWidth = Math.max(200, width - LIST_STEP * (depth + 1))
    for (const item of list.children) {
        let marked = false
        for (const child of item.children) {
            if (child.type === 'paragraph') {
                placeBlock(cursor, pageHeight, paragraphTwip(state, child, itemWidth))
                marked = true
            } else if (child.type === 'list') {
                measureList(state, child, depth + 1, width, pages, cursor, pageHeight)
            } else {
                measureFlow(state, [child], itemWidth, pages, cursor, pageHeight, false)
            }
        }
        if (!marked) placeBlock(cursor, pageHeight, textBlockTwip(state, ' ', state.bodyHalfPoints, itemWidth, 0, 60))
    }
}

/** The "Contents" title's size, in half-points: 20pt with the 11pt default body. */
function contentsTitleHalfPoints(state: RenderState): number {
    return emHalfPoints(state, CONTENTS_TITLE_EM)
}

/** Height of the "Contents" title: its line (about 1.3x its size), its 200-twip space after, and the rule under it. 840 at 20pt. */
function tocTitleTwip(state: RenderState): number {
    return Math.round(contentsTitleHalfPoints(state) * 13) + 320
}

/**
 * Height of one contents row. Its line spacing is "auto 260": 260/240 of the font's own single line,
 * which is about 1.3x the font size. A long heading wraps, leaving room on the right for the leader and number.
 */
function tocRowTwip(state: RenderState, item: { level: number; text: string }, first: boolean): number {
    const level = Math.min(Math.max(item.level, 1), 6)
    const halfPoints = tocHalfPoints(state, level)
    const line = Math.round((halfPoints * 10 * 1.3 * 260) / 240)
    const width = Math.max(1, state.contentTwip - (level - 1) * 240 - 720)
    return tocEntrySpacing(level, first).before + lineCount(item.text, halfPoints, width) * line
}

/**
 * Page each contents entry lands on, from a rough layout of the document. It is the stored result of each
 * entry's PAGEREF field, because Word on the web never updates fields.
 */
function headingPages(state: RenderState): Map<string, number> {
    const { profile, tree } = state.document
    let page = (profile.frontMatter.titlePage ? 1 : 0) + 1
    const tocHeight = pageContentTwip(state, 'toc')
    let used = tocTitleTwip(state)
    let first = true
    for (const item of state.toc) {
        const height = tocRowTwip(state, item, first)
        first = false
        if (used + height > tocHeight) {
            page += 1
            used = height
        } else {
            used += height
        }
    }
    const cursor = { page: page + 1, used: 0 }
    const pages = new Map<string, number>()
    measureFlow(state, tree.children, state.contentTwip, pages, cursor, pageContentTwip(state, 'body'), true)
    return pages
}

function tocHalfPoints(state: RenderState, level: number): number {
    return level >= 4 ? Math.round(state.bodyHalfPoints * 0.9) : level === 3 ? Math.round(state.bodyHalfPoints * 0.94) : state.bodyHalfPoints
}

function tocRunStyle(state: RenderState, level: number, pageNumber: boolean) {
    const color = pageNumber ? '404040' : level <= 1 ? '171717' : level >= 4 ? '525252' : level === 3 ? '404040' : '262626'
    return { bold: level <= 1 && !pageNumber, font: state.bodyFont, size: tocHalfPoints(state, level), color }
}

function tocRun(state: RenderState, text: string, level: number): TextRun {
    return new TextRun({ text, ...tocRunStyle(state, level, false) })
}

function fieldChar(type: 'begin' | 'separate' | 'end') {
    return new BuilderElement<{ type: string }>({ name: 'w:fldChar', attributes: { type: { key: 'w:fldCharType', value: type } } })
}

/**
 * The entry's page number as a PAGEREF field to the heading's bookmark. The estimate is the field's stored
 * result, so Word on the web shows it, and desktop Word puts in the real page when fields are updated (F9).
 */
function tocPageRun(state: RenderState, bookmark: string, page: number, level: number): TextRun {
    return new TextRun({
        children: [
            fieldChar('begin'),
            new StringContainer('w:instrText', `PAGEREF ${bookmark} \\h`),
            fieldChar('separate'),
            String(page),
            fieldChar('end'),
        ],
        ...tocRunStyle(state, level, true),
    })
}

function tocBlocks(state: RenderState): Paragraph[] {
    const pages = headingPages(state)
    const tab = state.contentTwip
    let first = true
    const entries = state.toc.map((item) => {
        const level = Math.min(Math.max(item.level, 1), 6)
        const spacing = tocEntrySpacing(level, first)
        first = false
        const left = (level - 1) * 240
        const bookmark = anchorFor(state, item.id)
        return new Paragraph({
            spacing,
            indent: { left },
            tabStops: [{ type: TabStopType.RIGHT, position: Math.max(left + 240, tab), leader: LeaderType.DOT }],
            children: [
                new InternalHyperlink({
                    anchor: bookmark,
                    children: [
                        tocRun(state, item.text, level),
                        new TextRun({ children: [new Tab()], font: state.bodyFont, size: state.bodyHalfPoints }),
                        tocPageRun(state, bookmark, pages.get(item.id) ?? 1, level),
                    ],
                }),
            ],
        })
    })
    return [
        new Paragraph({
            indent: contentIndent(state),
            border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: state.accent, space: 4 } },
            spacing: { after: 200 },
            children: [
                new TextRun({ text: 'Contents', bold: true, font: state.headingFont, size: contentsTitleHalfPoints(state), color: state.accent }),
            ],
        }),
        ...entries,
    ]
}

type FrontGroup = 'title' | 'toc' | 'body'

/** A cover page on its own with no header, so its image can run to every paper edge on a zero-margin page. */
function isCoverEdge(state: RenderState, showHeader: boolean, titleOnly: boolean): boolean {
    return titleOnly && logoHasBleed(state) && !showHeader
}

function sectionProperties(state: RenderState, showHeader: boolean, showFooter: boolean, titleOnly: boolean): ISectionOptions['properties'] {
    const { profile } = state.document
    const layout = resolvePdfExportLayout(profile)
    const portrait = pdfPageSizeMm(profile)
    const landscape = profile.page.orientation === 'landscape'
    const margins = profile.page.marginsMm
    const coverEdge = isCoverEdge(state, showHeader, titleOnly)
    const center = titleOnly && !logoHasBleed(state)
    const topMm = coverEdge
        ? 0
        : layout.headerBleeds && showHeader
          ? Math.max(margins.top, profile.header.heightMm + profile.header.gapMm)
          : margins.top
    const bottomMm = layout.footerBleeds && showFooter ? Math.max(margins.bottom, profile.footer.heightMm + profile.footer.gapMm) : margins.bottom
    // Only the edge-to-edge cover drops the side margins. Bars that ignore margins reach the edge on their own (see chromeTable),
    // so footnotes and anything typed later in Word keep the real margins.
    const zeroSides = coverEdge
    return {
        verticalAlign: center ? VerticalAlignSection.CENTER : undefined,
        page: {
            size: {
                // docx swaps these when orientation is landscape, so pass the portrait sheet.
                width: convertMillimetersToTwip(portrait.width),
                height: convertMillimetersToTwip(portrait.height),
                orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
                top: convertMillimetersToTwip(topMm),
                right: zeroSides ? 0 : convertMillimetersToTwip(margins.right),
                bottom: convertMillimetersToTwip(bottomMm),
                left: zeroSides ? 0 : convertMillimetersToTwip(margins.left),
                header: edgeDistance(layout.headerBleeds && showHeader, margins.top),
                footer: edgeDistance(layout.footerBleeds && showFooter, margins.bottom),
            },
        },
    }
}

function buildSections(state: RenderState, groups: { id: FrontGroup; children: Block[] }[], watermark: Picture | null): ISectionOptions[] {
    const { profile } = state.document
    const merged: { key: string; showHeader: boolean; showFooter: boolean; titleOnly: boolean; children: Block[] }[] = []
    for (const group of groups) {
        const showHeader = pdfChromeShown(profile, 'header', group.id)
        const showFooter = pdfChromeShown(profile, 'footer', group.id)
        const key = `${showHeader}:${showFooter}`
        const previous = merged[merged.length - 1]
        // A cover with no bleeding image is centred on its page, which only works in a section of its own.
        // A bleeding cover stays merged: its spacing assumes it shares the next page's margins.
        const keepTitleAlone = previous?.titleOnly === true && !logoHasBleed(state)
        if (previous && previous.key === key && !keepTitleAlone) {
            previous.titleOnly = false
            previous.children.push(new Paragraph({ children: [new PageBreak()] }), ...group.children)
        } else {
            merged.push({ key, showHeader, showFooter, titleOnly: group.id === 'title', children: [...group.children] })
        }
    }

    return merged.map((section, index) => {
        const zeroSides = isCoverEdge(state, section.showHeader, section.titleOnly)
        const chrome = section.showHeader ? chromeTable(state, 'header', zeroSides) : []
        const headerChildren = [...chrome, ...watermarkBlocks(state, watermark)]
        return {
            properties: {
                ...sectionProperties(state, section.showHeader, section.showFooter, section.titleOnly),
                type: index === 0 ? undefined : SectionType.NEXT_PAGE,
            },
            headers: headerChildren.length > 0 ? { default: new Header({ children: headerChildren }) } : undefined,
            footers: section.showFooter ? { default: new Footer({ children: chromeTable(state, 'footer', zeroSides) }) } : undefined,
            children: section.children,
        }
    })
}

async function prepareCode(node: Code, profile: PdfExportProfile): Promise<PreparedCode> {
    const text = node.value.replace(/\n$/, '')
    if ((node.lang ?? '').toLowerCase() === 'mermaid') {
        try {
            // The renderer leaves out the accTitle and accDescr lines; the alt text reads them.
            const svg = renderMermaidDiagramForExport(text, profile.content.mermaidThemeId)
            // Nothing to draw yet renders a 0×0 picture, which can't be drawn. Say so, as the PDF does, not print the source.
            const size = getSvgDimensions(svg)
            if (!size) return { kind: 'error', message: EMPTY_DIAGRAM_MESSAGE }
            return {
                kind: 'diagram',
                png: await diagramPng(svg, profile.content.mermaidThemeId),
                size,
                source: text,
                alt: diagramAltText(text),
            }
        } catch (err) {
            return { kind: 'error', message: xmlSafe(errorMessage(err)) }
        }
    }
    try {
        return { kind: 'code', lines: await highlightFencedCodeTokens(text, node.lang ?? undefined, profile.content.codeTheme) }
    } catch {
        // Like the PDF, a block that can't be highlighted is still written, in the theme's plain code colour.
        return { kind: 'code', lines: text.split('\n').map((line) => [{ text: line }]) }
    }
}

/** Word renderer for an {@link ExportDocument}. */
export async function renderExportDocx(source: ExportDocument): Promise<Uint8Array> {
    const document = xmlSafeDocument(source)
    expandHtml(document.tree)
    const codes: Code[] = []
    visit(document.tree, 'code', (node: Code) => {
        codes.push(node)
    })
    const preparedList = await Promise.all(codes.map((node) => prepareCode(node, document.profile)))
    const prepared = new Map(codes.map((node, index) => [node, preparedList[index]!]))
    const state = createState(document, prepared, await convertImages(document))
    const body = await renderBlocks(state, document.tree.children, true)
    // Anchors after the last words still need somewhere to be.
    if (state.pendingAnchors.length > 0) body.push(new Paragraph({ spacing: { after: 0 }, children: takePendingAnchors(state) }))
    const groups: { id: FrontGroup; children: Block[] }[] = []
    if (document.profile.frontMatter.titlePage) groups.push({ id: 'title', children: await titleBlocks(state) })
    if (state.toc.length > 0) groups.push({ id: 'toc', children: tocBlocks(state) })
    groups.push({ id: 'body', children: body })
    const watermark = await createWatermarkPng(document.profile.content.watermark, document.profile.typography.bodyFont, state.contentPx)
    const headingStyle = (depth: number) => ({
        run: { font: state.headingFont, size: headingHalfPoints(state, depth), bold: true, color: state.accent },
    })

    const doc = new Document({
        title: document.metadata.title,
        // An empty string, not undefined, so docx leaves these out instead of writing 'Un-named'.
        creator: document.metadata.author || '',
        lastModifiedBy: document.metadata.author || '',
        description: document.metadata.subtitle || undefined,
        // No `updateFields`: it makes Word ask about updating fields every time the file opens.
        // Header and footer page numbers refresh on their own; the contents numbers show their estimate until F9.
        styles: {
            default: {
                document: {
                    run: { font: state.bodyFont, size: state.bodyHalfPoints, color: '262626', language: wordLanguage(document) },
                    paragraph: { spacing: bodyLineSpacing(state) },
                },
                heading1: headingStyle(1),
                heading2: headingStyle(2),
                heading3: headingStyle(3),
                heading4: headingStyle(4),
                heading5: headingStyle(5),
                heading6: headingStyle(6),
                hyperlink: { run: { color: state.link, underline: { type: UnderlineType.SINGLE, color: state.link } } },
            },
        },
        numbering: state.numbering.length > 0 ? { config: state.numbering } : undefined,
        footnotes: Object.keys(state.footnotes).length > 0 ? state.footnotes : undefined,
        sections: buildSections(state, groups, watermark),
    })

    const buffer = await Packer.toBuffer(doc, undefined, [
        { path: 'word/fontTable.xml', data: fontTableXml(state.monoFont.ascii, state.eastAsianFonts) },
    ])
    warnAboutDroppedImages(state)
    return new Uint8Array(buffer)
}
