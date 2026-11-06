import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExportDocument } from '@/lib/markdown/export-document'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

const renderMermaidDiagramForExport = vi.hoisted(() =>
    vi.fn((source: string) => {
        if (source.includes('throw-error')) throw new Error('diagram broke')
        if (source.includes('throw-string')) throw 'diagram string'
        return `<svg>${source}</svg>`
    })
)
const svgToPngBlob = vi.hoisted(() =>
    vi.fn(async (svg: string) => {
        if (svg.includes('png-fail')) throw new Error('raster failed')
        if (svg.includes('png-garbage')) return new Blob([Uint8Array.from([1, 2, 3, 4])])
        const png = Uint8Array.from(
            Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        )
        return new Blob([png])
    })
)
const highlightFencedCodeTokens = vi.hoisted(() =>
    vi.fn(async (code: string) => {
        if (!code.trim()) return []
        return code.split('\n').map((line, index) => {
            if (!line) return []
            if (index === 0) return [{ text: line, color: '#112233' }, { text: '' }]
            return [{ text: line }]
        })
    })
)

vi.mock('@/lib/mermaid/render', () => ({ renderMermaidDiagramForExport }))
vi.mock('@/lib/mermaid/export', () => ({ svgToPngBlob }))
const notifyWarning = vi.hoisted(() => vi.fn())

vi.mock('@/lib/markdown/shiki-highlighter', () => ({ highlightFencedCodeTokens }))
vi.mock('@/lib/notify', () => ({ notifyWarning }))

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const GIF = Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'))
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x00, 0x11, 0x00, 0xff, 0xd9])
const BMP = Uint8Array.from([0x42, 0x4d, 0x1a, 0x00])
const SHORT_PNG = PNG.subarray(0, 8)

function dataUrl(mime: string, bytes: Uint8Array): string {
    return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}

const GIF0 = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0])

function bmp(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(26)
    bytes[0] = 0x42
    bytes[1] = 0x4d
    const view = new DataView(bytes.buffer)
    view.setInt32(18, width, true)
    view.setInt32(22, height, true)
    return bytes
}

function jpeg(bytes: number[], min = 16): Uint8Array {
    const padded = bytes.slice()
    while (padded.length < min) padded.push(0)
    return Uint8Array.from([0xff, 0xd8, ...padded])
}

function sof(height: number, width: number): number[] {
    return [0xff, 0xc0, 0x00, 0x0b, 0x08, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 0x01, 0x00, 0x00, 0x00]
}

function sizedPng(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(PNG)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return bytes
}

const PNG_URL = dataUrl('image/png', PNG)
const GIF_URL = dataUrl('image/gif', GIF)
const JPG_URL = dataUrl('image/jpeg', JPG)
const BMP_URL = dataUrl('image/bmp', BMP)
const SHORT_PNG_URL = dataUrl('image/png', SHORT_PNG)
const WIDE_PNG_URL = dataUrl('image/png', sizedPng(200, 10))

function fence(lang: string, body: string): string {
    return `\`\`\`${lang}\n${body}\n\`\`\``
}

function readDocx(data: Uint8Array): { xml: string; names: string[]; parts: Record<string, string> } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const names: string[] = []
    const xml: string[] = []
    const parts: Record<string, string> = {}
    let offset = 0
    while (offset + 30 <= data.length && view.getUint32(offset, true) === 0x04034b50) {
        const method = view.getUint16(offset + 8, true)
        const compressed = view.getUint32(offset + 18, true)
        const nameLength = view.getUint16(offset + 26, true)
        const extraLength = view.getUint16(offset + 28, true)
        const nameStart = offset + 30
        const name = new TextDecoder().decode(data.subarray(nameStart, nameStart + nameLength))
        const start = nameStart + nameLength + extraLength
        const bytes = data.subarray(start, start + compressed)
        names.push(name)
        if (name.endsWith('.xml') || name.endsWith('.rels')) {
            parts[name] = new TextDecoder().decode(method === 0 ? bytes : inflateRawSync(bytes))
            xml.push(parts[name])
        }
        offset = start + compressed
    }
    return { xml: xml.join('\n'), names, parts }
}

/** The `<w:r>` that holds `text`, up to its `<w:t>`, so a check looks at that run's own formatting. */
function runWith(xml: string, text: string): string {
    const end = xml.indexOf(`>${text}</w:t>`)
    if (end < 0) return ''
    return xml.slice(xml.lastIndexOf('<w:r>', end), end)
}

/** The `<w:p>` (or, with `tag`, other element) that holds `text`, from its start up to that text. */
function blockWith(xml: string, text: string, tag = '<w:p>'): string {
    const end = xml.indexOf(`>${text}</w:t>`)
    if (end < 0) return ''
    return xml.slice(xml.lastIndexOf(tag, end), end)
}

/** The page number the contents entry for `id` shows: the stored result of its PAGEREF field. */
function tocPage(xml: string, id: string): number | null {
    const at = xml.indexOf(`<w:instrText>PAGEREF ${id} \\h</w:instrText>`)
    if (at < 0) return null
    const match = /<w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">(\d+)<\/w:t><w:fldChar w:fldCharType="end"\/>/.exec(xml.slice(at))
    return match ? Number(match[1]) : null
}

/** Display size, in pixels, of the drawing whose alt text is `descr`. */
function drawingSize(xml: string, descr: string): { width: number; height: number } | null {
    const at = xml.indexOf(`descr="${descr}"`)
    if (at < 0) return null
    const extent = [...xml.slice(0, at).matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].pop()
    return extent ? { width: Number(extent[1]) / 9525, height: Number(extent[2]) / 9525 } : null
}

function profile(edit?: (draft: PdfExportProfile) => void): PdfExportProfile {
    const draft = createDefaultPdfExportProfile()
    edit?.(draft)
    return draft
}

async function render(source: string, edit?: (draft: PdfExportProfile) => void, assets?: PdfExportResolvedAssets) {
    const { renderExportDocx } = await import('@/lib/markdown/export-docx')
    const bytes = await renderExportDocx(buildExportDocument(source, { profile: profile(edit), tabName: 'notes.md', assets }))
    return readDocx(bytes)
}

const RICH = [
    '# Alpha',
    '',
    'Paragraph with **bold**, *em*, ~~gone~~, `code`, and a [site](https://example.com).',
    '',
    'Soft  ',
    'break.',
    '',
    'Jump to [Alpha](#alpha) and a [named][named].',
    '',
    '[named]: https://example.com/named',
    '',
    '[](https://example.com/empty)',
    '',
    `![pixel](${PNG_URL})`,
    '',
    `![](${GIF_URL})`,
    '',
    `![photo](${JPG_URL})`,
    '',
    `![bitmap](${BMP_URL})`,
    '',
    `![short](${SHORT_PNG_URL})`,
    '',
    '![plain](data:image/png,hello)',
    '',
    '![bad](data:image/png;base64,%%%)',
    '',
    '![remote](https://example.com/a.png)',
    '',
    '![](https://example.com/no-alt.png)',
    '',
    '![logo][logo]',
    '',
    `![][logo]`,
    '',
    `[logo]: ${PNG_URL}`,
    '',
    '> Quoted words',
    '>',
    '> - quoted item',
    '',
    '- bullet',
    '- [ ] open',
    '- [x] done',
    '',
    '1. one',
    '',
    'Between lists.',
    '',
    '3. three',
    '',
    '-',
    '    - nested only',
    '',
    '-',
    '    > quoted only',
    '',
    '- [ ]',
    '    - task child',
    '',
    '- first line',
    '',
    '    second line',
    '',
    '| left | mid | right |',
    '| --- | :---: | ---: |',
    '| a | b | c |',
    '',
    '---',
    '',
    fence('js', 'const value = 1\n\nconst next = 2'),
    '',
    fence('', 'plain'),
    '',
    fence('text', ''),
    '',
    fence('mermaid', 'throw-error'),
    '',
    fence('mermaid', 'throw-string'),
    '',
    fence('mermaid', 'png-fail'),
    '',
    fence('mermaid', 'png-garbage'),
    '',
    fence('mermaid', 'png-ok'),
    '',
    '<div>block</div>',
    '',
    'Inline <span>raw</span> here.',
    '',
    'A note[^n] and again[^n] and a picture note[^pic].',
    '',
    '[^n]: The note.',
    '',
    '[^pic]: ![x](https://example.com/nope.png)',
    '',
    '## Beta',
    '',
    '### Gamma',
    '',
    `## ![](${PNG_URL})`,
].join('\n')

describe('renderExportDocx', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        notifyWarning.mockClear()
    })

    it('writes the body: marks, links, images, lists, tables, code, diagrams, and notes', async () => {
        const { xml, names } = await render(RICH)
        expect(xml).toContain('Paragraph with ')
        expect(xml).toContain('bold')
        expect(xml).toContain('https://example.com')
        expect(xml).toContain('https://example.com/named')
        expect(xml).toContain('w:anchor="alpha"')
        expect(xml).toContain('Quoted words')
        expect(xml).toContain('quoted item')
        expect(xml).toContain('open')
        expect(xml).toContain('done')
        expect(xml).toContain('nested only')
        expect(xml).toContain('quoted only')
        expect(xml).toContain('task child')
        expect(xml).toContain('second line')
        expect(xml).toContain('const value = 1')
        expect(xml).toContain('plain')
        expect(xml).toContain('diagram broke')
        expect(xml).toContain('diagram string')
        expect(xml).toContain('png-fail')
        expect(xml).toContain('png-garbage')
        expect(xml).toContain('descr="Diagram"')
        expect(xml).toContain('The note')
        expect(xml).toContain('Beta')
        // Raw HTML is left out, as in the PDF, but the words between inline tags stay.
        expect(xml).not.toContain('&lt;div&gt;')
        expect(xml).not.toContain('&lt;span&gt;')
        expect(xml).toContain('>raw</w:t>')
        expect(xml).toContain('Segoe UI')
        // The default mono stack starts with Mac-only fonts. Windows has neither, so Word gets Consolas.
        expect(xml).toContain('w:ascii="Consolas"')
        expect(xml).not.toContain('Menlo')
        expect(xml).toContain('F6F8FA')
        // Heading runs carry their own size. A body-sized run was flattening every level.
        expect(xml).toMatch(/w:val="Heading1"[\s\S]{0,800}w:val="36"/)
        expect(xml).toMatch(/w:val="Heading2"[\s\S]{0,800}w:val="30"/)
        expect(xml).toMatch(/w:val="Heading3"[\s\S]{0,800}w:val="27"/)
        // Markers hang inside the text column. left equals hanging, so the bullet sits on the content edge.
        expect(xml).toContain('w:left="360"')
        expect(xml).toContain('w:hanging="360"')
        expect(xml).toContain('w:w="180"')
        expect(xml).toContain('w:w="120"')
        expect(xml).not.toContain('w:val="both"')
        expect(names.some((name) => name.startsWith('word/media/'))).toBe(true)
        expect(svgToPngBlob).toHaveBeenCalled()
        expect(xml).not.toContain('w:val="nextPage"')
        expect(xml).not.toContain('w:val="both"')
        // Line height is a multiple of the font size (11pt × 1.6 = 352 twips), the same box the PDF uses.
        expect(xml).toContain('w:lineRule="atLeast"')
        expect(xml).toContain('w:line="352"')
        expect(xml).toMatch(/w:val="Heading1"[\s\S]{0,250}w:line="576"/)
    })

    it('draws diagrams at their own size, like the PDF, and fits them to the real page', async () => {
        const diagram = async (width: number, height: number) => {
            renderMermaidDiagramForExport.mockImplementationOnce(() => `<svg viewBox="0 0 ${width} ${height}"></svg>`)
            // The PNG is rasterised at 2x.
            svgToPngBlob.mockImplementationOnce(async () => new Blob([Uint8Array.from(sizedPng(width * 2, height * 2))]))
            const { xml } = await render(fence('mermaid', 'graph TD'))
            return drawingSize(xml, 'Flowchart')
        }
        // A small flowchart stays 300px wide instead of doubling to 600px.
        expect(await diagram(300, 150)).toEqual({ width: 300, height: 150 })
        // A wide one uses the full 718px text width, not a fixed 640px.
        expect(await diagram(900, 300)).toEqual({ width: 718, height: 239 })
        // A tall sequence diagram may use the page height (1039px on A4 with 10mm margins), not a fixed 480px.
        expect(await diagram(600, 1300)).toEqual({ width: 480, height: 1039 })
    })

    it('gives each diagram its own alt text, and leaves a picture with none without a made-up one', async () => {
        const { xml } = await render(
            [
                fence('mermaid', 'flowchart TD\n  accTitle: Login flow\n  accDescr: How a user signs in\n  A --> B'),
                '',
                fence('mermaid', 'sequenceDiagram\n  Alice->>Bob: Hi'),
                '',
                `![](${PNG_URL})`,
            ].join('\n')
        )
        expect(xml).toContain('name="Login flow" descr="Login flow. How a user signs in"')
        expect(xml).toContain('name="Sequence diagram" descr="Sequence diagram: Alice, Bob"')
        // No alt text in the Markdown means none in Word too, as with the PDF's alt="", not the word 'image'.
        expect(xml).toContain('name="Picture" descr=""')
        expect(xml).not.toContain('descr="image"')
        expect(xml).not.toContain('descr="Diagram"')
    })

    it('adds no blank page before the first heading when only link definitions or comments come before it', async () => {
        const edit = (draft: PdfExportProfile) => {
            draft.frontMatter.titlePage = true
            draft.flow.newPageFromHeading = 1
        }
        for (const lead of ['[site]: https://example.com', '<!-- markdownlint-disable -->', '[^n]: A note.']) {
            const { xml } = await render(`---\ntitle: Report\n---\n\n${lead}\n\n# Intro\n\nSee [site] and a note[^n].\n\n# Next`, edit)
            const intro = blockWith(xml, 'Intro')
            expect(intro).toContain('Heading1')
            expect(intro).not.toContain('<w:pageBreakBefore/>')
            // Later headings still start a new page.
            expect(blockWith(xml, 'Next')).toContain('<w:pageBreakBefore/>')
        }
    })

    it('writes a short placeholder, not the base64, for a data: picture with no alt text that Word cannot take', async () => {
        const { parts } = await render(
            '![](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)\n\n![](data:image/webp;base64,UklGRg==)\n\n![](https://example.com/badge.svg)'
        )
        const body = parts['word/document.xml']!
        expect(body).not.toContain('base64')
        expect(body.match(/>\[image\]<\/w:t>/g)).toHaveLength(2)
        // A short web address is still written, so the reader can find the picture.
        expect(body).toContain('>https://example.com/badge.svg</w:t>')
    })

    it('still exports, with plain code, when highlighting fails', async () => {
        highlightFencedCodeTokens.mockRejectedValueOnce(new Error('grammar failed'))
        const { xml } = await render(['Before.', '', fence('js', 'const a = 1\nconst b = 2'), '', fence('py', 'print(1)')].join('\n'))
        expect(runWith(xml, 'const a = 1')).toContain('<w:color w:val="24292F"/>')
        expect(xml).toContain('>const b = 2</w:t>')
        // The other blocks are still highlighted.
        expect(runWith(xml, 'print(1)')).toContain('<w:color w:val="112233"/>')
    })

    it('sizes inline code to the text around it, so code in a heading is not shrunk to body size', async () => {
        const { xml } = await render('# The `render()` function\n\n### Uses `useState`\n\nBody `inline` code.')
        // 0.85em, as in the PDF: 36 → 31 in an H1, 27 → 23 in an H3, 22 → 19 in the body.
        expect(runWith(xml, 'render()')).toContain('<w:sz w:val="31"/>')
        expect(runWith(xml, 'useState')).toContain('<w:sz w:val="23"/>')
        expect(runWith(xml, 'inline')).toContain('<w:sz w:val="19"/>')
    })

    it('picks a code font Windows has and marks it fixed-pitch for Word', async () => {
        const monaco = await render('Some `code`.', (draft) => {
            draft.typography.monoFont = 'Monaco, Consolas, monospace'
        })
        expect(monaco.xml).toContain('w:ascii="Consolas"')
        expect(monaco.xml).not.toContain('Monaco')
        expect(monaco.xml).toContain('<w:font w:name="Consolas"><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>')

        // Only Mac fonts named: keep the choice, and the fixed-pitch hint lets Word pick a monospace stand-in.
        const menlo = await render('Some `code`.', (draft) => {
            draft.typography.monoFont = 'Menlo, Monospace'
        })
        expect(menlo.xml).toContain('w:ascii="Menlo"')
        expect(menlo.xml).toContain('<w:font w:name="Menlo"><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>')

        const escaped = await render('Some `code`.', (draft) => {
            draft.typography.monoFont = '"A&B Mono"'
        })
        expect(escaped.xml).toContain('<w:font w:name="A&amp;B Mono">')
    })

    it('keeps blocks nested in list items and quotes indented, with the quote bar on all of them', async () => {
        const { xml } = await render(
            [
                '- item',
                '',
                '  ```js',
                '  list-code',
                '  ```',
                '',
                '  | list-head |',
                '  | --- |',
                '  | list-cell |',
                '',
                '  > list-quote',
                '',
                '> outer-quote',
                '>',
                '> - quote-item',
                '>',
                '> ```js',
                '> quote-code',
                '> ```',
                '>',
                '> > inner-quote',
            ].join('\n')
        )
        const bar = '<w:pBdr><w:left w:val="single" w:color="262626" w:sz="12" w:space="11"/></w:pBdr>'
        // Under a list item's text (360 twips in), not at the page margin.
        expect(blockWith(xml, 'list-code')).toContain('w:left="360"')
        expect(blockWith(xml, 'list-cell', '<w:tbl>')).toContain('<w:tblInd w:type="dxa" w:w="360"/>')
        expect(blockWith(xml, 'list-quote')).toContain('w:left="600"')
        expect(blockWith(xml, 'list-quote')).toContain(bar)
        // Inside a quote: the bar, the quote step, and grey italic text for lists too.
        expect(blockWith(xml, 'outer-quote')).toContain('w:left="240"')
        expect(blockWith(xml, 'quote-item')).toContain(bar)
        expect(blockWith(xml, 'quote-item')).toContain('w:left="600"')
        expect(runWith(xml, 'quote-item')).toContain('<w:i/>')
        expect(runWith(xml, 'quote-item')).toContain('<w:color w:val="525252"/>')
        expect(blockWith(xml, 'quote-code')).toContain(bar)
        expect(blockWith(xml, 'quote-code')).toContain('w:left="240"')
        // A nested quote steps in again instead of sitting on its parent's line.
        expect(blockWith(xml, 'inner-quote')).toContain('w:left="480"')
        expect(blockWith(xml, 'inner-quote')).toContain(bar)
    })

    it('leaves raw HTML and comments out of the Word file, as the PDF does', async () => {
        const { xml } = await render(
            [
                '<!-- TODO: internal pricing notes -->',
                '',
                'Press <kbd>Ctrl</kbd> now.<!-- inline secret --> Done.',
                '',
                '| a |',
                '| --- |',
                '| one<br>split |',
                '',
                '<details><summary>More</summary>',
                '',
                'Hidden body.',
                '',
                '</details>',
            ].join('\n')
        )
        expect(xml).not.toContain('pricing')
        expect(xml).not.toContain('secret')
        expect(xml).not.toContain('&lt;')
        // The words around and between tags stay, and <br> still breaks the line in the cell.
        expect(xml).toContain('>Ctrl</w:t>')
        expect(xml).toContain('>Hidden body.</w:t>')
        expect(blockWith(xml, 'split')).toContain('<w:br/>')
    })

    it('leaves out characters XML forbids, so Word can open the file', async () => {
        const { xml, parts } = await render(
            [
                '---',
                'title: Bell\u0007 report',
                '---',
                '',
                '# Log\u0001 review',
                '',
                'Page one\u000cPage two, a bell\u0007 and a tab\u000b stop. Half a pair: \ud83d.',
                '',
                'Inline `\u001b[31mred\u001b[0m` code.',
                '',
                fence('bash', 'log\u001b[31mred\u001b[0m\u0000'),
                '',
                '![alt\u0002 text](https://example.com/a\u0003.png)',
                '',
                'A note[^n]. Kept: tab\there, emoji 😀.',
                '',
                '[^n]: Foot\u0008note.',
            ].join('\n'),
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.frontMatter.toc = true
                draft.frontMatter.tocExcludeH1 = false
                draft.header.enabled = true
                draft.header.left.text = 'Head\u0001er {{title}}'
                draft.content.watermark = 'Draft\u0007'
            }
        )
        expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
        // A form feed is whitespace, as in the PDF. Everything around the dropped characters is kept.
        expect(xml).toContain('Page one Page two, a bell and a tab stop.')
        expect(xml).toContain('log[31mred[0m')
        expect(xml).toContain('emoji 😀.')
        expect(xml).toContain('Header Bell report')
        expect(xml).toContain('Footnote.')
        expect(parts['docProps/core.xml']).toContain('<dc:title>Bell report</dc:title>')
        expect(tocPage(xml, 'log-review')).toBe(3)
    })

    it('keeps links, formatting, pictures, and paragraphs in footnotes', async () => {
        const { parts } = await render(
            [
                '> Quoted claim[^c] and a table note[^t].',
                '',
                '[^c]: See [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110), **bold**, `code`, and again[^c].',
                '',
                `    Second paragraph with ![pixel](${PNG_URL}).`,
                '',
                '    - listed',
                '',
                '[^t]: Rows:',
                '',
                '    | a | b |',
                '    | --- | --- |',
                '    | 1 | 2 |',
            ].join('\n')
        )
        const notes = parts['word/footnotes.xml']!
        const note = notes.slice(notes.indexOf('<w:footnote w:id="1">'), notes.indexOf('<w:footnote w:id="2">'))
        // The link keeps its URL, so a citation still points somewhere.
        expect(note).toContain('<w:hyperlink')
        expect(parts['word/_rels/footnotes.xml.rels']).toContain('https://www.rfc-editor.org/rfc/rfc9110')
        expect(runWith(note, 'bold')).toContain('<w:b/>')
        expect(runWith(note, 'code')).toContain('w:ascii="Consolas"')
        // Each paragraph is its own paragraph in the small footnote style, not run together.
        expect(note.match(/<w:pStyle w:val="FootnoteText"\/>/g)).toHaveLength(2)
        expect(runWith(note, 'Second paragraph with ')).toContain('<w:sz w:val="19"/>')
        expect(note).toContain('descr="pixel"')
        expect(note).toContain('listed')
        // A footnote can't hold a footnote, and the quote it was cited from doesn't style it.
        expect(note).not.toContain('w:footnoteReference')
        expect(note).not.toContain('<w:i/>')
        expect(note).not.toContain('<w:pBdr>')
        // A table in a footnote is written as text, a row per line.
        const table = notes.slice(notes.indexOf('<w:footnote w:id="2">'))
        expect(table).toContain('>a | b</w:t>')
        expect(table).toContain('>1 | 2</w:t>')
        expect(table).not.toContain('<w:tbl>')
    })

    it('gives every table row the header column count, as the PDF does', async () => {
        const { xml } = await render('| a | b | c |\n| --- | :---: | ---: |\n| 1 |\n| 1 | 2 | 3 | 4 |')
        const table = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)![0]
        const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) ?? []
        expect(rows).toHaveLength(3)
        for (const row of rows) expect(row.match(/<w:tc>/g)).toHaveLength(3)
        expect(table.match(/<w:gridCol /g)).toHaveLength(3)
        // A padded cell keeps the grid lines and its column's alignment.
        const padded = rows[1]!.match(/<w:tc>[\s\S]*?<\/w:tc>/g)!
        expect(padded[2]).toContain('w:val="single"')
        expect(padded[2]).toContain('<w:jc w:val="end"/>')
        // Cells past the header are left out, as in the PDF and preview.
        expect(table).not.toContain('>4</w:t>')
    })

    it('keeps numbers on numbered task lists, lists that start at 0, and nested bullet shapes', async () => {
        const { xml, parts } = await render(
            [
                '1. [ ] first task',
                '2. [x] second task',
                '3. plain step',
                '',
                '---',
                '',
                '0. zero',
                '1. one',
                '',
                '---',
                '',
                '- [ ] loose task',
                '- disc',
                '    - circle',
                '        - square',
                '            - still square',
            ].join('\n')
        )
        // A numbered task keeps its number, with the box after it, so the next item is still "3.".
        const numId = (text: string) => /<w:numId w:val="(\d+)"\/>/.exec(blockWith(xml, text))?.[1]
        expect(numId('first task')).toBeDefined()
        expect(numId('second task')).toBe(numId('first task'))
        expect(numId('plain step')).toBe(numId('first task'))
        expect(blockWith(xml, 'first task')).toContain('>☐ </w:t>')
        // A bulleted task still shows only its box.
        expect(blockWith(xml, 'loose task')).not.toContain('<w:numId')
        const numbering = parts['word/numbering.xml']!
        // The export's own lists, in order; docx adds a nine-level default of its own.
        const levels = [...numbering.matchAll(/<w:abstractNum [\s\S]*?<\/w:abstractNum>/g)]
            .map((match) => match[0])
            .filter((level) => level.match(/<w:lvl /g)?.length === 1)
        expect(levels).toHaveLength(6)
        expect(levels[0]).toContain('<w:start w:val="1"/>')
        expect(levels[1]).toContain('<w:start w:val="0"/>')
        // Disc, circle, then square from the third level on, as in the PDF.
        expect(levels.slice(2).map((level) => /<w:lvlText w:val="([^"]*)"\/>/.exec(level)![1])).toEqual(['•', '◦', '▪', '▪'])
    })

    it('sizes table columns by their content and keeps pictures inside their cell', async () => {
        const notes = 'A long note that would wrap over many lines if every column had the same width. '.repeat(3)
        const { xml } = await render(
            [`| Icon | ID | Notes |`, `| --- | --- | --- |`, `| ![wide](${dataUrl('image/png', sizedPng(640, 320))}) | 7 | ${notes} |`].join('\n')
        )
        const table = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/)![0]
        const grid = [...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]))
        // The short ID column keeps the minimum width, the long notes get the most, and together they fill the 10773-twip text width.
        expect(grid[1]).toBe(900)
        expect(grid[2]!).toBeGreaterThan(grid[0]!)
        expect(grid[0]!).toBeGreaterThan(grid[1]!)
        expect(grid.reduce((sum, size) => sum + size, 0)).toBe(10773)
        // Each cell states its width too, which older Word versions follow.
        for (const size of grid) expect(table).toContain(`<w:tcW w:type="dxa" w:w="${size}"/>`)
        // The picture is shrunk to its cell's text width (less the 180-twip margins each side), not the page's 640px.
        const cellPx = Math.floor((grid[0]! - 360) / 15)
        expect(drawingSize(xml, 'wide')).toEqual({ width: cellPx, height: Math.round(cellPx / 2) })

        // Columns with the same content stay the same width.
        const even = await render('| a | b |\n| --- | --- |\n| one | two |')
        expect([...even.xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]))).toEqual([5386, 5387])
    })

    it('estimates contents page numbers with each table column at its own width', async () => {
        const rows = Array.from({ length: 30 }, (_, index) => `| ${index} | ${'Description words. '.repeat(16)} |`)
        const { xml } = await render(['# Start', '', '| ID | Description |', '| --- | --- |', ...rows, '', '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        // The description wraps in its wide column: 4 lines a row, not the 7 two equal columns gave, which put End on page 8.
        expect(tocPage(xml, 'end')).toBe(6)
    })

    it('justifies body paragraphs and leaves headings, lists, quotes, and tables left aligned', async () => {
        const { xml } = await render('# Title\n\nJustified body.\n\n> Quoted.\n\n- item\n\n| a |\n| --- |\n| b |', (draft) => {
            draft.typography.justify = true
        })
        const justified = xml.match(/w:val="both"/g) ?? []
        expect(justified).toHaveLength(1)
        expect(xml).toMatch(/w:val="both"[\s\S]{0,400}Justified body/)
        expect(xml).not.toMatch(/Heading1[\s\S]{0,250}w:val="both"/)
    })

    it('merges the cover, contents, and body when their chrome matches', async () => {
        const assets: PdfExportResolvedAssets = {
            logoDataUrl: PNG_URL,
            header: { left: PNG_URL, right: '' },
            footer: { left: '', right: GIF_URL },
        }
        const { xml } = await render(
            [
                '---',
                'title: Spec',
                'subtitle: Sub',
                'author: Ada',
                'date: 2026-09-23',
                '---',
                '',
                '# Alpha',
                '',
                'Use `code` here.',
                '',
                fence('js', 'const dark = 1'),
                '',
                '## Beta',
                '',
                '### Gamma',
            ].join('\n'),
            (draft) => {
                draft.page.size = 'letter'
                draft.page.orientation = 'landscape'
                draft.page.marginsMm.bottom = 4
                draft.typography.headingFont = ', -skip, BlinkMacSystemFont, fantasy, "Cambria"'
                draft.typography.bodyFont = 'serif'
                draft.typography.monoFont = 'monospace'
                draft.brand.accentColor = 'nope'
                draft.brand.linkColor = '#abc'
                draft.brand.logoIgnoreMargins = true
                draft.frontMatter.titlePage = true
                draft.frontMatter.toc = true
                draft.frontMatter.tocExcludeH1 = false
                draft.header.enabled = true
                draft.header.hideOnFirstPages = 'none'
                draft.header.ignoreMargins = true
                draft.header.left.text = '{{title}}'
                draft.header.right.text = 'Right'
                draft.header.textColor = '  #abc '
                draft.header.backgroundColor = '#112233'
                draft.header.heightMm = 12
                draft.header.gapMm = 4
                draft.footer.enabled = true
                draft.footer.hideOnFirstPages = 'none'
                draft.footer.pageNumbers = 'custom'
                draft.footer.right.text = '{{page}} of {{total}}'
                draft.footer.backgroundColor = ''
                draft.flow.newPageFromHeading = 2
                draft.content.codeTheme = 'github-dark'
                draft.content.watermark = 'Confidential'
            },
            assets
        )
        expect(xml).toContain('Spec')
        expect(xml).toContain('Sub')
        expect(xml).toContain('Ada')
        expect(xml).toContain('Cambria')
        expect(xml).toContain('Calibri')
        expect(xml).toContain('Consolas')
        expect(xml).toContain('Confidential')
        expect(xml).toContain('D9D9D9')
        expect(xml).toContain('Right')
        expect(xml).toContain('w:orient="landscape"')
        expect(xml).toContain('w:type="page"')
        expect(xml).not.toContain('w:val="nextPage"')
        expect(xml).toContain('0D1117')
        // Header ignores margins, so the bar starts at the paper edge and spans the sheet. The page keeps its own margins.
        expect(xml).toContain('w:header="0"')
        expect(xml).toContain('<w:tblW w:type="dxa" w:w="15840"/><w:tblInd w:type="dxa" w:w="-566"/>')
        expect(xml).not.toMatch(/<w:pgMar[^>]*w:left="0"/)
        expect(xml).toContain('cx="10058400"')
        expect(xml).toContain('relativeFrom="page"')
        // Contents is laid out in the file: dotted leaders and a page number, not an empty Word TOC field.
        expect(xml).toContain('w:leader="dot"')
        expect(xml).toMatch(/Alpha<\/w:t>[\s\S]{0,400}<w:tab\/>[\s\S]{0,400}PAGEREF alpha/)
        expect(tocPage(xml, 'alpha')).toBe(3)
        expect(xml).not.toContain('TOC \\h \\o')
        // Nothing asks Word to update fields on open, so readers don't get a prompt every time.
        expect(xml).not.toContain('w:updateFields')
    })

    it('centres the title page on its own page with the default profile', async () => {
        const { xml } = await render('# Hello\n\n## World', (draft) => {
            draft.frontMatter.titlePage = true
            draft.frontMatter.toc = true
        })
        const sections = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) ?? []
        expect(sections).toHaveLength(2)
        // The cover's section is the first one written, and the only one centred.
        expect(sections[0]).toContain('<w:vAlign w:val="center"/>')
        expect(sections[1]).not.toContain('w:vAlign')
        expect(sections[1]).toContain('w:val="nextPage"')
        // The page count is unchanged: cover, contents, then the body on page 3.
        expect(tocPage(xml, 'world')).toBe(3)
    })

    it('puts a bleeding cover image and both bars on the paper edge', async () => {
        const { xml } = await render(
            '# Alpha\n\n## Beta',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.frontMatter.toc = true
                draft.frontMatter.tocExcludeH1 = false
                draft.brand.logoIgnoreMargins = true
                draft.header.enabled = true
                draft.header.ignoreMargins = true
                draft.header.hideOnFirstPages = 'title'
                draft.header.backgroundColor = '#aa0000'
                draft.footer.enabled = true
                draft.footer.ignoreMargins = true
                draft.footer.hideOnFirstPages = 'title'
                draft.footer.backgroundColor = '#aa0000'
            },
            { logoDataUrl: PNG_URL, header: { left: '', right: '' }, footer: { left: '', right: '' } }
        )
        // Cover page has no margins, so the image is inline and reaches the sheet.
        expect(xml).toMatch(/<w:pgMar w:top="0" w:right="0" w:bottom="\d+" w:left="0"/)
        expect(xml).toContain('wp:inline')
        expect(xml).toContain('cx="7553325"')
        // Later pages keep their margins and pull the bars out to the top, bottom, and side edges.
        expect(xml).toMatch(/<w:pgMar w:top="\d+" w:right="566" w:bottom="\d+" w:left="566" w:header="0" w:footer="0"/)
        expect(xml).toContain('<w:tblW w:type="dxa" w:w="11905"/><w:tblInd w:type="dxa" w:w="-566"/>')
        expect(xml).toContain('w:anchor="alpha"')
        expect(xml).toContain('w:anchor="beta"')
    })

    it('splits sections where the header or footer must disappear', async () => {
        const { xml } = await render(
            '# Cover\n\n## Inside',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.frontMatter.toc = true
                draft.brand.logoIgnoreMargins = false
                draft.header.enabled = true
                draft.header.hideOnFirstPages = 'title+toc'
                draft.header.left.text = 'Head'
                draft.footer.enabled = true
                draft.footer.hideOnFirstPages = 'title'
                draft.footer.pageNumbers = 'page-n'
                draft.footer.left.text = 'Foot'
            },
            { logoDataUrl: PNG_URL, header: { left: '', right: '' }, footer: { left: '', right: '' } }
        )
        expect(xml).toContain('Cover')
        expect(xml).toContain('Head')
        expect(xml).toContain('Foot')
        expect(xml).toContain('w:val="nextPage"')
        expect(xml).toContain('Page ')
        expect(xml).not.toContain('w:header="0"')
        expect(xml).toContain('w:val="center"')
    })

    it('colours and sizes both sides of the header and footer like the PDF bar', async () => {
        const { xml } = await render('# Hi', (draft) => {
            draft.header.enabled = true
            draft.header.backgroundColor = '#112233'
            draft.header.textColor = '#ffffff'
            draft.header.left.text = 'Head'
            draft.header.right.text = 'Right side'
        })
        for (const text of ['Head', 'Right side']) {
            expect(runWith(xml, text)).toContain('<w:color w:val="FFFFFF"/>')
            // 0.85 × 11pt, in half-points.
            expect(runWith(xml, text)).toContain('<w:sz w:val="19"/>')
        }

        const plain = await render('# Hi', (draft) => {
            draft.footer.enabled = true
            draft.footer.left.text = 'Foot'
            draft.footer.pageNumbers = 'page-n'
        })
        expect(runWith(plain.xml, 'Foot')).toContain('<w:color w:val="404040"/>')
        expect(runWith(plain.xml, 'Page ')).toContain('<w:color w:val="404040"/>')
        expect(runWith(plain.xml, 'Page ')).toContain('<w:sz w:val="19"/>')
    })

    it('blends see-through colours onto what is behind them, since Word has no alpha', async () => {
        highlightFencedCodeTokens.mockImplementationOnce(async () => [[{ text: 'faded', color: '#ffffff80' }]])
        const { xml } = await render(['# Alpha', '', 'A [site](https://example.com).', '', fence('js', 'faded')].join('\n'), (draft) => {
            draft.brand.accentColor = '#ff000080'
            draft.brand.linkColor = '#f008'
            draft.header.enabled = true
            draft.header.backgroundColor = '#11223380'
            draft.header.textColor = '#ffffff80'
            draft.header.left.text = 'Head'
            draft.content.codeTheme = 'github-dark'
        })
        // Half-transparent red on white paper.
        expect(runWith(xml, 'Alpha')).toContain('<w:color w:val="FF7F7F"/>')
        // 4-digit #f008 is #ff000088.
        expect(runWith(xml, 'site')).toContain('<w:color w:val="FF7777"/>')
        // The bar is tinted, not dropped to white, and its text is blended onto the bar.
        expect(xml).toContain('w:fill="889099"')
        expect(runWith(xml, 'Head')).toContain('<w:color w:val="C4C8CC"/>')
        // Code tokens blend onto the dark code background.
        expect(runWith(xml, 'faded')).toContain('<w:color w:val="86888B"/>')
    })

    it('writes each page-number preset', async () => {
        for (const format of ['none', 'number', 'n-of-total'] as const) {
            const { xml } = await render('# Hi', (draft) => {
                draft.frontMatter.titlePage = format === 'none'
                draft.footer.enabled = true
                draft.footer.pageNumbers = format
            })
            expect(xml.length).toBeGreaterThan(0)
        }
        const staticFooter = await render('# Hi', (draft) => {
            draft.footer.enabled = true
            draft.footer.pageNumbers = 'custom'
            draft.footer.right.text = 'Draft'
        })
        expect(staticFooter.xml).toContain('Draft')
        const emptyCustom = await render('# Hi', (draft) => {
            draft.footer.enabled = true
            draft.footer.pageNumbers = 'custom'
            draft.footer.right.text = '   '
        })
        expect(emptyCustom.xml).not.toContain('Draft')
    })

    it('paints a watermark image when canvas can encode one', async () => {
        stubDocument('png')
        const { xml } = await render('# Hi', (draft) => {
            draft.content.watermark = 'Secret'
        })
        expect(xml).toContain('behindDoc="1"')
        expect(xml).toContain('Watermark')
    })

    it('sizes the watermark to the turned text so long words are not clipped or stretched', async () => {
        const canvases = stubDocument('png')
        await render('# Hi', (draft) => {
            draft.content.watermark = 'DRAFT'
        })
        const long = await render('# Hi', (draft) => {
            draft.content.watermark = 'CONFIDENTIAL'
        })
        const [draft, confidential] = canvases
        expect(confidential!.width).toBeGreaterThan(draft!.width)
        expect(confidential!.height).toBeGreaterThan(draft!.height)
        // 960px of text turned 30°, plus padding: it all fits, where the old 900×220 canvas cut the ends off.
        expect(confidential!.width).toBe(973)
        expect(confidential!.height).toBe(678)
        // Placed at half the canvas size (it is drawn at 2x), so the shape and angle are kept.
        expect(long.xml).toContain(`cx="${487 * 9525}" cy="${339 * 9525}"`)
        // Same look as the PDF: 8% black in the body font.
        expect(confidential!.ctx.fillStyle).toBe('rgba(0, 0, 0, 0.08)')
        expect(confidential!.ctx.font).toContain('Segoe UI')
        expect(confidential!.ctx.filled).toEqual(['CONFIDENTIAL'])

        // Text too long for the page is scaled down to the text width instead of running off it.
        const huge = await render('# Hi', (draft) => {
            draft.content.watermark = 'INTERNAL USE ONLY - DO NOT DISTRIBUTE'
        })
        expect(canvases[2]!.width).toBe(718 * 2)
        expect(huge.xml).toContain(`cx="${718 * 9525}"`)
    })

    it('falls back to header text when canvas cannot encode the watermark', async () => {
        stubDocument('no-context')
        const missingContext = await render('# Hi', (draft) => {
            draft.content.watermark = 'Secret'
        })
        expect(missingContext.xml).toContain('Secret')
        expect(missingContext.xml).not.toContain('behindDoc="1"')

        stubDocument('no-blob')
        const missingBlob = await render('# Hi', (draft) => {
            draft.content.watermark = 'Secret'
        })
        expect(missingBlob.xml).toContain('D9D9D9')
    })

    it('ignores a blank watermark before touching the canvas', async () => {
        const createElement = vi.fn()
        vi.stubGlobal('document', { createElement })
        await render('# Hi', (draft) => {
            draft.content.watermark = '   '
        })
        expect(createElement).not.toHaveBeenCalled()
    })

    it('numbers every contents entry, including blocks that spill onto the next page', async () => {
        const tall = fence('js', Array.from({ length: 100 }, (_, index) => `const line${index} = ${index}`).join('\n'))
        const { xml } = await render(
            [
                tall,
                '',
                '# Alpha',
                '',
                ...Array.from({ length: 15 }, (_, index) => [`Paragraph ${index} stands alone.`, '']).flat(),
                'See **this** picture.',
                '',
                `![pixel](${PNG_URL})`,
                '',
                '![plain](data:image/png,hello)',
                '',
                `![short](${SHORT_PNG_URL})`,
                '',
                '![remote](https://example.com/a.png)',
                '',
                '![bad](data:image/png;base64,%%%)',
                '',
                `![gif](${dataUrl('image/gif', GIF0)})`,
                '',
                `![bmp](${dataUrl('image/bmp', bmp(4, 3))})`,
                '',
                `![flat](${dataUrl('image/bmp', bmp(4, 0))})`,
                '',
                `![junk](${dataUrl('image/jpeg', jpeg([0x00]))})`,
                '',
                `![fill](${dataUrl('image/jpeg', jpeg([0xff, 0xff, ...sof(1, 1)]))})`,
                '',
                `![rst](${dataUrl('image/jpeg', jpeg([0xff, 0xd0, ...sof(1, 1)]))})`,
                '',
                `![short-jpeg](${dataUrl('image/jpeg', jpeg([0xff, 0xc0, 0x00, 0x01]))})`,
                '',
                `![app](${dataUrl('image/jpeg', jpeg([0xff, 0xe0, 0x00, 0x02], 10))})`,
                '',
                `![sos](${dataUrl('image/jpeg', jpeg([0xff, 0xda]))})`,
                '',
                `![flat-jpeg](${dataUrl('image/jpeg', jpeg(sof(0, 1)))})`,
                '',
                '- item',
                '',
                '-',
                '    - nested',
                '',
                '-',
                '    > quoted',
                '',
                '> Quoted words',
                '',
                '| a | b |',
                '| --- | --- |',
                '| c | d |',
                '',
                '---',
                '',
                '<div>block</div>',
                '',
                '[named]: https://example.com/named',
                '',
                fence('mermaid', 'png-ok'),
                '',
                fence('mermaid', 'png-garbage'),
                '',
                fence('mermaid', 'png-fail'),
                '',
                fence('mermaid', 'throw-error'),
                '',
                '# Beta',
                '',
                ...Array.from({ length: 70 }, (_, index) => `## Section ${index + 1}`),
                '',
                '#### Deep',
                '',
                '[^n]: note',
                '',
                '    # Inside',
                '',
                '# ',
                '',
                tall,
            ].join('\n'),
            (draft) => {
                draft.frontMatter.toc = true
                draft.frontMatter.tocDepth = 4
                draft.frontMatter.tocExcludeH1 = false
            }
        )
        expect(xml).toContain('w:leader="dot"')
        expect(xml).toContain('Alpha')
        expect(xml).toContain('Beta')
        expect(xml).toContain('Deep')
        expect(xml).toContain('Inside')
        expect(xml).toContain('nested')
        expect(xml).toContain('quoted')
    })

    it('writes contents page numbers as PAGEREF fields, counting pictures Word shows as alt text as one line', async () => {
        const toc = (draft: PdfExportProfile) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        }
        const relative = Array.from({ length: 12 }, (_, index) => [`![shot](./images/shot${index}.png)`, '']).flat()
        const linked = await render(['# Start', '', ...relative, '# End'].join('\n'), toc)
        // The contents is page 1. Twelve one-line alt texts fit on page 2 with both headings.
        expect(tocPage(linked.xml, 'start')).toBe(2)
        expect(tocPage(linked.xml, 'end')).toBe(2)
        // The number keeps the contents' styling, and the link still jumps to the heading.
        expect(runWith(linked.xml, '2')).toContain('<w:color w:val="404040"/>')
        expect(linked.xml).toContain('w:anchor="end"')

        // Real pictures still take their height: 12 at 480px don't fit on one page.
        const embedded = Array.from({ length: 12 }, (_, index) => [`![shot${index}](${dataUrl('image/png', sizedPng(640, 480))})`, '']).flat()
        const pictures = await render(['# Start', '', ...embedded, '# End'].join('\n'), toc)
        expect(tocPage(pictures.xml, 'start')).toBe(2)
        expect(tocPage(pictures.xml, 'end')).toBeGreaterThan(4)

        // Japanese characters are a full em wide, so the same number of them fills more than twice the lines.
        const paragraphs = (text: string) => Array.from({ length: 20 }, () => [text, '']).flat()
        const japanese = await render(['# Start', '', ...paragraphs('日本語の文章を書きます。'.repeat(25)), '# End'].join('\n'), toc)
        const latin = await render(['# Start', '', ...paragraphs('Latin text. '.repeat(25)), '# End'].join('\n'), toc)
        expect(tocPage(japanese.xml, 'end')).toBe(5)
        expect(tocPage(latin.xml, 'end')).toBe(3)
        // Emoji are one wide character each, not two narrow ones.
        const emoji = await render(['# Start', '', ...paragraphs('😀'.repeat(300)), '# End'].join('\n'), toc)
        expect(tocPage(emoji.xml, 'end')).toBe(5)

        // Long headings wrap in the contents and push later rows onto the next contents page.
        const long = Array.from({ length: 40 }, (_, index) => `## ${'Wrapped heading words '.repeat(6)}${index}`)
        const wrapped = await render(['# Start', '', ...long].join('\n'), toc)
        expect(tocPage(wrapped.xml, 'start')).toBe(3)
    })

    it('keeps the real side margins when a bar ignores them, so footnotes stay off the paper edge', async () => {
        const { xml } = await render('Body text[^1] here.\n\n| a |\n| --- |\n| cell |\n\n[^1]: The note.', (draft) => {
            draft.header.enabled = true
            draft.header.ignoreMargins = true
            draft.header.left.text = 'Head'
            draft.header.right.text = 'Tail'
        })
        // 10mm margins are 566 twips. The page keeps them, so footnotes and anything typed in Word sit inside them.
        expect(xml).toMatch(/<w:pgMar w:top="\d+" w:right="566" w:bottom="\d+" w:left="566" w:header="0"/)
        expect(xml).not.toMatch(/<w:pgMar[^>]*w:left="0"/)
        // Only the bar reaches the edge: as wide as the A4 sheet, pulled left by the margin.
        const bar = blockWith(xml, 'Head', '<w:tbl>')
        expect(bar).toContain('<w:tblW w:type="dxa" w:w="11905"/>')
        expect(bar).toContain('<w:tblInd w:type="dxa" w:w="-566"/>')
        // The bar's text still lines up with the body text.
        expect(blockWith(xml, 'Head')).toContain('w:left="566"')
        expect(blockWith(xml, 'Tail')).toContain('w:right="566"')
        // Body blocks need no made-up inset any more.
        expect(blockWith(xml, 'Body text')).not.toContain('<w:ind')
        expect(blockWith(xml, 'cell', '<w:tbl>')).not.toContain('w:tblInd')
        expect(blockWith(xml, 'The note.')).not.toContain('<w:ind')
    })

    it('keeps a footer in place on the edge-to-edge cover page, which has no side margins', async () => {
        const edit = (ignoreMargins: boolean) => (draft: PdfExportProfile) => {
            draft.frontMatter.titlePage = true
            draft.brand.logoIgnoreMargins = true
            draft.header.enabled = true
            draft.header.hideOnFirstPages = 'title'
            draft.footer.enabled = true
            draft.footer.hideOnFirstPages = 'none'
            draft.footer.ignoreMargins = ignoreMargins
            draft.footer.left.text = 'Foot'
        }
        const assets = { logoDataUrl: PNG_URL, header: { left: '', right: '' }, footer: { left: '', right: '' } }
        // A footer inside the margins is pushed in by the margin the cover page doesn't have.
        const inside = await render('# Alpha', edit(false), assets)
        expect(inside.xml).toMatch(/<w:pgMar w:top="0" w:right="0" w:bottom="\d+" w:left="0"/)
        expect(inside.xml).toContain('<w:tblW w:type="dxa" w:w="10773"/><w:tblInd w:type="dxa" w:w="566"/>')
        // A bleeding footer already starts at the edge there; elsewhere it is pulled out past the margin.
        const bleeding = await render('# Alpha', edit(true), assets)
        expect(bleeding.xml).toContain('<w:tblW w:type="dxa" w:w="11905"/><w:tblBorders>')
        expect(bleeding.xml).toContain('<w:tblW w:type="dxa" w:w="11905"/><w:tblInd w:type="dxa" w:w="-566"/>')
    })

    it('redraws SVG and WebP logos, bar images, and body images as PNG for Word', async () => {
        const canvases = stubImageDecoding()
        const svgLogo = dataUrl('image/svg+xml', new TextEncoder().encode(svgMarkup('width="200" height="50" viewBox="0 0 400 100"')))
        const svgIcon = `data:image/svg+xml,${encodeURIComponent(svgMarkup('viewBox="0 0 32 16"'))}`
        const webp = dataUrl('image/webp', WEBP)
        const { xml, names } = await render(
            ['# Alpha', '', `![chart](${svgIcon})`].join('\n'),
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.header.enabled = true
                draft.footer.enabled = true
            },
            { logoDataUrl: svgLogo, header: { left: svgIcon, right: '' }, footer: { left: webp, right: '' } }
        )
        // The logo keeps its own 200×50 size; it is drawn at 2x so it stays sharp.
        expect(canvases).toContainEqual({ width: 400, height: 100 })
        expect(drawingSize(xml, 'Logo')).toEqual({ width: 200, height: 50 })
        // The header icon is sized from its viewBox, the WebP from its pixels, both fitted into the bar.
        expect(drawingSize(xml, 'header left')).toEqual({ width: 32, height: 16 })
        expect(drawingSize(xml, 'footer left')).toEqual({ width: 37, height: 28 })
        expect(drawingSize(xml, 'chart')).toEqual({ width: 32, height: 16 })
        expect(names.filter((name) => name.startsWith('word/media/')).length).toBeGreaterThanOrEqual(3)
        expect(notifyWarning).not.toHaveBeenCalled()
    })

    it('says which Settings images were left out when they cannot be redrawn', async () => {
        const svgLogo = dataUrl('image/svg+xml', new TextEncoder().encode(svgMarkup('width="200" height="50"')))
        // No canvas here, so nothing can be redrawn.
        const { xml } = await render(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.brand.logoIgnoreMargins = true
                draft.header.enabled = true
            },
            { logoDataUrl: svgLogo, header: { left: svgLogo, right: svgLogo }, footer: { left: svgLogo, right: '' } }
        )
        expect(notifyWarning).toHaveBeenCalledTimes(1)
        expect(notifyWarning).toHaveBeenCalledWith("Some images aren't in the Word file", {
            description: "Couldn't add the title-page logo and header image. Try a PNG or JPEG file instead.",
        })
        // No cover image to run to the edge, so the title page keeps its margins and is centred.
        expect(xml).toContain('<w:vAlign w:val="center"/>')
        expect(xml).not.toContain('descr="Logo"')

        stubImageDecoding()
        await render(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.header.enabled = true
                draft.footer.enabled = true
            },
            {
                logoDataUrl: 'data:image/webp;base64,broken',
                header: { left: '', right: '' },
                footer: { left: '', right: 'data:image/webp;base64,broken' },
            }
        )
        expect(notifyWarning).toHaveBeenLastCalledWith("Some images aren't in the Word file", {
            description: "Couldn't add the title-page logo and footer image. Try a PNG or JPEG file instead.",
        })
    })

    it('places a bleeding cover against the paper when the bars change', async () => {
        const cover = (source: string, edit: (draft: PdfExportProfile) => void, logo = PNG_URL) =>
            render(source, edit, { logoDataUrl: logo, header: { left: '', right: '' }, footer: { left: '', right: '' } })

        const inline = await cover('# Alpha', (draft) => {
            draft.frontMatter.titlePage = true
            draft.brand.logoIgnoreMargins = true
            draft.header.enabled = true
            draft.header.hideOnFirstPages = 'title'
        })
        expect(inline.xml).toContain('Alpha')
        expect(inline.xml).toContain('descr="Logo"')

        const underHeader = await cover('# Alpha', (draft) => {
            draft.frontMatter.titlePage = true
            draft.brand.logoIgnoreMargins = true
            draft.header.enabled = true
            draft.header.hideOnFirstPages = 'none'
        })
        expect(underHeader.xml).toContain('Alpha')

        const sameChrome = await cover('# Alpha\n\n## Beta', (draft) => {
            draft.frontMatter.titlePage = true
            draft.frontMatter.toc = true
            draft.brand.logoIgnoreMargins = true
            draft.header.enabled = true
            draft.header.hideOnFirstPages = 'title+toc'
            draft.footer.enabled = true
            draft.footer.hideOnFirstPages = 'title+toc'
        })
        expect(sameChrome.xml).toContain('wp:align>top</wp:align>')

        const footerOnly = await cover('# Alpha\n\n## Beta', (draft) => {
            draft.frontMatter.titlePage = true
            draft.frontMatter.toc = true
            draft.brand.logoIgnoreMargins = true
            draft.header.enabled = true
            draft.header.hideOnFirstPages = 'title+toc'
            draft.footer.enabled = true
            draft.footer.hideOnFirstPages = 'title'
        })
        expect(footerOnly.xml).toContain('w:anchor="beta"')

        const wide = await cover(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.brand.logoIgnoreMargins = true
            },
            WIDE_PNG_URL
        )
        expect(wide.xml).toContain('descr="Logo"')

        const unknown = await cover(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
            },
            'data:image/png,hello'
        )
        expect(unknown.xml).toContain('Alpha')

        const sizeless = await cover(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
            },
            SHORT_PNG_URL
        )
        expect(sizeless.xml).toContain('Alpha')
    })

    it('crops a bleeding cover when the picture is taller than the page', async () => {
        const edit = (draft: PdfExportProfile) => {
            draft.frontMatter.titlePage = true
            draft.brand.logoIgnoreMargins = true
        }
        for (const mode of ['ok', 'no-context', 'no-blob', 'throw'] as const) {
            stubCoverCanvas(mode)
            const logo = mode === 'ok' ? PNG_URL : JPG_URL
            const { xml } = await render('# Alpha', edit, { logoDataUrl: logo, header: { left: '', right: '' }, footer: { left: '', right: '' } })
            expect(xml).toContain('Alpha')
        }
    })
})

const WEBP = Uint8Array.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')])

function svgMarkup(attributes: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="10" height="10"/></svg>`
}

/** Fake `<img>` and canvas. Every picture is 640×480; `broken` data fails to load. Each canvas hands back a PNG of its own size. */
function stubImageDecoding() {
    const canvases: { width: number; height: number }[] = []
    class FakeImage {
        naturalWidth = 0
        naturalHeight = 0
        onload: (() => void) | null = null
        onerror: (() => void) | null = null
        set src(value: string) {
            queueMicrotask(() => {
                if (value.includes('broken')) return this.onerror?.()
                this.naturalWidth = 640
                this.naturalHeight = 480
                this.onload?.()
            })
        }
    }
    vi.stubGlobal('Image', FakeImage)
    vi.stubGlobal('document', {
        createElement() {
            const canvas = {
                width: 0,
                height: 0,
                getContext: () => ({ drawImage() {} }),
                toBlob(callback: (blob: Blob | null) => void) {
                    canvases.push({ width: canvas.width, height: canvas.height })
                    callback(new Blob([Uint8Array.from(sizedPng(canvas.width, canvas.height))]))
                },
            }
            return canvas
        },
    })
    return canvases
}

function stubCoverCanvas(mode: 'ok' | 'no-context' | 'no-blob' | 'throw') {
    vi.stubGlobal('createImageBitmap', async () => {
        if (mode === 'throw') throw new Error('bitmap failed')
        return { close() {} }
    })
    vi.stubGlobal('document', {
        createElement() {
            return {
                width: 0,
                height: 0,
                getContext() {
                    if (mode === 'no-context') return null
                    return { drawImage() {} }
                },
                toBlob(callback: (blob: Blob | null) => void) {
                    callback(mode === 'no-blob' ? null : new Blob([PNG]))
                },
            }
        },
    })
}

type StubContext = { font: string; fillStyle: string; textAlign: string; textBaseline: string; filled: string[] }

/** Fake canvas for the watermark. Text measures 80px a character at the 128px font size. */
function stubDocument(mode: 'png' | 'no-context' | 'no-blob') {
    const canvases: { width: number; height: number; ctx: StubContext }[] = []
    vi.stubGlobal('document', {
        createElement() {
            const ctx: StubContext & Record<string, unknown> = {
                font: '',
                fillStyle: '',
                textAlign: '',
                textBaseline: '',
                filled: [],
                translate() {},
                rotate() {},
                scale() {},
                measureText: (text: string) => ({ width: text.length * 80 }),
                fillText(text: string) {
                    ctx.filled.push(text)
                },
            }
            const canvas = {
                width: 0,
                height: 0,
                ctx,
                getContext() {
                    if (mode === 'no-context') return null
                    return ctx
                },
                toBlob(callback: (blob: Blob | null) => void) {
                    callback(mode === 'no-blob' ? null : new Blob([PNG]))
                },
            }
            canvases.push(canvas)
            return canvas
        },
    })
    return canvases
}
