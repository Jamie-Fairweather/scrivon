import type { Heading, Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { nodeText } from '@/lib/markdown/export-outline'
import { markdownRemarkPlugins } from '@/lib/markdown/remark-plugins'
import type { PdfExportMetadata, PdfExportMetadataOverrides, PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { withoutDocumentExtension } from '@/lib/workspace/file-types'

const FRONT_MATTER_KEYS = new Set(['title', 'subtitle', 'author', 'date'])

const PAGE_PLACEHOLDER = /\{\{\s*(page|total)\s*\}\}/

/** A document placeholder in header/footer text, spaces inside the braces allowed like `{{ page }}`. */
const DOCUMENT_PLACEHOLDER = /\{\{\s*(title|subtitle|author|date)\s*\}\}/gi

/** Today's date the way the user's system writes it, for a `{{date}}` the document leaves blank. */
function todayText(): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date())
}

/**
 * Fills the document placeholders a header/footer text may use: `{{title}}`, `{{subtitle}}`,
 * `{{author}}` and `{{date}}`, which is today when no date is set. `{{page}}` and `{{total}}`
 * are left for the page numbering.
 */
export function resolvePdfChromeText(text: string, metadata: PdfExportMetadata): string {
    return text
        .replace(DOCUMENT_PLACEHOLDER, (_match, key: string) => {
            const name = key.toLowerCase() as keyof PdfExportMetadata
            return name === 'date' ? metadata.date || todayText() : metadata[name]
        })
        .trim()
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

const PAGE_PLACEHOLDERS = new RegExp(PAGE_PLACEHOLDER.source, 'g')

/**
 * Text the stamper's fallback font can draw. The stamper writes the label in the footer's own
 * font when the export's glyph sample put every character it needs there; otherwise it writes
 * in Helvetica with WinAnsi encoding, so anything else (Cyrillic, CJK, emoji, `ę`) prints as `?`.
 * Must match `win_ansi_bytes` in `page_numbers.rs`.
 */
const STAMPER_TEXT = /^[ -~\u00a0-\u00ff\u20ac\u2026\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u2122]*$/

/** A custom page-number text split into the part the stamper draws and the plain text around it. */
export type PdfPageNumberParts = { before: string; counter: string; after: string }

/**
 * The custom footer text as the PDF draws it. The stamper draws the whole text when its Helvetica
 * fallback can (`before`/`after` empty). Otherwise it only gets the counting part, from the first
 * `{{page}}`/`{{total}}` to the last, and the text either side is laid out as ordinary footer
 * text, so a Cyrillic or CJK title prints in the document's font. `null` when nothing counts.
 */
export function pdfPageNumberParts(profile: PdfExportProfile, metadata: PdfExportMetadata): PdfPageNumberParts | null {
    const template = pdfPageNumberTemplate(profile, metadata)
    if (!template) return null
    if (STAMPER_TEXT.test(template)) return { before: '', counter: template, after: '' }
    const placeholders = [...template.matchAll(PAGE_PLACEHOLDERS)]
    const start = placeholders[0]!.index
    const last = placeholders.at(-1)!
    const end = last.index + last[0].length
    return { before: template.slice(0, start).trim(), counter: template.slice(start, end), after: template.slice(end).trim() }
}

/**
 * Format string for the page-number stamper: a preset name, `custom:<template>`
 * (the stamper fills `{{page}}` / `{{total}}`), or `none`.
 */
export function pdfPageNumberFormat(profile: PdfExportProfile, metadata: PdfExportMetadata): string {
    const format = profile.footer.pageNumbers
    if (format !== 'custom') return format
    const parts = pdfPageNumberParts(profile, metadata)
    return parts ? `custom:${parts.counter}` : 'none'
}

function stripQuotes(value: string): string {
    const trimmed = value.trim()
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1)
    }
    return trimmed
}

/**
 * A top-level YAML `key:` line, the kind of line front matter is made of: a quoted key, or text
 * that doesn't start with a YAML indicator (list item, comment, `>`, `[`, `*`...), then a `:`
 * followed by a space or the line end. So `date created:`, `标题:` and `"my key":` all count.
 */
const YAML_KEY_LINE = /^(?:"([^"]*)"|'([^']*)'|([^\s#:\-?,[\]{}&*!|>'"%@`][^:]*?))\s*:(?:\s|$)/u
/** A YAML comment, allowed anywhere in front matter. */
const YAML_COMMENT_LINE = /^#/
/** What YAML allows after a key: indented (nested) values, list items, and a flow list's closing `]` or `}`. */
const YAML_CONTINUATION_LINE = /^(?:\s|-(?:\s|$)|[\]}])/
/** A key written the way front matter keys are: lower case, or a script with no capitals (`标题`). */
const FRONT_MATTER_STYLE_KEY = /^[\p{Ll}\p{Lo}_]/u
/** Keys the export reads, so `Title:` still counts even though front matter keys are usually lower case. */
const EXPORT_KEYS = new Set([...FRONT_MATTER_KEYS, 'lang'])

/** The key and the raw value of a top-level YAML `key: value` line, or null for any other line. */
function yamlKeyLine(line: string): { key: string; value: string } | null {
    const match = YAML_KEY_LINE.exec(line)
    if (!match) return null
    return { key: (match[1] ?? match[2] ?? match[3]!).trim(), value: line.slice(match[0].length) }
}

/**
 * Whether the text between two leading `---` lines is front matter rather than ordinary
 * Markdown between two horizontal rules. Every line must be YAML-shaped (keys, the values
 * nested under them, comments), and at least one key must look like a front-matter key, so a
 * paragraph between rules, or a prose label like `Note: draft` or `Agenda:` with a list, is kept.
 */
function isFrontMatterBlock(block: string): boolean {
    let sawKey = false
    let frontMatterKey = false
    let blank = true
    for (const line of block.split(/\r?\n/)) {
        if (!line.trim()) continue
        blank = false
        const entry = yamlKeyLine(line)
        if (entry) {
            sawKey = true
            if (FRONT_MATTER_STYLE_KEY.test(entry.key) || EXPORT_KEYS.has(entry.key.toLowerCase())) frontMatterKey = true
        } else if (YAML_COMMENT_LINE.test(line)) continue
        else if (!sawKey || !YAML_CONTINUATION_LINE.test(line)) return false
    }
    return blank || frontMatterKey
}

/** A BCP-47 language tag such as `ja`, `en-GB` or `zh-Hant-TW`. */
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/

/**
 * Front matter `title`/`subtitle`/`author`/`date`, plus `lang` when it is a valid language tag.
 * `lang` is absent when the front matter doesn't set one.
 */
export function parsePdfExportFrontMatter(source: string): { matter: Partial<PdfExportMetadata>; body: string; lang?: string } {
    // The closing fence is a `---` line of its own: `----` or a `---|---` table divider doesn't close it.
    const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
    if (!match || !isFrontMatterBlock(match[1]!)) return { matter: {}, body: source }

    const matter: Partial<PdfExportMetadata> = {}
    let lang: string | undefined
    for (const line of match[1]!.split(/\r?\n/)) {
        // Only top-level keys: a `title:` nested under another key is not the document's title.
        const entry = yamlKeyLine(line)
        if (!entry) continue
        const key = entry.key.toLowerCase()
        const value = stripQuotes(entry.value)
        if (key === 'lang' && LANGUAGE_TAG.test(value)) lang = value
        if (!FRONT_MATTER_KEYS.has(key) || !value) continue
        matter[key as keyof PdfExportMetadata] = value
    }

    return lang ? { matter, body: match[2]!, lang } : { matter, body: match[2]! }
}

/** Letters per script, for {@link guessDocumentLanguage}. */
const LETTER = /\p{L}/gu
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu
const HAN = /\p{Script=Han}/gu
const HANGUL = /\p{Script=Hangul}/gu
const ARABIC = /\p{Script=Arabic}/gu
const HEBREW = /\p{Script=Hebrew}/gu

/** Common characters written differently in Traditional and Simplified Chinese, for {@link chineseLanguageTag}. */
const TRADITIONAL_ONLY =
    /[們這個來時說國會對學為與經過還發開關問題點實現種從動機進長樣電話讀書寫體間應該當頭見覺業務區歷東車門錢買賣認識興環檔檢選單輸設計顯網頁圖資訊軟價產]/gu
const SIMPLIFIED_ONLY =
    /[们这个来时说国会对学为与经过还发开关问题点实现种从动机进长样电话读书写体间应该当头见觉业务区历东车门钱买卖认识兴环档检选单输设计显网页图资讯软价产]/gu

/** Which Han script a Chinese language tag asks for, or '' when it doesn't say (`zh`). */
export function hanScriptOfTag(tag: string): 'Hant' | 'Hans' | '' {
    if (/-(?:hant|tw|hk|mo)(?:-|$)/i.test(tag)) return 'Hant'
    if (/-(?:hans|cn|sg|my)(?:-|$)/i.test(tag)) return 'Hans'
    return ''
}

/**
 * The tag for Chinese text. A bare `zh` would make the browser use Simplified glyph shapes,
 * so this says which script: the user's own Chinese language (`zh-TW`) unless the text is
 * plainly in the other script, else `zh-Hant` or `zh-Hans` from the text, Simplified by default.
 */
function chineseLanguageTag(text: string, systemLanguages: readonly string[]): string {
    const traditional = text.match(TRADITIONAL_ONLY)?.length ?? 0
    const simplified = text.match(SIMPLIFIED_ONLY)?.length ?? 0
    const script = traditional > simplified ? 'Hant' : simplified > traditional ? 'Hans' : ''
    const system = systemLanguages.find((tag) => /^zh(?:-|$)/i.test(tag))
    if (system && (!script || hanScriptOfTag(system) === script)) return system
    return script === 'Hant' ? 'zh-Hant' : 'zh-Hans'
}

/** The user's preferred languages, most preferred first. */
function systemLanguages(): readonly string[] {
    if (typeof navigator === 'undefined') return []
    return navigator.languages?.length ? navigator.languages : [navigator.language]
}

/**
 * The language a document's prose is most likely in, from the scripts its letters use, so the
 * PDF can be tagged with it: the browser picks the font for shared Han characters by language,
 * which gives Japanese text Chinese glyph shapes when tagged `en`. Only scripts that point at one
 * language are guessed; anything else, or a mix where no such script leads, stays `en`.
 * Chinese also says which script (see {@link chineseLanguageTag}).
 */
export function guessDocumentLanguage(text: string, languages: readonly string[] = systemLanguages()): string {
    const count = (pattern: RegExp) => text.match(pattern)?.length ?? 0
    const letters = count(LETTER)
    if (letters === 0) return 'en'
    const kana = count(KANA)
    const han = count(HAN)
    const hangul = count(HANGUL)
    const cjk = kana + han + hangul
    // One CJK character carries about what three Latin letters do, so a quarter of the letters is a lead.
    if (cjk * 3 >= letters - cjk) {
        if (hangul >= kana + han) return 'ko'
        // Japanese mixes kana into its kanji; Chinese has next to none.
        return kana * 10 >= han ? 'ja' : chineseLanguageTag(text, languages)
    }
    if (count(ARABIC) * 2 > letters) return 'ar'
    if (count(HEBREW) * 2 > letters) return 'he'
    return 'en'
}

/**
 * The plain text of the document's first top-level H1, ATX or setext. Read from the parsed
 * tree, so a `# comment` in fenced code never wins and inline markup drops out.
 */
function firstHeadingText(body: string): string {
    const processor = unified().use(remarkParse).use(markdownRemarkPlugins)
    const tree = processor.runSync(processor.parse(body), body) as Root
    const heading = tree.children.find((node): node is Heading => node.type === 'heading' && node.depth === 1)
    return heading ? nodeText(heading).replace(/\s+/g, ' ').trim() : ''
}

export function fallbackPdfExportTitle(body: string, tabName: string | undefined): string {
    const heading = firstHeadingText(body)
    if (heading) return heading
    if (!tabName) return 'Document'
    const base = withoutDocumentExtension(tabName).trim()
    return base || 'Document'
}

/** An override that is set wins even when empty, so clearing a field drops the front-matter value. */
function overrideOr(override: string | undefined, matter: string | undefined): string {
    return override !== undefined ? override.trim() : (matter?.trim() ?? '')
}

/**
 * The export's title, subtitle, author and date: overrides (the export dialog's fields), then
 * front matter. An empty title still falls back to the front matter, the first heading, then the tab.
 */
export function resolvePdfExportMetadata(
    source: string,
    tabName: string | undefined,
    overrides: PdfExportMetadataOverrides = {}
): { metadata: PdfExportMetadata; body: string; lang?: string } {
    const { matter, body, lang } = parsePdfExportFrontMatter(source)
    const title = overrides.title?.trim() || matter.title?.trim() || fallbackPdfExportTitle(body, tabName)
    return {
        metadata: {
            title,
            subtitle: overrideOr(overrides.subtitle, matter.subtitle),
            author: overrideOr(overrides.author, matter.author),
            date: overrideOr(overrides.date, matter.date),
        },
        body,
        lang,
    }
}
