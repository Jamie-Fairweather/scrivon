import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import type { PluggableList } from 'unified'
import { EXIT, visit } from 'unist-util-visit'
import { GITHUB_ALERT_KINDS } from '@/lib/markdown/github-alerts'

/**
 * rehype-raw, but only for a document that has raw HTML. It parses the whole tree again, which more than doubles
 * the HTML step of every preview update on a long document, and without raw HTML it has nothing to do.
 */
export function rehypeRawWhenNeeded(): ReturnType<typeof rehypeRaw> {
    const transform = rehypeRaw()
    return (tree, file) => {
        let found = false
        visit(tree, 'raw', () => {
            found = true
            return EXIT
        })
        return found ? transform(tree, file) : tree
    }
}

/** Windows drive letters, so `C:\docs\a.md` isn't read as an unknown `c:` scheme (markdownUrlTransform keeps them too). */
const DRIVE_LETTERS = [...'abcdefghijklmnopqrstuvwxyz'].flatMap((letter) => [letter, letter.toUpperCase()])

/**
 * Attributes any element may keep: GitHub's list, less `accessKey` and `tabIndex`, so a document can't take over the
 * app's keyboard shortcuts or move itself to the front of the Tab order.
 */
const ANY_ELEMENT_ATTRIBUTES = (defaultSchema.attributes?.['*'] ?? []).filter((attribute) => attribute !== 'accessKey' && attribute !== 'tabIndex')

/**
 * The raw HTML a Markdown document may use, in the preview and the PDF: GitHub's own list (rehype-sanitize's
 * defaultSchema, which has details, summary, kbd, sub, sup, br, ins and img) plus mark, with images keeping their
 * size and alignment and paragraphs and blocks their alignment. Scripts, frames, styles and event handlers never
 * get through, and their contents are dropped rather than shown as text. Comments are dropped too. Links and images
 * may only point at web, relative or Windows-path addresses; links may also be email and phone (tel:) links, and
 * images data: URLs.
 *
 * `<source>` is left out: its `srcset` would load a web image past the preview's and the PDF's web-image block,
 * which only look at `<img src>`. A `<picture>` then shows its `<img>`, which they do check.
 */
const baseSchema: SanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []).filter((tagName) => tagName !== 'source'), 'mark'],
    attributes: {
        ...defaultSchema.attributes,
        '*': ANY_ELEMENT_ATTRIBUTES,
        img: [...(defaultSchema.attributes?.img ?? []), 'alt', 'width', 'height', 'align'],
        // GitHub's alert classes (see remarkGithubAlerts), and no others.
        p: ['align', ['className', 'markdown-alert-title']],
        div: [
            ...(defaultSchema.attributes?.div ?? []),
            'align',
            ['className', 'markdown-alert', ...GITHUB_ALERT_KINDS.map((kind) => `markdown-alert-${kind}`)],
        ],
    },
    protocols: {
        ...defaultSchema.protocols,
        href: ['http', 'https', 'mailto', 'tel', ...DRIVE_LETTERS],
        src: ['http', 'https', 'data', ...DRIVE_LETTERS],
    },
    strip: ['script', 'style', 'iframe', 'noscript', 'template', 'object', 'embed'],
}

/**
 * For the preview, which shares the page with the app. Every id and name in the document gets GitHub's
 * `user-content-` prefix, so the document can't take over an id the app uses (a dialog's label would point at it)
 * or replace one of `document`'s own methods with an element (`<img name="createElement">`). Links still find
 * their targets: the preview matches `#fragment` against ids with the prefix taken off.
 */
export const previewSanitizeSchema: SanitizeSchema = baseSchema

/** Any value but one starting `__scrivon`, the prefix of the globals Scrivon's own scripts keep on the export page. */
const NOT_A_PAGE_GLOBAL = /^(?!__scrivon)/i

/**
 * For the PDF, a document of its own: ids stay as written, so `#heading` links and the Contents page reach them.
 * Scrivon still runs scripts on that page (the exporter's ready check, the print dialog's), so nothing in the
 * document may stand in for what they read. No element keeps a `name`, as `<img name="readyState">` would replace
 * `document.readyState` (an <img> with a name is also found on `document` by its id). Old-style `<a name>` anchors
 * keep theirs only until it becomes their id (resolveLinks). And no id or name starts `__scrivon`, as
 * `<span id="__scrivonExportFonts">` would stand in for that `window` value.
 */
export const exportSanitizeSchema: SanitizeSchema = {
    ...baseSchema,
    clobber: [],
    attributes: {
        ...baseSchema.attributes,
        '*': [...ANY_ELEMENT_ATTRIBUTES.filter((attribute) => attribute !== 'name' && attribute !== 'id'), ['id', NOT_A_PAGE_GLOBAL]],
        a: [...(baseSchema.attributes?.a ?? []), ['name', NOT_A_PAGE_GLOBAL]],
    },
}

/**
 * Raw HTML in the preview: parsed into real elements, then cleaned. Footnote ids are left unprefixed here
 * (remark-rehype's clobberPrefix: '') because the sanitizer adds the prefix to every id, footnotes included.
 * The same chain numbers diagram blocks for MarkdownDocumentViewer, so both count raw-HTML code blocks alike.
 */
export const previewHtmlPlugins: PluggableList = [rehypeRawWhenNeeded, [rehypeSanitize, previewSanitizeSchema]]

/** remark-rehype options for the preview; see {@link previewHtmlPlugins}. */
export const previewRemarkRehypeOptions = { allowDangerousHtml: true, clobberPrefix: '' } as const
