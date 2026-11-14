import { inflateRawSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildExportDocument } from '@/lib/markdown/export-document'
import { createDefaultPdfExportProfile } from '@/lib/settings/pdf-export-defaults'
import type { PdfExportProfile, PdfExportResolvedAssets } from '@/lib/settings/pdf-export-types'

const renderMermaidDiagramForExport = vi.hoisted(() =>
    vi.fn((source: string) => {
        if (source.includes('throw-error')) throw new Error('diagram broke')
        if (source.includes('throw-string')) throw 'diagram string'
        if (source.includes('throw-lines')) throw new Error('Pies are not drawn yet. Scrivon can draw:\n• Flowcharts\r\n• Sequence diagrams')
        // As the real renderer does: the preview card's help.
        if (source.startsWith('pie')) throw new Error("Pie charts aren't supported yet. Scrivon can draw:\n• Flowcharts (flowchart TD or graph LR)")
        // The size of the 1×1 PNG svgToPngBlob hands back.
        return `<svg viewBox="0 0 1 1">${source}</svg>`
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

const XML_NAME = '[A-Za-z_][\\w.-]*(?::[A-Za-z_][\\w.-]*)?'
/** One piece of markup starting at a `<`: a declaration, comment, CDATA, end tag, or start tag with quoted attributes. */
const XML_MARKUP = new RegExp(
    `<\\?[\\s\\S]*?\\?>|<!--[\\s\\S]*?-->|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|</(${XML_NAME})\\s*>|<(${XML_NAME})((?:\\s+${XML_NAME}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`,
    'y'
)
const XML_ATTRIBUTE = new RegExp(`(${XML_NAME})\\s*=`, 'g')

/**
 * Throws unless `xml` is well-formed, as Word requires before it opens a file: only characters XML allows,
 * no stray `&` or `<`, quoted attributes given once, tags that close in order, declared prefixes, and one root.
 */
function assertWellFormed(part: string, xml: string): void {
    const problem = (what: string, at: number) => new Error(`${part}: ${what} near ${JSON.stringify(xml.slice(Math.max(0, at - 60), at + 60))}`)
    const illegal = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u.exec(xml)
    if (illegal) throw problem('a character XML forbids', illegal.index)
    const entity = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.exec(xml)
    if (entity) throw problem('an & that starts no entity', entity.index)
    const open: { name: string; prefixes: Set<string> }[] = []
    let roots = 0
    let end = 0
    for (let at = xml.indexOf('<'); at >= 0; at = xml.indexOf('<', end)) {
        if (open.length === 0 && xml.slice(end, at).trim()) throw problem('text outside the root element', end)
        XML_MARKUP.lastIndex = at
        const match = XML_MARKUP.exec(xml)
        if (!match) throw problem('a broken tag', at)
        end = XML_MARKUP.lastIndex
        const [, closing, name, attributes = '', selfClosing] = match
        if (closing) {
            if (open.pop()?.name !== closing) throw problem(`</${closing}> closes the wrong element`, at)
        } else if (name) {
            if (open.length === 0) roots += 1
            if (roots > 1) throw problem('a second root element', at)
            const prefixes = new Set(open.at(-1)?.prefixes ?? ['xml'])
            const names = [...attributes.matchAll(XML_ATTRIBUTE)].map((attribute) => attribute[1]!)
            if (new Set(names).size !== names.length) throw problem('an attribute given twice', at)
            for (const attribute of names) if (attribute.startsWith('xmlns:')) prefixes.add(attribute.slice(6))
            for (const qualified of [name, ...names]) {
                const prefix = qualified.includes(':') ? qualified.split(':')[0]! : null
                if (prefix && prefix !== 'xmlns' && !prefixes.has(prefix)) throw problem(`the undeclared prefix ${prefix}`, at)
            }
            if (!selfClosing) open.push({ name, prefixes })
        }
    }
    if (open.length > 0) throw problem(`<${open.at(-1)!.name}> never closed`, xml.length)
    if (xml.slice(end).trim()) throw problem('text outside the root element', end)
    if (roots !== 1) throw problem('no root element', 0)
}

/**
 * The relationship ids (`r:id`, `r:embed`, `r:link`) parts use that their own `.rels` file doesn't define, as
 * `part: id`. Word reports a file with one as unreadable content and offers to repair it.
 */
function danglingRelationships(parts: Record<string, string>): string[] {
    const dangling: string[] = []
    for (const [name, xml] of Object.entries(parts)) {
        if (!name.endsWith('.xml')) continue
        const slash = name.lastIndexOf('/') + 1
        const rels = parts[`${name.slice(0, slash)}_rels/${name.slice(slash)}.rels`] ?? ''
        const ids = new Set([...rels.matchAll(/\bId="([^"]+)"/g)].map((match) => match[1]))
        for (const [, id] of xml.matchAll(/\br:(?:id|embed|link)="([^"]*)"/g)) if (!ids.has(id)) dangling.push(`${name}: ${id}`)
    }
    return dangling
}

/**
 * Unzips a .docx. Every XML part is checked with {@link assertWellFormed}, and every relationship id it uses with
 * {@link danglingRelationships}, so each test also checks Word can open the file.
 */
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
            assertWellFormed(name, parts[name])
            xml.push(parts[name])
        }
        offset = start + compressed
    }
    expect(danglingRelationships(parts)).toEqual([])
    return { xml: xml.join('\n'), names, parts }
}

/** The pictures in the package, without the folder entry. */
function mediaFiles(names: string[]): string[] {
    return names.filter((name) => name.startsWith('word/media/') && !name.endsWith('/'))
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

/** The page number the contents row for `heading` shows: the stored result of its PAGEREF field. */
function tocPage(xml: string, heading: string): number | null {
    const row = [...xml.matchAll(/<w:hyperlink [^>]*>([\s\S]*?)<\/w:hyperlink>/g)].find((link) => link[1]!.includes(`>${heading}</w:t>`))
    const field = row
        ? /<w:instrText>PAGEREF \S+ \\h<\/w:instrText><w:fldChar w:fldCharType="separate"\/><w:t xml:space="preserve">(\d+)<\/w:t><w:fldChar w:fldCharType="end"\/>/.exec(
              row[1]!
          )
        : null
    return field ? Number(field[1]) : null
}

/** Each heading bookmark in the document part, in order: its name and its number. */
function bookmarks(xml: string): { name: string; id: string }[] {
    return [...xml.matchAll(/<w:bookmarkStart w:name="([^"]+)" w:id="(\d+)"\/>/g)].map(([, name, id]) => ({ name: name!, id: id! }))
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
    const { bytes, diagramsNotDrawn } = await renderExportDocx(buildExportDocument(source, { profile: profile(edit), tabName: 'notes.md', assets }))
    return { ...readDocx(bytes), diagramsNotDrawn }
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

    it('checks every part is well-formed XML, so a file Word would refuse fails the tests', () => {
        for (const broken of [
            '<a><b></a>',
            '<a>bell\u0007</a>',
            '<a>half \ud83d pair</a>',
            '<a>R&D</a>',
            '<a>x < y</a>',
            '<a x="1" x="2"/>',
            '<a x=1/>',
            '<w:a/>',
            '<a/><b/>',
            'text<a/>',
            '<a>',
        ]) {
            expect(() => assertWellFormed('test.xml', broken), broken).toThrow()
        }
        expect(() =>
            assertWellFormed('test.xml', '<?xml version="1.0"?>\n<w:a xmlns:w="x" w:b="&amp;&#10;"><!-- c --><w:c/>2 &gt; 1 😀</w:a>')
        ).not.toThrow()
    })

    it('finds relationship ids that no .rels file defines', () => {
        expect(
            danglingRelationships({
                'word/document.xml': '<w:hyperlink r:id="rId1"/><a:hlinkClick r:id="rId9"/><a:blip r:embed="rId2"/>',
                'word/_rels/document.xml.rels': '<Relationship Id="rId1"/><Relationship Id="rId2"/>',
                'word/footnotes.xml': '<w:hyperlink r:id="rId1"/>',
            })
        ).toEqual(['word/document.xml: rId9', 'word/footnotes.xml: rId1'])
    })

    it('writes the body: marks, links, images, lists, tables, code, diagrams, and notes', async () => {
        const { xml, names, parts } = await render(RICH)
        const body = parts['word/document.xml']!
        expect(xml).toContain('Paragraph with ')
        expect(xml).toContain('bold')
        expect(xml).toContain('https://example.com')
        expect(xml).toContain('https://example.com/named')
        // The link to #alpha goes to the Alpha heading's bookmark.
        expect(xml).toContain('w:anchor="_Ref1"')
        expect(blockWith(body, 'Alpha')).toContain('<w:bookmarkStart w:name="_Ref1" w:id="1"/>')
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
        // Raw HTML shows its words, as in the PDF, but never its tags.
        expect(xml).not.toContain('&lt;div&gt;')
        expect(xml).not.toContain('&lt;span&gt;')
        expect(xml).toContain('>block</w:t>')
        expect(xml).toContain('>raw</w:t>')
        expect(runWith(body, 'Paragraph with ')).toContain('w:ascii="Segoe UI"')
        // The default mono stack starts with Mac-only fonts. Windows has neither, so Word gets Consolas.
        expect(runWith(body, 'const value = 1')).toContain('w:ascii="Consolas"')
        expect(xml).not.toContain('Menlo')
        expect(blockWith(body, 'const value = 1')).toContain('w:fill="F6F8FA"')
        // Heading runs carry their own size. A body-sized run was flattening every level.
        expect(runWith(body, 'Alpha')).toContain('<w:sz w:val="36"/>')
        expect(runWith(body, 'Beta')).toContain('<w:sz w:val="30"/>')
        expect(runWith(body, 'Gamma')).toContain('<w:sz w:val="27"/>')
        // Markers hang inside the text column. left equals hanging, so the bullet sits on the content edge.
        expect(blockWith(body, 'bullet')).toContain('<w:ind w:left="360" w:hanging="360"/>')
        // Table cells have the PDF's 0.5rem × 0.75rem padding.
        expect(blockWith(body, 'a', '<w:tc>')).toContain(
            '<w:tcMar><w:top w:type="dxa" w:w="120"/><w:left w:type="dxa" w:w="180"/><w:bottom w:type="dxa" w:w="120"/><w:right w:type="dxa" w:w="180"/></w:tcMar>'
        )
        expect(body).not.toContain('w:val="both"')
        expect(mediaFiles(names).length).toBeGreaterThan(0)
        expect(svgToPngBlob).toHaveBeenCalled()
        expect(body).not.toContain('w:val="nextPage"')
        // Line height is a multiple of the font size (11pt × 1.6 = 352 twips), the same box the PDF uses.
        expect(blockWith(body, 'Paragraph with ')).toContain('<w:spacing w:after="120" w:line="352" w:lineRule="atLeast"/>')
        expect(blockWith(body, 'Alpha')).toMatch(/w:line="576" w:lineRule="atLeast"/)
    })

    it('starts each ordered list at its own number, even when a paragraph splits them', async () => {
        const { parts } = await render('1. one\n2. two\n\nBetween lists.\n\n3. three\n4. four\n\n- dot')
        const body = parts['word/document.xml']!
        const numbering = parts['word/numbering.xml']!
        const numId = (text: string) => /<w:numId w:val="(\d+)"\/>/.exec(blockWith(body, text))?.[1]
        /** The number a list's first item shows, from its w:num's start override. */
        const start = (id: string | undefined) =>
            new RegExp(`<w:num w:numId="${id}">[\\s\\S]*?<w:startOverride w:val="(\\d+)"/>`).exec(numbering)?.[1]
        expect(numId('two')).toBe(numId('one'))
        expect(numId('four')).toBe(numId('three'))
        expect(numId('three')).not.toBe(numId('one'))
        expect(start(numId('one'))).toBe('1')
        // "3." keeps its number instead of carrying on from the first list or restarting at 1.
        expect(start(numId('three'))).toBe('3')
        expect(blockWith(body, 'Between lists.')).not.toContain('<w:numPr>')
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

    it('shows pictures at their own size, shrunk only to fit the text width and the page', async () => {
        const toc = (draft: PdfExportProfile) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        }
        const picture = (alt: string, width: number, height: number) => `![${alt}](${dataUrl('image/png', sizedPng(width, height))})`
        const { xml } = await render(
            ['# Start', '', picture('wide', 1000, 500), '', picture('small', 300, 100), '', picture('tall', 400, 2000), '', '# End'].join('\n'),
            toc
        )
        // Not the old fixed 640×480 box: the 718px text width and the 1039px page height, as the PDF has no smaller cap.
        expect(drawingSize(xml, 'wide')).toEqual({ width: 718, height: 359 })
        expect(drawingSize(xml, 'small')).toEqual({ width: 300, height: 100 })
        expect(drawingSize(xml, 'tall')).toEqual({ width: 208, height: 1039 })
        // The contents estimate measures them the same way: the full-page picture takes page 3, so End is on page 4.
        expect(tocPage(xml, 'Start')).toBe(2)
        expect(tocPage(xml, 'End')).toBe(4)
    })

    it('fits pictures in list items to the width left beside the list, so they stay inside the margin (N39)', async () => {
        const wide = (alt: string) => `![${alt}](${dataUrl('image/png', sizedPng(2000, 500))})`
        const { xml } = await render(
            [
                `- ${wide('top')}`,
                '    - nested',
                '',
                `        ${wide('nested')}`,
                '',
                '1. Click Settings',
                '',
                `   ${wide('step')}`,
                '',
                `> - ${wide('quoted')}`,
            ].join('\n')
        )
        // The 718px text width less the list's step in: 24px at the top level, 48px one list in.
        expect(drawingSize(xml, 'top')?.width).toBe(694)
        expect(drawingSize(xml, 'nested')?.width).toBe(670)
        expect(drawingSize(xml, 'step')?.width).toBe(694)
        // In a quote, the quote's 16px step too.
        expect(drawingSize(xml, 'quoted')?.width).toBe(678)
    })

    it('estimates contents page numbers with a diagram in a list at the width it is drawn', async () => {
        renderMermaidDiagramForExport.mockImplementationOnce(() => '<svg viewBox="0 0 1436 2000"></svg>')
        svgToPngBlob.mockImplementationOnce(async () => new Blob([Uint8Array.from(sizedPng(2872, 4000))]))
        const { xml } = await render(['# Start', '', '- item', '', '  ```mermaid', '  graph TD', '  ```', '', '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        // In the list it is 694px wide, so 967px tall, not the 1000px it would be at the full 718px.
        expect(drawingSize(xml, 'Flowchart')).toEqual({ width: 694, height: 967 })
        // It doesn't fit under the first lines, so it starts page 3, and End still fits below it there.
        expect(tocPage(xml, 'End')).toBe(3)
    })

    it('says a diagram with nothing to draw yet is empty, as the PDF does, instead of printing its source (U39)', async () => {
        // Just `graph TD` renders without error to a 0×0 picture.
        renderMermaidDiagramForExport.mockImplementationOnce(() => '<svg viewBox="0 0 0 0" width="0" height="0"></svg>')
        svgToPngBlob.mockClear()
        const { parts } = await render(['Before.', '', fence('mermaid', 'graph TD'), '', 'After.'].join('\n'))
        const body = parts['word/document.xml']!
        expect(runWith(body, 'Empty diagram: there is nothing to draw yet.')).toContain('w:ascii="Consolas"')
        expect(body).not.toContain('graph TD')
        expect(body).not.toContain('<w:drawing>')
        expect(svgToPngBlob).not.toHaveBeenCalled()
    })

    it("writes a diagram type Scrivon can't draw as a short note for readers and its source, not the preview's help", async () => {
        const { parts, diagramsNotDrawn } = await render(['Before.', '', fence('mermaid', 'pie\n  "Dogs" : 3'), '', 'After.'].join('\n'))
        const body = parts['word/document.xml']!
        const note = blockWith(body, 'Pie chart: not supported in Scrivon yet')
        expect(note).toContain('<w:i/>')
        // It stays on the page with the code under it.
        expect(note).toContain('<w:keepNext/>')
        // The diagram's data still reaches the reader, as a code block.
        expect(runWith(body, 'pie')).toContain('w:ascii="Consolas"')
        expect(runWith(body, '  &quot;Dogs&quot; : 3')).toContain('w:ascii="Consolas"')
        expect(body).not.toContain('Scrivon can draw')
        expect(body).not.toContain('<w:drawing>')
        expect(diagramsNotDrawn).toBe(1)
    })

    it('counts the diagrams it could not draw: errors, empty ones, pictures that failed and types it does not support', async () => {
        const draw = renderMermaidDiagramForExport.getMockImplementation()!
        // Nothing to draw yet renders a 0×0 picture.
        renderMermaidDiagramForExport.mockImplementation((source) =>
            source === 'empty' ? '<svg viewBox="0 0 0 0" width="0" height="0"></svg>' : draw(source)
        )
        try {
            const source = ['png-ok', 'throw-error', 'empty', 'png-fail', 'pie\n  "Dogs" : 3'].map((text) => fence('mermaid', text)).join('\n\n')
            expect((await render(source)).diagramsNotDrawn).toBe(4)
            expect((await render(fence('js', 'const a = 1'))).diagramsNotDrawn).toBe(0)
        } finally {
            renderMermaidDiagramForExport.mockImplementation(draw)
        }
    })

    it('writes each line of a diagram error on a line of its own, as Word ignores line breaks inside a run', async () => {
        const { parts } = await render(['Before.', '', fence('mermaid', 'throw-lines'), '', 'After.'].join('\n'))
        const paragraph = blockWith(parts['word/document.xml']!, '• Sequence diagrams')
        const texts = [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|<w:br\/>/g)].map((match) => match[1] ?? 'BREAK')
        expect(texts).toEqual(['Pies are not drawn yet. Scrivon can draw:', 'BREAK', '• Flowcharts', 'BREAK'])
        expect(runWith(parts['word/document.xml']!, '• Flowcharts')).toContain('w:ascii="Consolas"')
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
        // The renderer leaves the accTitle and accDescr lines out itself (lib/mermaid/accessibility.test.ts), the same
        // way for the preview, the PDF and Word, so Word hands it the diagram as written rather than stripping it twice.
        expect(renderMermaidDiagramForExport).toHaveBeenCalledWith(
            'flowchart TD\n  accTitle: Login flow\n  accDescr: How a user signs in\n  A --> B',
            expect.anything()
        )
        expect(xml).toContain('name="Sequence diagram" descr="Sequence diagram: Alice, Bob"')
        // No alt text in the Markdown means none in Word too, as with the PDF's alt="", not the word 'image'. docx 9.15+
        // leaves an empty descr out, which the Word format reads as descr="".
        expect(xml).toMatch(/<wp:docPr id="\d+" name="Picture"(?: descr="")?\/>/)
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

    it('scales headings, code, the title and Contents with the Body size, as the PDF em sizes do', async () => {
        const source = [
            '---',
            'title: Report',
            '---',
            '',
            ...[1, 2, 3, 4, 5, 6].flatMap((depth) => [`${'#'.repeat(depth)} H${depth}`, '']),
            fence('js', 'code line'),
        ].join('\n')
        const sizes = async (bodySizePt: number) => {
            const { parts } = await render(source, (draft) => {
                draft.typography.bodySizePt = bodySizePt
                draft.frontMatter.titlePage = true
                draft.frontMatter.toc = true
                draft.frontMatter.tocExcludeH1 = false
            })
            const body = parts['word/document.xml']!
            const styles = parts['word/styles.xml']!
            const size = (xml: string) => Number(/<w:sz w:val="(\d+)"\/>/.exec(xml)?.[1])
            const headingStyle = (depth: number) =>
                size(new RegExp(`<w:style [^>]*w:styleId="Heading${depth}"[\\s\\S]*?</w:style>`).exec(styles)?.[0] ?? '')
            // The body heading is the last run with its words; the first is its Contents entry.
            const bodyHeading = (depth: number) => {
                const end = body.lastIndexOf(`>H${depth}</w:t>`)
                return size(body.slice(body.lastIndexOf('<w:r>', end), end))
            }
            return {
                headings: [1, 2, 3, 4, 5, 6].map((depth) => bodyHeading(depth)),
                styles: [1, 2, 3, 4, 5, 6].map((depth) => headingStyle(depth)),
                code: size(runWith(body, 'code line')),
                title: size(runWith(body, 'Report')),
                contents: size(runWith(body, 'Contents')),
            }
        }
        // The 11pt default keeps the sizes it always had.
        expect(await sizes(11)).toEqual({ headings: [36, 30, 27, 24, 22, 20], styles: [36, 30, 27, 24, 22, 20], code: 18, title: 48, contents: 40 })
        // At 16pt (32 half-points) headings grow with the text, so an h4 is no longer smaller than the paragraphs.
        const large = await sizes(16)
        expect(large).toEqual({ headings: [52, 44, 39, 35, 32, 29], styles: [52, 44, 39, 35, 32, 29], code: 26, title: 70, contents: 58 })
        for (const size of large.headings.slice(0, 4)) expect(size).toBeGreaterThan(32)
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

        // Settings save system font names quoted and escaped: the escapes go, and a comma inside the quotes stays.
        const quoted = await render('Some `code`.', (draft) => {
            draft.typography.monoFont = String.raw`"Odd \"Quote\" Font", monospace`
        })
        expect(runWith(quoted.xml, 'code')).toContain('w:ascii="Odd &quot;Quote&quot; Font"')
        expect(quoted.parts['word/fontTable.xml']).toContain('<w:font w:name="Odd &quot;Quote&quot; Font">')
        expect(quoted.xml).not.toContain('\\')
        const comma = await render('Some `code`.', (draft) => {
            draft.typography.monoFont = '"A, B Mono", monospace'
        })
        expect(runWith(comma.xml, 'code')).toContain('w:ascii="A, B Mono"')
        expect(comma.parts['word/fontTable.xml']).toContain('<w:font w:name="A, B Mono">')
    })

    it('gives Chinese, Japanese and Korean text a font that has their characters', async () => {
        const japanese = await render(
            ['# 見出し', '', '日本語の文章です。', '', 'Code `コード`.', '', fence('js', 'const 名前 = 1')].join('\n'),
            (draft) => {
                draft.header.enabled = true
                draft.header.left.text = 'ヘッダー'
            }
        )
        const fonts = (font: string) => `<w:rFonts w:ascii="${font}" w:cs="${font}" w:eastAsia="Yu Gothic" w:hAnsi="${font}"/>`
        // Latin text keeps the profile's font; only the East Asian slot changes.
        expect(runWith(japanese.xml, '日本語の文章です。')).toContain(fonts('Segoe UI'))
        expect(runWith(japanese.xml, '見出し')).toContain(fonts('Segoe UI'))
        expect(runWith(japanese.xml, 'コード')).toContain(fonts('Consolas'))
        expect(runWith(japanese.xml, 'const 名前 = 1')).toContain(fonts('Consolas'))
        expect(runWith(japanese.parts['word/header1.xml']!, 'ヘッダー')).toContain(fonts('Segoe UI'))
        expect(japanese.parts['word/styles.xml']).toContain(fonts('Segoe UI'))
        // Word swaps in another Japanese font if Yu Gothic is missing.
        expect(japanese.parts['word/fontTable.xml']).toContain('<w:font w:name="Yu Gothic"><w:charset w:val="80"/>')

        const korean = await render('한국어 문장입니다. 漢字도 있어요.')
        expect(runWith(korean.xml, '한국어 문장입니다. 漢字도 있어요.')).toContain('w:eastAsia="Malgun Gothic"')
        expect(korean.parts['word/fontTable.xml']).toContain('<w:charset w:val="81"/>')

        const chinese = await render('中文段落。')
        expect(runWith(chinese.xml, '中文段落。')).toContain('w:eastAsia="Microsoft YaHei"')

        // With no East Asian text, the slot is left to Word, and a comment in Japanese doesn't count.
        const latin = await render('Plain words.\n\n<!-- 日本語 -->')
        expect(latin.xml).not.toContain('w:eastAsia')
        expect(latin.parts['word/fontTable.xml']).not.toContain('w:charset')
    })

    it("tags the document with its language and takes the East Asian font from it, so Traditional Chinese isn't Simplified", async () => {
        const language = (parts: Record<string, string>) => /<w:docDefaults>[\s\S]*?(<w:lang [^>]*\/>)/.exec(parts['word/styles.xml']!)?.[1]

        const traditional = await render('---\nlang: zh-TW\n---\n\n中文段落。')
        expect(language(traditional.parts)).toBe('<w:lang w:val="zh-TW" w:eastAsia="zh-TW"/>')
        expect(runWith(traditional.xml, '中文段落。')).toContain('w:eastAsia="Microsoft JhengHei"')
        expect(traditional.parts['word/fontTable.xml']).toContain('<w:font w:name="Microsoft JhengHei"><w:charset w:val="88"/>')
        expect(traditional.xml).not.toContain('Microsoft YaHei')
        // A Chinese font the profile picks still wins over the language's.
        const picked = await render('---\nlang: zh-Hant\n---\n\n中文段落。', (draft) => {
            draft.typography.bodyFont = 'PMingLiU, serif'
        })
        expect(runWith(picked.xml, '中文段落。')).toContain('w:eastAsia="PMingLiU"')

        // One katakana in Chinese text no longer makes it Japanese, whether the language is guessed or not.
        const chinese = await render('这是一个中文段落，里面只有一个片假名ツ。')
        expect(runWith(chinese.xml, '这是一个中文段落，里面只有一个片假名ツ。')).toContain('w:eastAsia="Microsoft YaHei"')
        const quoted = 'This English paragraph quotes 这是一个很长的中文句子 once, with a stray ツ in it.'
        const english = await render(quoted)
        expect(runWith(english.xml, quoted)).toContain('w:eastAsia="Microsoft YaHei"')

        // A guess of `en` only means no other script leads, so Word keeps the reader's own language: a German
        // document isn't spell-checked as English. A language the front matter names is always written.
        expect(language(english.parts)).toBeUndefined()
        expect(language((await render('Ein deutscher Absatz über Größe.')).parts)).toBeUndefined()
        expect(language((await render('---\nlang: en\n---\n\nPlain words.')).parts)).toBe('<w:lang w:val="en"/>')
        expect(language((await render('---\nlang: de-DE\n---\n\nEin Absatz.')).parts)).toBe('<w:lang w:val="de-DE"/>')

        const japanese = await render('---\nlang: ja\n---\n\n日本語の文章です。')
        expect(language(japanese.parts)).toBe('<w:lang w:val="ja" w:eastAsia="ja"/>')
        expect(runWith(japanese.xml, '日本語の文章です。')).toContain('w:eastAsia="Yu Gothic"')

        const hebrew = await render('שלום עולם, זה מסמך בעברית.')
        expect(language(hebrew.parts)).toBe('<w:lang w:val="he" w:bidi="he"/>')
    })

    it('keeps a Chinese, Japanese or Korean font the profile picks, as the PDF does', async () => {
        const japanese = await render('# 見出し\n\n日本語の文章です。', (draft) => {
            draft.typography.bodyFont = '"Meiryo", sans-serif'
            draft.typography.headingFont = '"Segoe UI", "Yu Mincho", serif'
        })
        expect(runWith(japanese.xml, '日本語の文章です。')).toContain(
            '<w:rFonts w:ascii="Meiryo" w:cs="Meiryo" w:eastAsia="Meiryo" w:hAnsi="Meiryo"/>'
        )
        // Latin text takes the first font; Japanese the first Japanese one, as the browser picks per character.
        expect(runWith(japanese.xml, '見出し')).toContain('w:ascii="Segoe UI" w:cs="Segoe UI" w:eastAsia="Yu Mincho"')
        // Code names no Japanese font, so it gets the Windows one for the script.
        const fontTable = japanese.parts['word/fontTable.xml']!
        expect(fontTable).toContain('<w:font w:name="Meiryo"><w:charset w:val="80"/>')
        expect(fontTable).toContain('<w:font w:name="Yu Mincho"><w:charset w:val="80"/>')
        expect(fontTable).toContain('<w:font w:name="Yu Gothic"><w:charset w:val="80"/>')

        const chinese = await render('中文段落。', (draft) => {
            draft.typography.bodyFont = 'SimSun, serif'
        })
        expect(runWith(chinese.xml, '中文段落。')).toContain('w:eastAsia="SimSun"')
        expect(chinese.parts['word/fontTable.xml']).toContain('<w:font w:name="SimSun"><w:charset w:val="86"/>')

        // A name in Hangul is a Korean font; a name with no script takes the document's.
        const korean = await render('한국어 문장입니다.', (draft) => {
            draft.typography.bodyFont = '"맑은 고딕", sans-serif'
            draft.typography.headingFont = '"Source Han Sans", sans-serif'
        })
        expect(runWith(korean.xml, '한국어 문장입니다.')).toContain('w:eastAsia="맑은 고딕"')
        expect(korean.parts['word/fontTable.xml']).toContain('<w:font w:name="맑은 고딕"><w:charset w:val="81"/>')
        expect(korean.parts['word/fontTable.xml']).toContain('<w:font w:name="Source Han Sans"><w:charset w:val="81"/>')

        // A Japanese code font is listed once, fixed-pitch with its charset, and kept with no Japanese text.
        const code = await render('Some `code`.', (draft) => {
            draft.typography.monoFont = '"MS Gothic", monospace'
        })
        expect(runWith(code.xml, 'code')).toContain('w:eastAsia="MS Gothic"')
        expect(code.parts['word/fontTable.xml']!.match(/w:name="MS Gothic"/g)).toHaveLength(1)
        expect(code.parts['word/fontTable.xml']).toContain(
            '<w:font w:name="MS Gothic"><w:charset w:val="80"/><w:family w:val="modern"/><w:pitch w:val="fixed"/></w:font>'
        )
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
                '> ## quote-heading',
                '>',
                '> | quote-head |',
                '> | --- |',
                '> | quote-cell |',
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
        // A heading keeps its colour but is italic, as quote text is.
        expect(blockWith(xml, 'quote-heading')).toContain(bar)
        expect(runWith(xml, 'quote-heading')).toContain('<w:i/>')
        expect(runWith(xml, 'quote-heading')).toContain('<w:color w:val="262626"/>')
        // A table's left edge is the bar, moved out to where the bar runs beside the text (240 - 220 - 15 twips).
        const quoteTable = blockWith(xml, 'quote-cell', '<w:tbl>')
        expect(quoteTable).toContain('<w:tblInd w:type="dxa" w:w="5"/>')
        const accentEdge = '<w:left w:val="single" w:color="262626" w:sz="12"/>'
        expect(blockWith(xml, 'quote-head', '<w:tc>')).toContain(accentEdge)
        expect(blockWith(xml, 'quote-cell', '<w:tc>')).toContain(accentEdge)
        // Its text is grey and italic, and the header row stays bold.
        expect(runWith(xml, 'quote-cell')).toContain('<w:i/>')
        expect(runWith(xml, 'quote-cell')).toContain('<w:color w:val="525252"/>')
        expect(runWith(xml, 'quote-head')).toContain('<w:b/>')
        expect(runWith(xml, 'quote-head')).toContain('<w:i/>')
        // Outside a quote the table keeps its plain grid.
        expect(blockWith(xml, 'list-cell', '<w:tc>')).not.toContain(accentEdge)
        expect(runWith(xml, 'list-cell')).not.toContain('<w:i/>')
        // A nested quote steps in again instead of sitting on its parent's line.
        expect(blockWith(xml, 'inner-quote')).toContain('w:left="480"')
        expect(blockWith(xml, 'inner-quote')).toContain(bar)
    })

    it('leaves HTML tags, comments and scripts out of the Word file but keeps the words, as the PDF does', async () => {
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
                '',
                '<script>',
                'stealCookies()',
                '</script>',
                '',
                '<style>p { color: red }</style>',
            ].join('\n')
        )
        expect(xml).not.toContain('pricing')
        expect(xml).not.toContain('secret')
        expect(xml).not.toContain('stealCookies')
        expect(xml).not.toContain('color: red')
        expect(xml).not.toContain('&lt;')
        // The words around and between tags stay, and <br> still breaks the line in the cell.
        expect(xml).toContain('>Ctrl</w:t>')
        expect(xml).toContain('>Hidden body.</w:t>')
        expect(blockWith(xml, 'split')).toContain('<w:br/>')
        // A summary is shown, and in bold, as the PDF prints a <details> open.
        expect(runWith(xml, 'More')).toContain('<w:b/>')
    })

    it('writes the words, pictures and links of raw HTML blocks, aligned as they ask, as the preview and PDF show them (N38, B29)', async () => {
        const { parts } = await render(
            [
                '<p align="center">Made by <b>Ada</b> &amp; friends</p>',
                '',
                '<div align="center">',
                '  <h1>Scrivon</h1>',
                `  <img src="${dataUrl('image/png', sizedPng(64, 32))}" alt="Logo">`,
                '  <a href="https://example.com/ci"><img src="https://example.com/badge.svg" alt="build passing"></a>',
                '  <p align="right">Right side</p>',
                '</div>',
                '',
                '<table>',
                '  <tr><th>Key</th><th>Value</th></tr>',
                '  <tr><td>one</td><td>two   words</td></tr>',
                '</table>',
                '',
                '<pre>line one',
                '  line two</pre>',
                '',
                'Inline <img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="Icon"> picture.',
                '',
                '<div></div>',
                '',
                '<p>&#7;Bell</p>',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        expect(body).not.toContain('&lt;')
        // Words keep their bold, spaces collapse as in a browser, and the alignment carries over.
        expect(blockWith(body, 'Made by ')).toContain('<w:jc w:val="center"/>')
        expect(runWith(body, 'Ada')).toContain('<w:b/>')
        expect(body).toContain('> &amp; friends</w:t>')
        expect(blockWith(body, 'Scrivon')).toContain('<w:jc w:val="center"/>')
        expect(runWith(body, 'Scrivon')).toContain('<w:b/>')
        expect(blockWith(body, 'Right side')).toContain('<w:jc w:val="end"/>')
        // A data: picture is embedded at its own size; a web one is its alt text, still linked.
        expect(drawingSize(body, 'Logo')).toEqual({ width: 64, height: 32 })
        expect(blockWith(body, 'build passing', '<w:hyperlink ')).toBeTruthy()
        expect(parts['word/_rels/document.xml.rels']).toContain('Target="https://example.com/ci"')
        // A table row is one line, its cells split by bars, as in a footnote table.
        expect(runWith(body, 'Key')).toContain('<w:b/>')
        expect(body).toContain('>one | two words</w:t>')
        // <pre> keeps its spaces and lines, in the code font.
        expect(runWith(body, '  line two')).toContain('w:ascii="Consolas"')
        expect(blockWith(body, '  line two')).toContain('<w:br/>')
        // A picture Word can't take is its alt text, and an empty block writes nothing, not a blank line.
        expect(body).toContain('>Icon</w:t>')
        expect(body.match(/<w:p>/g)).toHaveLength(9)
        // A character reference XML forbids is dropped, so Word can still open the file.
        expect(body).toContain('>Bell</w:t>')
    })

    it('keeps the links and marks of HTML tags in a line of text, as the PDF does (review)', async () => {
        const { parts } = await render(
            [
                'Made by <a href="https://example.com/ada">Ada *Lovelace*</a> with <b>bold</b>, <i>slanted</i> and <del>gone</del>.',
                '',
                'Press <kbd>Ctrl</kbd>, <a href="javascript:alert(1)">unsafe</a>, <a href="https://example.com/out">[inner](https://example.com/in)</a>.',
                '',
                'Unclosed <b>to the end',
                '',
                'Hidden <script>steal()</script> script.',
                '',
                '# Title <em>here</em>',
                '',
                '| a |',
                '| --- |',
                '| <i>cell</i> |',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        const rels = parts['word/_rels/document.xml.rels']!
        // The link holds the words between its tags, Markdown marks and all.
        const links = body.match(/<w:hyperlink [\s\S]*?<\/w:hyperlink>/g) ?? []
        expect(links.some((link) => link.includes('>Ada </w:t>') && link.includes('>Lovelace</w:t>'))).toBe(true)
        expect(runWith(body, 'Lovelace')).toContain('<w:i/>')
        expect(rels).toContain('Target="https://example.com/ada"')
        expect(runWith(body, 'bold')).toContain('<w:b/>')
        expect(runWith(body, 'slanted')).toContain('<w:i/>')
        expect(runWith(body, 'gone')).toContain('<w:strike/>')
        expect(runWith(body, 'Ctrl')).toContain('w:ascii="Consolas"')
        expect(runWith(body, 'to the end')).toContain('<w:b/>')
        expect(runWith(body, 'here')).toContain('<w:i/>')
        expect(runWith(body, 'cell')).toContain('<w:i/>')
        // A link the PDF drops is plain words, and a Markdown link inside an HTML one keeps its own address.
        expect(body).toContain('>unsafe</w:t>')
        expect(rels).not.toContain('javascript')
        expect(rels).toContain('Target="https://example.com/in"')
        expect(rels).not.toContain('https://example.com/out')
        // What the PDF drops, a script's text with it, stays out.
        expect(body).not.toContain('steal')
        expect(body).not.toContain('&lt;')
    })

    it('aligns Markdown inside a <div align> left open across blocks, and HTML in list items and footnotes (review)', async () => {
        const { parts } = await render(
            [
                '<div align="center">',
                '',
                `<img src="${dataUrl('image/png', sizedPng(64, 32))}" alt="Logo">`,
                '',
                '# Scrivon',
                '',
                'A fast diagram editor.',
                '',
                '<div>',
                '',
                'Nested inherits.',
                '',
                '</div>',
                '',
                '<div align="left">',
                '',
                'Left inside.',
                '',
                '</div>',
                '',
                'Centred again.',
                '',
                '</div>',
                '<!-- <div align="right"> -->',
                '',
                'After the div.',
                '',
                '- <p align="center">Centred item</p>',
                '',
                'Noted[^n].',
                '',
                '[^n]: <p align="right">Right note</p>',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        const centred = '<w:jc w:val="center"/>'
        for (const words of ['Scrivon', 'A fast diagram editor.', 'Nested inherits.', 'Centred again.', 'Centred item']) {
            expect(blockWith(body, words), words).toContain(centred)
        }
        const logo = body.indexOf('descr="Logo"')
        expect(body.slice(body.lastIndexOf('<w:p>', logo), logo)).toContain(centred)
        expect(blockWith(body, 'Left inside.')).toContain('<w:jc w:val="start"/>')
        // The div ends at its </div>; a tag in a comment opens nothing.
        expect(blockWith(body, 'After the div.')).not.toContain('<w:jc ')
        expect(blockWith(parts['word/footnotes.xml']!, 'Right note')).toContain('<w:jc w:val="end"/>')
    })

    it('draws a raw HTML picture at the width or height it gives, as the PDF does (review)', async () => {
        const picture = dataUrl('image/png', sizedPng(64, 32))
        const { xml } = await render(
            [
                `<img src="${picture}" width="120" alt="By width">`,
                '',
                `<img src="${picture}" height="16" alt="By height">`,
                '',
                `<img src="${picture}" width="40px" height="40" alt="Both">`,
                '',
                `<img src="${picture}" width="5000" alt="Too wide">`,
                '',
                `![Wide markdown](${dataUrl('image/png', sizedPng(5000, 2500))})`,
                '',
                `<img src="${picture}" width="50%" alt="Percent">`,
            ].join('\n')
        )
        expect(drawingSize(xml, 'By width')).toEqual({ width: 120, height: 60 })
        expect(drawingSize(xml, 'By height')).toEqual({ width: 32, height: 16 })
        // A width wins, and the height follows it, as in the PDF.
        expect(drawingSize(xml, 'Both')).toEqual({ width: 40, height: 20 })
        // It still shrinks to the text width, keeping its shape. A percentage leaves the picture at its own size.
        expect(drawingSize(xml, 'Too wide')).toEqual(drawingSize(xml, 'Wide markdown'))
        expect(drawingSize(xml, 'Percent')).toEqual({ width: 64, height: 32 })
        // The contents page numbers use the size it is drawn at: twelve 480px pictures shown 10px tall fit on one page.
        const small = Array.from({ length: 12 }, () => [`<img src="${dataUrl('image/png', sizedPng(640, 480))}" height="10">`, '']).flat()
        const toc = await render(['# Start', '', ...small, '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        expect(tocPage(toc.xml, 'End')).toBe(2)
    })

    it('keeps the blank lines and rules raw HTML blocks show: &nbsp;, <br> spacers and <hr> (review)', async () => {
        const { parts } = await render(
            [
                '[r](#rule)',
                '',
                'One',
                '',
                '<p>&nbsp;</p>',
                '',
                'Two',
                '',
                '<br>',
                '',
                'Three',
                '',
                '<p><br></p>',
                '',
                'Four',
                '',
                '<div><br><br></div>',
                '',
                'Five',
                '',
                '<hr id="rule">',
                '',
                'Six',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        const paragraphs = body.match(/<w:p>[\s\S]*?<\/w:p>/g) ?? []
        const words = paragraphs.map((paragraph) => [...paragraph.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join(''))
        // Each spacer is a blank line, as in the PDF: two <br>s are two lines, so one break in an empty paragraph.
        expect(words).toEqual(['r', 'One', ' ', 'Two', '', 'Three', '', 'Four', '', 'Five', '', 'Six'])
        expect(paragraphs.map((paragraph) => paragraph.match(/<w:br\/>/g)?.length ?? 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0])
        // The <hr> is a rule, and a link to its id lands on it.
        const rule = paragraphs[10]!
        expect(rule).toContain('<w:pBdr>')
        expect(rule).toContain(`<w:bookmarkStart w:name="${/w:anchor="([^"]+)"/.exec(body)![1]}"`)
        // It is written just as `---` is.
        const html = await render('One\n\n<hr>\n\nTwo')
        const markdown = await render('One\n\n---\n\nTwo')
        expect(html.parts['word/document.xml']).toBe(markdown.parts['word/document.xml'])
        // The contents page numbers count each blank line.
        const spacers = Array.from({ length: 40 }, () => ['<br>', '']).flat()
        const { xml } = await render(['# Start', '', ...spacers, '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        expect(tocPage(xml, 'End')).toBe(3)
    })

    it('counts raw HTML blocks in the contents page numbers', async () => {
        const blocks = Array.from({ length: 40 }, (_, index) => [`<p align="center">Line ${index}</p>`, '']).flat()
        const { xml } = await render(['# Start', '', ...blocks, '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        // About 33 lines fit on a page, so End is pushed to the next one.
        expect(tocPage(xml, 'Start')).toBe(2)
        expect(tocPage(xml, 'End')).toBe(3)
        // Each line of a <pre>, or of a <p> split by <br>, is counted, as each line of a code block is.
        const lines = Array.from({ length: 80 }, (_, index) => `line ${index}`)
        const end = async (block: string) =>
            tocPage(
                (
                    await render(['# Start', '', block, '', '# End'].join('\n'), (draft) => {
                        draft.frontMatter.toc = true
                        draft.frontMatter.tocExcludeH1 = false
                    })
                ).xml,
                'End'
            )
        expect(await end(fence('text', lines.join('\n')))).toBe(4)
        expect(await end(`<pre>${lines.join('\n')}</pre>`)).toBe(4)
        expect(await end(`<p>${lines.join('<br>')}</p>`)).toBe(4)
    })

    it('leaves raw HTML and comments in headings off the Contents page too', async () => {
        const { parts } = await render(
            '# Pricing <!-- internal: 40% margin -->\n\n## Keys <kbd>Ctrl</kbd>\n\n## <!-- only a comment -->',
            (draft) => {
                draft.frontMatter.toc = true
                draft.frontMatter.tocExcludeH1 = false
            }
        )
        const body = parts['word/document.xml']!
        expect(body).not.toContain('&lt;')
        // Not even in bookmark names, which were the heading's slug.
        expect(body).not.toContain('margin')
        // Each row reads as its heading does in the body, and a heading that is only a comment gets no row.
        const rows = [...body.matchAll(/<w:hyperlink [^>]*>([\s\S]*?)<\/w:hyperlink>/g)].map((row) =>
            [...row[1]!.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((text) => text[1]).join('|')
        )
        expect(rows).toEqual(['Pricing|2', 'Keys Ctrl|2'])
    })

    it('heads the Contents page with the profile’s title, or the document’s own toc-title', async () => {
        const toc = (title: string) => (draft: PdfExportProfile) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
            draft.frontMatter.tocTitle = title
        }
        const named = (await render('# Intro\n\n## Part', toc('Sommaire'))).parts['word/document.xml']!
        expect(runWith(named, 'Sommaire')).toContain('<w:b/>')
        expect(named).not.toContain('>Contents</w:t>')

        const own = (await render('---\ntoc-title: 目次\n---\n# Intro', toc('Sommaire'))).parts['word/document.xml']!
        expect(runWith(own, '目次')).toContain('<w:b/>')
        expect(own).not.toContain('>Sommaire</w:t>')

        const emptied = (await render('# Intro', toc(''))).parts['word/document.xml']!
        expect(runWith(emptied, 'Contents')).toContain('<w:b/>')
        expect(blockWith(emptied, 'Contents')).not.toContain('<w:bidi/>')

        // A right-to-left title reads right to left, as the cover title does.
        const arabic = (await render('# Intro', toc('فهرس'))).parts['word/document.xml']!
        expect(blockWith(arabic, 'فهرس')).toContain('<w:bidi/>')
        expect(runWith(arabic, 'فهرس')).toContain('<w:rtl/>')
    })

    it('counts a Contents title that wraps when estimating contents page numbers', async () => {
        const rows = Array.from({ length: 40 }, (_, index) => `## Part ${index + 1}`).join('\n\n')
        const pageOf = async (title: string) => {
            const { xml } = await render(`# Intro\n\n${rows}`, (draft) => {
                draft.frontMatter.toc = true
                draft.frontMatter.tocTitle = title
            })
            return tocPage(xml, 'Part 1')
        }
        const short = await pageOf('Contents')
        // Six lines of title take room from the rows, so the body starts a page later.
        expect(await pageOf(Array.from({ length: 30 }, () => 'Inhaltsverzeichnis').join(' '))).toBe(short! + 1)
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
        expect(tocPage(xml, 'Log review')).toBe(3)
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

    it('keeps short code blocks and tables on one page, as the PDF does (N42)', async () => {
        const lines = (count: number, word: string) => Array.from({ length: count }, (_, index) => `${word} ${index}`).join('\n')
        const rows = (count: number, word: string) => Array.from({ length: count }, (_, index) => `| ${word} ${index} |`)
        const { parts } = await render(
            [
                fence('text', lines(3, 'short')),
                '',
                fence('text', lines(26, 'long')),
                '',
                '| Small |',
                '| --- |',
                ...rows(2, 'small'),
                '',
                '| Big |',
                '| --- |',
                ...rows(15, 'big'),
                '',
                '| Tall | Other |',
                '| --- | --- |',
                `| ${'Many words in one cell. '.repeat(400)} | x |`,
                `| ${Array.from({ length: 60 }, (_, index) => `item ${index}`).join('<br>')} | y |`,
                '| after |  |',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        // Each code line keeps with the next, so the block moves to the next page whole; the last line keeps with nothing.
        for (const index of [0, 1]) expect(blockWith(body, `short ${index}`)).toContain('<w:keepNext/><w:keepLines/>')
        expect(blockWith(body, 'short 2')).not.toContain('<w:keepNext/>')
        expect(blockWith(body, 'short 2')).toContain('<w:keepLines/>')
        // A block of more than 25 lines splits between lines as before, as in the PDF.
        for (let index = 0; index < 26; index += 1) expect(blockWith(body, `long ${index}`)).not.toContain('<w:keep')
        const tableRows = (head: string) =>
            body
                .slice(body.lastIndexOf('<w:tbl>', body.indexOf(`>${head}</w:t>`)))
                .split('</w:tbl>')[0]!
                .split('</w:tr>')
                .slice(0, -1)
        // A short table's rows can't split and each keeps with the next; a longer one's only after its header.
        const small = tableRows('Small')
        expect(small).toHaveLength(3)
        for (const row of small) expect(row).toContain('<w:cantSplit/>')
        expect(small.map((row) => row.includes('<w:keepNext/>'))).toEqual([true, true, false])
        const big = tableRows('Big')
        expect(big).toHaveLength(16)
        expect(big.map((row) => row.includes('<w:keepNext/>'))).toEqual([true, ...Array<boolean>(15).fill(false)])
        // A row too tall to keep whole may still split, so Word never cuts it off: long text, or many short lines
        // split by <br>, each a line of its own.
        const tall = tableRows('Tall')
        expect(tall.map((row) => row.includes('<w:cantSplit/>'))).toEqual([true, false, false, true])
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

    it('shares one numbering between bullet lists, so long documents stay quick to export', async () => {
        const lists = Array.from({ length: 40 }, (_, index) => [`- dot ${index}`, '    - sub ' + index, '', `Text ${index}.`, '']).flat()
        const { parts } = await render([...lists, '> - quoted dot', '', '1. first', '', 'Gap.', '', '1. second'].join('\n'))
        const body = parts['word/document.xml']!
        const numId = (text: string) => /<w:numId w:val="(\d+)"\/>/.exec(blockWith(body, text))?.[1]
        // Bullets never restart, so there is docx's own default, one each for top-level, nested, and quoted bullets,
        // and one per numbered list.
        expect(parts['word/numbering.xml']!.match(/<w:num w:numId=/g)).toHaveLength(1 + 3 + 2)
        expect(numId('dot 39')).toBe(numId('dot 0'))
        expect(numId('sub 39')).toBe(numId('sub 0'))
        expect(numId('sub 0')).not.toBe(numId('dot 0'))
        // A quoted list is indented further, so it keeps a numbering of its own.
        expect(numId('quoted dot')).not.toBe(numId('dot 0'))
        expect(blockWith(body, 'quoted dot')).toContain('<w:ind w:left="600" w:hanging="360"/>')
        // Numbered lists still restart.
        expect(numId('second')).not.toBe(numId('first'))
    })

    it('gives each of hundreds of numbered lists its own numbering, with every placeholder filled in', async () => {
        const count = 500
        const lists = Array.from({ length: count }, (_, index) => [`${index + 1}. item ${index}`, '', `Gap ${index}.`, '']).flat()
        const { parts } = await render(lists.join('\n'))
        const body = parts['word/document.xml']!
        const ids = [...body.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((match) => match[1])
        // docx 9.12 fills in every list's number in one pass over the document, not one pass per list.
        expect(ids).toHaveLength(count)
        expect(new Set(ids).size).toBe(count)
        expect(parts['word/numbering.xml']!.match(/<w:num w:numId=/g)).toHaveLength(1 + count)
        expect(body).not.toMatch(/\{list-\d+-\d+\}/)
        // Each list keeps the number it starts at.
        const start = (id: string | undefined) =>
            new RegExp(`<w:num w:numId="${id}">[\\s\\S]*?<w:startOverride w:val="(\\d+)"/>`).exec(parts['word/numbering.xml']!)?.[1]
        expect(start(/<w:numId w:val="(\d+)"\/>/.exec(blockWith(body, `item ${count - 1}`))?.[1])).toBe(String(count))
    })

    it('uses the first of two link definitions, and draws reference-style pictures', async () => {
        const svg = `data:image/svg+xml,${encodeURIComponent(svgMarkup('width="40" height="20"'))}`
        const source = [
            'Read [the docs][d] and see ![logo][logo] and ![icon][icon].',
            '',
            '[d]: https://one.example.com',
            `[logo]: ${dataUrl('image/png', sizedPng(64, 32))}`,
            `[icon]: ${svg}`,
            '',
            'More words.',
            '',
            '[d]: https://two.example.com',
        ].join('\n')
        const plain = await render(source)
        expect(plain.parts['word/_rels/document.xml.rels']).toContain('https://one.example.com')
        expect(plain.xml).not.toContain('https://two.example.com')
        expect(drawingSize(plain.xml, 'logo')).toEqual({ width: 64, height: 32 })
        expect(plain.xml).not.toContain('>logo</w:t>')
        // Without a canvas the SVG can't be redrawn, so its alt text stands in.
        expect(plain.xml).toContain('>icon</w:t>')

        // With one, a referenced SVG is redrawn like an inline one.
        stubImageDecoding()
        const redrawn = await render(source)
        expect(drawingSize(redrawn.xml, 'icon')).toEqual({ width: 40, height: 20 })
    })

    it('marks Hebrew and Arabic paragraphs, lists, tables, and runs right-to-left', async () => {
        const { xml, parts } = await render(
            [
                '---',
                'title: דוח שנתי',
                '---',
                '',
                '# כותרת ראשית',
                '',
                'שלום עולם, זה טקסט. With English words.',
                '',
                '1. פריט ראשון',
                '2. فقرة ثانية',
                '',
                '| שם | ערך |',
                '| --- | --- |',
                '| א | ב |',
                '',
                'English with a **שלום** word.[^n]',
                '',
                '[^n]: הערה קצרה.',
            ].join('\n'),
            (draft) => {
                draft.frontMatter.titlePage = true
            }
        )
        for (const text of ['דוח שנתי', 'כותרת ראשית', 'פריט ראשון', 'فقرة ثانية', 'שם', 'א']) {
            expect(blockWith(xml, text)).toContain('<w:bidi/>')
            expect(runWith(xml, text)).toContain('<w:rtl/>')
        }
        // A run with English words in it isn't marked, so the spaces between them keep their order; its paragraph still is.
        expect(blockWith(xml, 'שלום עולם, זה טקסט. With English words.')).toContain('<w:bidi/>')
        expect(runWith(xml, 'שלום עולם, זה טקסט. With English words.')).not.toContain('<w:rtl/>')
        // The table's first column is on the right.
        expect(blockWith(xml, 'שם', '<w:tbl>')).toContain('<w:bidiVisual/>')
        // An English paragraph stays left-to-right, though a Hebrew word in it is marked.
        expect(blockWith(xml, 'English with a ')).not.toContain('<w:bidi/>')
        expect(runWith(xml, 'שלום')).toContain('<w:rtl/>')
        expect(blockWith(parts['word/footnotes.xml']!, 'הערה קצרה.')).toContain('<w:bidi/>')
    })

    it('keeps aligned columns on their side in a right-to-left table', async () => {
        const { xml } = await render(['| שם | מחיר | הערה |', '| :--- | ---: | --- |', '| פריט | 5 | טקסט |'].join('\n'))
        // Word's start is the right side in a right-to-left cell, so ':---' (left) is end and '---:' (right) is start.
        expect(blockWith(xml, 'שם')).toContain('<w:jc w:val="end"/>')
        expect(blockWith(xml, 'פריט')).toContain('<w:jc w:val="end"/>')
        expect(blockWith(xml, 'מחיר')).toContain('<w:jc w:val="start"/>')
        // A number has no direction of its own, so its cell stays left-to-right, where right is end.
        expect(blockWith(xml, '5')).not.toContain('<w:bidi/>')
        expect(blockWith(xml, '5')).toContain('<w:jc w:val="end"/>')
        // No alignment follows the text, as the PDF's dir="auto" does: start, the right side here.
        expect(blockWith(xml, 'טקסט')).toContain('<w:jc w:val="start"/>')
    })

    it('leaves left-to-right documents without direction marks', async () => {
        const { xml } = await render('# Title\n\nPlain text.\n\n- item\n\n| a |\n| --- |\n| b |')
        expect(xml).not.toContain('<w:bidi/>')
        expect(xml).not.toContain('<w:rtl/>')
        expect(xml).not.toContain('bidiVisual')
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

    it('sizes a column of web pictures by the alt text Word writes for them, not as pictures (N40)', async () => {
        const { xml } = await render(
            [
                '| Badge | Description |',
                '| --- | --- |',
                '| ![build](https://img.shields.io/badge/build-passing-green.svg) | Builds the app on every push to the main branch. |',
            ].join('\n')
        )
        const grid = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1]))
        // Word writes the badge as the word "build", so its column is sized for that and its header (about 6 characters),
        // not the 20 an embedded picture takes, and the description gets the room.
        expect(grid).toEqual([1107, 9666])
    })

    it('estimates contents page numbers with each table column at its own width', async () => {
        const rows = Array.from({ length: 30 }, (_, index) => `| ${index} | ${'Description words. '.repeat(16)} |`)
        const { xml } = await render(['# Start', '', '| ID | Description |', '| --- | --- |', ...rows, '', '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        // The description wraps in its wide column: 4 lines a row, not the 7 two equal columns gave, which put End on page 8.
        expect(tocPage(xml, 'End')).toBe(6)
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
        expect(xml).toMatch(/Alpha<\/w:t>[\s\S]{0,400}<w:tab\/>[\s\S]{0,400}PAGEREF _Ref1 \\h/)
        expect(tocPage(xml, 'Alpha')).toBe(3)
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
        expect(tocPage(xml, 'World')).toBe(3)
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
        expect(tocPage(xml, 'Alpha')).toBe(3)
        expect(tocPage(xml, 'Beta')).toBe(3)
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

    it.each([
        ['a3', 'portrait', '<w:pgSz w:w="16837" w:h="23811" w:orient="portrait"/>'],
        ['a5', 'portrait', '<w:pgSz w:w="8390" w:h="11905" w:orient="portrait"/>'],
        ['legal', 'landscape', '<w:pgSz w:w="20160" w:h="12240" w:orient="landscape"/>'],
    ] as const)('writes %s %s pages at their real size', async (size, orientation, pgSz) => {
        const { xml } = await render('# Hi', (draft) => {
            draft.page.size = size
            draft.page.orientation = orientation
        })
        expect(xml).toContain(pgSz)
    })

    it('writes a custom page size, and lays the text out to its width', async () => {
        const { xml } = await render('# Alpha\n\nA [site](https://example.com).', (draft) => {
            draft.page.size = 'custom'
            draft.page.customSizeMm = { width: 120, height: 180 }
            draft.header.enabled = true
            draft.header.ignoreMargins = true
            draft.header.left.text = 'Head'
        })
        expect(xml).toContain('<w:pgSz w:w="6803" w:h="10204" w:orient="portrait"/>')
        // The edge-to-edge header bar spans the 120 mm sheet.
        expect(xml).toContain('<w:tblW w:type="dxa" w:w="6803"/>')
    })

    it('gives code blocks the code theme’s own background and text colour', async () => {
        highlightFencedCodeTokens.mockImplementationOnce(async () => [[{ text: 'plain' }]])
        const { xml } = await render(fence('js', 'plain'), (draft) => {
            draft.content.codeTheme = 'solarized-dark'
        })
        expect(blockWith(xml, 'plain')).toContain('w:fill="002B36"')
        expect(runWith(xml, 'plain')).toContain('<w:color w:val="839496"/>')
    })

    it('names the author in the file properties, and no one when there is no author', async () => {
        const anonymous = (await render('# Hi')).parts['docProps/core.xml']!
        expect(anonymous).not.toContain('Un-named')
        expect(anonymous).not.toContain('<dc:creator>')
        expect(anonymous).not.toContain('<cp:lastModifiedBy>')
        const signed = (await render('---\nauthor: Ada Lovelace\n---\n\n# Hi')).parts['docProps/core.xml']!
        expect(signed).toContain('<dc:creator>Ada Lovelace</dc:creator>')
        expect(signed).toContain('<cp:lastModifiedBy>Ada Lovelace</cp:lastModifiedBy>')
    })

    it('writes each page-number preset', async () => {
        /** The footer's text and fields in order: fields as {PAGE}, text as it is. */
        const footerText = async (format: PdfExportProfile['footer']['pageNumbers'], template = '') => {
            const { parts } = await render('# Hi', (draft) => {
                draft.footer.enabled = true
                draft.footer.pageNumbers = format
                draft.footer.right.text = template
            })
            const footer = parts['word/footer1.xml']!
            return [...footer.matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>|<w:t[^>]*>([^<]*)<\/w:t>/g)]
                .map((match) => (match[1] !== undefined ? `{${match[1].trim()}}` : match[2]))
                .join('')
        }
        expect(await footerText('none')).toBe('')
        expect(await footerText('number')).toBe('{PAGE}')
        expect(await footerText('page-n')).toBe('Page {PAGE}')
        expect(await footerText('n-of-total')).toBe('{PAGE} / {NUMPAGES}')
        expect(await footerText('custom', 'Sheet {{page}} of {{total}}')).toBe('Sheet {PAGE} of {NUMPAGES}')
        // A cover page without a footer still gives the body its own footer.
        const covered = await render('# Hi', (draft) => {
            draft.frontMatter.titlePage = true
            draft.footer.enabled = true
            draft.footer.pageNumbers = 'number'
        })
        expect(covered.parts['word/footer1.xml']).toContain('>PAGE</w:instrText>')
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

    it('numbers pages from the body: Word restarts at 1 there and counts only its pages (F48)', async () => {
        const front = (fromBody: boolean) => (draft: PdfExportProfile) => {
            draft.frontMatter.titlePage = true
            draft.frontMatter.toc = true
            draft.footer.pageNumbers = 'n-of-total'
            // The footer shows on every page, so the title and contents pages have one too.
            draft.footer.hideOnFirstPages = 'none'
            draft.footer.numberFromBody = fromBody
        }
        const source = '# Report\n\n## Setup\n\nBody'
        const footers = (parts: Record<string, string>) =>
            Object.keys(parts)
                .filter((name) => /^word\/footer\d+\.xml$/.test(name))
                .map((name) => parts[name]!)
        const sections = (xml: string) => [...xml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map((match) => match[0])

        const fromBody = await render(source, front(true))
        const body = fromBody.parts['word/document.xml']!
        // Title, contents and body each get a section; only the body's restarts the numbers.
        expect(sections(body)).toHaveLength(3)
        expect(sections(body).map((section) => section.includes('<w:pgNumType w:start="1"/>'))).toEqual([false, false, true])
        // The body's footer counts the body's pages; the front pages' footers show no number.
        const numbered = footers(fromBody.parts).filter((footer) => footer.includes('>PAGE</w:instrText>'))
        expect(numbered).toHaveLength(1)
        expect(numbered[0]).toContain('>SECTIONPAGES</w:instrText>')
        expect(numbered[0]).not.toContain('NUMPAGES')
        // The contents row shows the heading's page counted from the body.
        expect(tocPage(fromBody.xml, 'Setup')).toBe(1)

        const counted = await render(source, front(false))
        expect(counted.xml).not.toMatch(/<w:pgNumType[^>]*w:start=/)
        expect(counted.xml).not.toContain('SECTIONPAGES')
        expect(footers(counted.parts).every((footer) => footer.includes('>PAGE</w:instrText>'))).toBe(true)
        expect(tocPage(counted.xml, 'Setup')).toBe(3)

        // With no title or contents page, nothing comes before the body to skip.
        const plain = await render(source, (draft) => {
            draft.footer.pageNumbers = 'n-of-total'
            draft.footer.numberFromBody = true
        })
        expect(plain.xml).not.toMatch(/<w:pgNumType[^>]*w:start=/)
        expect(plain.parts['word/footer1.xml']).toContain('NUMPAGES')
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
        expect(xml).toContain('Inside')
        expect(xml).toContain('nested')
        expect(xml).toContain('quoted')
        // Every entry gets a number, in page order. The contents fill two pages, and the 100-line block
        // before Alpha runs over two more. Seventy headings take about four and a half pages.
        const pages = ['Alpha', 'Beta', 'Section 1', 'Section 70', 'Deep'].map((heading) => tocPage(xml, heading))
        expect(pages).toEqual([4, 9, 9, 14, 14])
        // Pictures with a size in their header keep it; ones without get the 640×480 box; broken ones are their alt text.
        expect(drawingSize(xml, 'pixel')).toEqual({ width: 1, height: 1 })
        expect(drawingSize(xml, 'bmp')).toEqual({ width: 4, height: 3 })
        expect(drawingSize(xml, 'fill')).toEqual({ width: 1, height: 1 })
        expect(drawingSize(xml, 'rst')).toEqual({ width: 1, height: 1 })
        for (const sizeless of ['gif', 'flat', 'junk', 'short-jpeg', 'app', 'sos', 'flat-jpeg', 'short']) {
            expect(drawingSize(xml, sizeless), sizeless).toEqual({ width: 640, height: 480 })
        }
        for (const dropped of ['plain', 'remote', 'bad']) {
            expect(xml).toContain(`>${dropped}</w:t>`)
            expect(xml).not.toContain(`descr="${dropped}"`)
        }
    })

    it('writes contents page numbers as PAGEREF fields, counting pictures Word shows as alt text as one line', async () => {
        const toc = (draft: PdfExportProfile) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        }
        const relative = Array.from({ length: 12 }, (_, index) => [`![shot](./images/shot${index}.png)`, '']).flat()
        const linked = await render(['# Start', '', ...relative, '# End'].join('\n'), toc)
        // The contents is page 1. Twelve one-line alt texts fit on page 2 with both headings.
        expect(tocPage(linked.xml, 'Start')).toBe(2)
        expect(tocPage(linked.xml, 'End')).toBe(2)
        // The number keeps the contents' styling, and the link still jumps to the heading.
        expect(runWith(linked.xml, '2')).toContain('<w:color w:val="404040"/>')
        expect(linked.xml).toContain(`w:anchor="${bookmarks(linked.parts['word/document.xml']!)[1]!.name}"`)

        // Real pictures still take their height: 12 at 480px don't fit on one page.
        const embedded = Array.from({ length: 12 }, (_, index) => [`![shot${index}](${dataUrl('image/png', sizedPng(640, 480))})`, '']).flat()
        const pictures = await render(['# Start', '', ...embedded, '# End'].join('\n'), toc)
        expect(tocPage(pictures.xml, 'Start')).toBe(2)
        expect(tocPage(pictures.xml, 'End')).toBeGreaterThan(4)

        // Japanese characters are a full em wide, so the same number of them fills more than twice the lines.
        const paragraphs = (text: string) => Array.from({ length: 20 }, () => [text, '']).flat()
        const japanese = await render(['# Start', '', ...paragraphs('日本語の文章を書きます。'.repeat(25)), '# End'].join('\n'), toc)
        const latin = await render(['# Start', '', ...paragraphs('Latin text. '.repeat(25)), '# End'].join('\n'), toc)
        expect(tocPage(japanese.xml, 'End')).toBe(5)
        expect(tocPage(latin.xml, 'End')).toBe(3)
        // Emoji are one wide character each, not two narrow ones.
        const emoji = await render(['# Start', '', ...paragraphs('😀'.repeat(300)), '# End'].join('\n'), toc)
        expect(tocPage(emoji.xml, 'End')).toBe(5)

        // Long headings wrap in the contents and push later rows onto the next contents page.
        const long = Array.from({ length: 40 }, (_, index) => `## ${'Wrapped heading words '.repeat(6)}${index}`)
        const wrapped = await render(['# Start', '', ...long].join('\n'), toc)
        expect(tocPage(wrapped.xml, 'Start')).toBe(3)
    })

    it('gives headings bookmark names Word keeps, and points the contents and links at them', async () => {
        const long = 'Installing the desktop app on Windows and macOS step by step'
        const source = [`# ${long}`, '', '# 1. Intro', '', 'See [the intro](#1-intro) and [nowhere](#no-such-heading).'].join('\n')
        const { parts } = await render(source, (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        const body = parts['word/document.xml']!
        const marks = bookmarks(body)
        // The slugs are 60 characters and start with a digit; Word wants a letter or _ first and at most 40.
        expect(marks).toHaveLength(2)
        for (const { name } of marks) expect(name).toMatch(/^[A-Za-z_]\w{0,39}$/)
        // docx numbers every bookmark 1; each has its own number, and its end matches.
        expect(new Set(marks.map(({ id }) => id)).size).toBe(2)
        for (const { id } of marks) expect(body).toContain(`<w:bookmarkEnd w:id="${id}"/>`)
        // The PAGEREF fields and the contents links use those names, and so does the link in the text.
        const names = marks.map(({ name }) => name)
        expect([...body.matchAll(/PAGEREF (\S+) \\h/g)].map((match) => match[1])).toEqual(names)
        // A link to an id no heading has is left as it is.
        expect([...body.matchAll(/w:anchor="([^"]+)"/g)].map((match) => match[1])).toEqual([...names, names[1], 'no-such-heading'])
        expect(tocPage(body, long)).toBe(2)
        expect(tocPage(body, '1. Intro')).toBe(2)
    })

    it('links to <a name> and id anchors from raw HTML, as the PDF does, without a blank line for them (N41)', async () => {
        const { parts } = await render(
            [
                '[a](#install) [b](#usage) [c](#x) [d](#faq) [e](#setup) [f](#in-link) [g](#end) [h](#code) [i](#pic)',
                '',
                '<a name="install"></a>',
                '',
                '## 1. Install',
                '',
                'Steps with a <span id="x">target</span> inside.',
                '',
                '<h2 id="faq">FAQ</h2>',
                '',
                '## Setup',
                '',
                '<a name="setup"></a><a id="usage"></a>',
                '',
                '- item',
                '',
                '<img id="pic" src="https://example.com/pic.png" alt="Pic">',
                '',
                '<a name="code"></a>',
                '',
                fence('js', 'let x = 1'),
                '',
                '[<a name="in-link"></a>Back](#install) and [<a id="web"></a>site](https://example.com).',
                '',
                '<a name="end"></a>',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        const marks = bookmarks(body)
        const names = new Set(marks.map(({ name }) => name))
        // Every link lands on a bookmark that is in the file, and each anchor's bookmark is written once.
        const anchors = [...body.matchAll(/w:anchor="([^"]+)"/g)].map((match) => match[1]!)
        expect(anchors).toHaveLength(10)
        for (const anchor of anchors) expect(names).toContain(anchor)
        expect(names.size).toBe(marks.length)
        // The anchor above the heading is at the heading's start, not on a blank line of its own.
        const install = anchors[0]!
        expect(blockWith(body, '1. Install')).toContain(`<w:bookmarkStart w:name="${install}"`)
        expect(blockWith(body, '1. Install')).toContain('Heading2')
        expect(blockWith(body, 'target')).toContain(`w:name="${anchors[2]}"`)
        expect(blockWith(body, 'FAQ')).toContain(`w:name="${anchors[3]}"`)
        // A heading with the same id keeps it: #setup goes to the heading, whose bookmark is the only one for it.
        expect(blockWith(body, 'Setup')).toContain(`w:name="${anchors[4]}"`)
        expect(blockWith(body, 'item')).toContain(`w:name="${anchors[1]}"`)
        expect(blockWith(body, 'item')).not.toContain(`w:name="${anchors[4]}"`)
        expect(blockWith(body, 'let x = 1')).toContain(`w:name="${anchors[7]}"`)
        // A picture's id marks it too.
        expect(blockWith(body, 'Pic')).toContain(`w:name="${anchors[8]}"`)
        // Inside a link the bookmark is written before it, and the last one gets a paragraph of its own at the end.
        expect(blockWith(body, 'Back', '<w:hyperlink ')).not.toContain('bookmark')
        expect(body.match(/<w:p>/g)).toHaveLength(10)
    })

    it('keeps a paragraph of only &nbsp; as the blank line the preview and PDF show (review)', async () => {
        const { parts } = await render('One\n\n&nbsp;\n\nTwo')
        expect(parts['word/document.xml']!.match(/<w:p>/g)).toHaveLength(3)
        // The contents page numbers count it as a line too.
        const spacers = Array.from({ length: 40 }, () => ['&nbsp;', '']).flat()
        const { xml } = await render(['# Start', '', ...spacers, '# End'].join('\n'), (draft) => {
            draft.frontMatter.toc = true
            draft.frontMatter.tocExcludeH1 = false
        })
        expect(tocPage(xml, 'End')).toBe(3)
    })

    it('links only to safe addresses, and finds #heading links however they are written (S10, B55)', async () => {
        const { parts } = await render(
            [
                '# Résumé',
                '',
                '[a](#r%C3%A9sum%C3%A9) [b](#résumé) [c](#Résumé) [d](#%E0%A4%A)',
                '',
                '[run](javascript:alert(1)) [open](file:///C:/Windows/notepad.exe) [find](search-ms:query=x) [path](C:\\docs\\a.md)',
                '',
                '[share](//host/share/x.docx) [unc](\\\\\\\\host\\\\share\\\\x.docx)',
                '',
                '[web](https://example.com/safe) [doc](other.md)',
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        const rels = parts['word/_rels/document.xml.rels']!
        // Copied from a browser (percent-encoded) or written with capitals, each still reaches the heading's bookmark.
        // A badly encoded one doesn't break the export and is kept as written.
        expect([...body.matchAll(/w:anchor="([^"]+)"/g)].map((match) => match[1])).toEqual(['_Ref1', '_Ref1', '_Ref1', '%E0%A4%A'])
        // The preview leaves these dead, so Word keeps their words as plain text, not a link that runs or opens something,
        // or that connects to a network share with the reader's sign-in.
        expect(rels).not.toMatch(/javascript:|file:|search-ms:|docs|host/)
        for (const words of ['run', 'open', 'find', 'path', 'share', 'unc']) {
            expect(runWith(body, words)).toBeTruthy()
            expect(runWith(body, words)).not.toContain('<w:u ')
        }
        expect(body.match(/<w:hyperlink /g)).toHaveLength(4 + 2)
        expect(rels).toContain('Target="https://example.com/safe" TargetMode="External"')
        expect(rels).toContain('Target="other.md" TargetMode="External"')
    })

    it('sends a link to just "#" to the top of the document, so Word finds no broken link in the file (N36)', async () => {
        // readDocx fails on a hyperlink whose relationship id points at nothing, which an empty anchor wrote.
        const { parts } = await render(
            ['# [Back](#)', '', 'Go [to the top](#) or [up][t].', '', '[t]: #', '', 'A note[^n].', '', '[^n]: Back [to top](#).'].join('\n')
        )
        const body = parts['word/document.xml']!
        // `_top` is Word's own bookmark for the start of the document, where the PDF's `#` goes too.
        expect(body.match(/w:anchor="_top"/g)).toHaveLength(3)
        expect(parts['word/footnotes.xml']).toContain('w:anchor="_top"')
        expect(body).not.toMatch(/<w:hyperlink [^>]*r:id=/)
    })

    it('keeps a picture in a #heading link just outside the link, which Word would point at nothing (N37)', async () => {
        // readDocx fails on a picture whose click points at a relationship that doesn't exist.
        const { parts } = await render(
            [
                '# Top',
                '',
                `[Back ![up](${PNG_URL}) to the top](#top) and [![ext](${PNG_URL})](https://example.com).`,
                '',
                'A note[^n].',
                '',
                `[^n]: [![note](${PNG_URL})](#top)`,
            ].join('\n')
        )
        const body = parts['word/document.xml']!
        const notes = parts['word/footnotes.xml']!
        // The pictures are still there, and the words on both sides still go to the heading.
        expect(body).toContain('descr="up"')
        expect(notes).toContain('descr="note"')
        expect(blockWith(body, 'Back ', '<w:hyperlink ')).toContain('w:anchor="_Ref1"')
        expect(blockWith(body, ' to the top', '<w:hyperlink ')).toContain('w:anchor="_Ref1"')
        expect(blockWith(body, ' to the top', '<w:hyperlink ')).not.toContain('<w:drawing>')
        // A picture in a web link keeps its own click, which has its relationship.
        expect(body.match(/<a:hlinkClick /g)).toHaveLength(2)
        expect(body).toMatch(/descr="ext"><a:hlinkClick /)
        expect(notes).not.toContain('hlinkClick')
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
        // A charset parameter before the comma is common in SVG data URLs.
        const svgUtf8 = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup('width="40" height="20"'))}`
        const svgBase64Utf8 = `data:image/svg+xml;charset=utf-8;base64,${Buffer.from(svgMarkup('width="30" height="10"')).toString('base64')}`
        const { xml, names } = await render(
            [
                '# Alpha',
                '',
                `![chart](${svgIcon})`,
                '',
                `![utf8](${svgUtf8})`,
                '',
                `![utf8-base64](${svgBase64Utf8})`,
                '',
                `<p align="center"><img src="${svgIcon}" alt="html icon"></p>`,
                '',
                `<img src="data:image/svg+xml,${encodeURIComponent(svgMarkup('viewBox="0 0 30 15"'))}" width="300" alt="wide icon">`,
            ].join('\n'),
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.header.enabled = true
                draft.footer.enabled = true
            },
            { logoDataUrl: svgLogo, header: { left: svgIcon, right: '' }, footer: { left: webp, right: '' } }
        )
        // The logo keeps its own 200×50 size; it is drawn at 2x so it stays sharp.
        expect(canvases).toContainEqual({ width: 400, height: 100 })
        expect(drawingSize(xml, 'Cover image')).toEqual({ width: 200, height: 50 })
        // The header icon is sized from its viewBox, the WebP from its pixels, both fitted into the bar.
        expect(drawingSize(xml, 'header left')).toEqual({ width: 32, height: 16 })
        expect(drawingSize(xml, 'footer left')).toEqual({ width: 37, height: 28 })
        expect(drawingSize(xml, 'chart')).toEqual({ width: 32, height: 16 })
        expect(drawingSize(xml, 'utf8')).toEqual({ width: 40, height: 20 })
        expect(drawingSize(xml, 'utf8-base64')).toEqual({ width: 30, height: 10 })
        // A raw HTML <img> is redrawn the same way, and at 2x the width it gives when that is wider than its own.
        expect(drawingSize(xml, 'html icon')).toEqual({ width: 32, height: 16 })
        expect(drawingSize(xml, 'wide icon')).toEqual({ width: 300, height: 150 })
        expect(canvases).toContainEqual({ width: 600, height: 300 })
        expect(mediaFiles(names).length).toBeGreaterThanOrEqual(3)
        expect(notifyWarning).not.toHaveBeenCalled()
    })

    it('redraws an opaque WebP picture as a JPEG, and keeps PNG for see-through pictures and SVG art', async () => {
        const webp = dataUrl('image/webp', WEBP)
        const svg = `data:image/svg+xml,${encodeURIComponent(svgMarkup('width="40" height="20"'))}`
        const redraw = async (url: string, lastAlpha: number) => {
            stubImageDecoding(lastAlpha)
            const { xml, names } = await render(`![pic](${url})`)
            return { types: [...encodings], media: mediaFiles(names), size: drawingSize(xml, 'pic') }
        }
        // A photo with no see-through pixels would be a lossless PNG of many megabytes.
        expect(await redraw(webp, 255)).toEqual({
            types: ['image/jpeg'],
            media: [expect.stringMatching(/\.jpe?g$/)],
            size: { width: 640, height: 480 },
        })
        // One see-through pixel, in the last rows, keeps it a PNG so the page shows through as in the PDF.
        expect(await redraw(webp, 254)).toEqual({ types: ['image/png'], media: [expect.stringMatching(/\.png$/)], size: { width: 640, height: 480 } })
        // Vector art stays a sharp PNG, without its pixels being read.
        expect(await redraw(svg, 255)).toEqual({ types: ['image/png'], media: [expect.stringMatching(/\.png$/)], size: { width: 40, height: 20 } })
    })

    it('draws an SVG logo that runs to the paper edges for the page width, so it stays sharp', async () => {
        const canvases = stubImageDecoding()
        const svgLogo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup('viewBox="0 0 120 40"'))}`
        const { xml } = await render(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.brand.logoIgnoreMargins = true
            },
            { logoDataUrl: svgLogo, header: { left: '', right: '' }, footer: { left: '', right: '' } }
        )
        // Stretched to the 793px page width, so it is drawn at twice that, not at twice its own 120px.
        expect(drawingSize(xml, 'Cover image')).toEqual({ width: 793, height: 264 })
        expect(canvases).toContainEqual({ width: 1586, height: 529 })
        // A logo inside the margins keeps its own size, drawn at 2x.
        const inside = stubImageDecoding()
        const small = await render(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
            },
            { logoDataUrl: svgLogo, header: { left: '', right: '' }, footer: { left: '', right: '' } }
        )
        expect(drawingSize(small.xml, 'Cover image')).toEqual({ width: 120, height: 40 })
        expect(inside).toEqual([{ width: 240, height: 80 }])
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
            description: "Couldn't add the cover image and header image. Try a PNG or JPEG file instead.",
        })
        // No cover image to run to the edge, so the title page keeps its margins and is centred.
        expect(xml).toContain('<w:vAlign w:val="center"/>')
        expect(xml).not.toContain('descr="Cover image"')

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
            description: "Couldn't add the cover image and footer image. Try a PNG or JPEG file instead.",
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
        expect(inline.xml).toContain('descr="Cover image"')

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
        expect(tocPage(footerOnly.xml, 'Beta')).not.toBeNull()

        const wide = await cover(
            '# Alpha',
            (draft) => {
                draft.frontMatter.titlePage = true
                draft.brand.logoIgnoreMargins = true
            },
            WIDE_PNG_URL
        )
        expect(wide.xml).toContain('descr="Cover image"')

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
            const { xml, names } = await render('# Alpha', edit, {
                logoDataUrl: logo,
                header: { left: '', right: '' },
                footer: { left: '', right: '' },
            })
            expect(xml).toContain('Alpha')
            // The square picture is page-wide (793px), so it is cut down to the 150mm (567px) cover cap.
            expect(drawingSize(xml, 'Cover image'), mode).toEqual({ width: 793, height: 567 })
            // A cropped cover is a new PNG. When the canvas can't crop, the original picture is kept as it is.
            const media = mediaFiles(names)
            expect(media, mode).toHaveLength(1)
            expect(media[0], mode).toMatch(mode === 'ok' ? /\.png$/ : /\.jpe?g$/)
        }
    })
})

const WEBP = Uint8Array.from([...new TextEncoder().encode('RIFF'), 0, 0, 0, 0, ...new TextEncoder().encode('WEBPVP8 ')])

function svgMarkup(attributes: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="10" height="10"/></svg>`
}

/** The file types each canvas from {@link stubImageDecoding} was asked to write, in order. */
const encodings: string[] = []

/**
 * Fake `<img>` and canvas. Every picture is 640×480; `broken` data fails to load. Each canvas hands back a PNG of its
 * own size, or a JPEG when asked for one. Every pixel is opaque but the last, which has `lastAlpha`: see-through unless
 * a test says otherwise, so only a scan of the whole picture finds it.
 */
function stubImageDecoding(lastAlpha = 0) {
    const canvases: { width: number; height: number }[] = []
    encodings.length = 0
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
                getContext: () => ({
                    drawImage() {},
                    getImageData(_x: number, top: number, width: number, height: number) {
                        const data = new Uint8ClampedArray(width * height * 4).fill(255)
                        if (top + height >= canvas.height) data[data.length - 1] = lastAlpha
                        return { data }
                    },
                }),
                toBlob(callback: (blob: Blob | null) => void, type = 'image/png') {
                    canvases.push({ width: canvas.width, height: canvas.height })
                    encodings.push(type)
                    const bytes = type === 'image/jpeg' ? jpeg(sof(canvas.height, canvas.width)) : sizedPng(canvas.width, canvas.height)
                    callback(new Blob([Uint8Array.from(bytes)]))
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

describe('renderExportDocx: GitHub alerts and math', () => {
    it('writes an alert with a bar and bold title in its colour, and plain text', async () => {
        const { xml } = await render(['> [!TIP]', '> tip-text', '>', '> | tip-cell |', '> | --- |', '>', '> > inner-quote'].join('\n'))
        const green = '<w:pBdr><w:left w:val="single" w:color="1A7F37" w:sz="12" w:space="11"/></w:pBdr>'
        expect(blockWith(xml, 'Tip')).toContain(green)
        expect(runWith(xml, 'Tip')).toContain('<w:b/>')
        expect(runWith(xml, 'Tip')).toContain('<w:color w:val="1A7F37"/>')
        expect(blockWith(xml, 'tip-text')).toContain(green)
        expect(runWith(xml, 'tip-text')).not.toContain('<w:i/>')
        expect(runWith(xml, 'tip-text')).not.toContain('<w:color')
        expect(blockWith(xml, 'tip-cell', '<w:tc>')).toContain('<w:left w:val="single" w:color="1A7F37" w:sz="12"/>')
        // A quote inside it is a quote again: grey italic text by the accent bar.
        expect(blockWith(xml, 'inner-quote')).toContain('<w:left w:val="single" w:color="262626" w:sz="12" w:space="11"/>')
        expect(runWith(xml, 'inner-quote')).toContain('<w:i/>')
    })

    it('writes math as its TeX source in the code font', async () => {
        const { xml } = await render(['Inline $E = mc^2$ here.', '', '$$', '\\frac{1}{3}', '$$'].join('\n'))
        expect(runWith(xml, 'E = mc^2')).toContain('w:ascii="Consolas"')
        expect(runWith(xml, '\\frac{1}{3}')).toContain('w:ascii="Consolas"')
    })
})
