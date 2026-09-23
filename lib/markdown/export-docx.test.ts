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
vi.mock('@/lib/markdown/shiki-highlighter', () => ({ highlightFencedCodeTokens }))

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

function readDocx(data: Uint8Array): { xml: string; names: string[] } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const names: string[] = []
    const xml: string[] = []
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
        if (name.endsWith('.xml') || name.endsWith('.rels')) xml.push(new TextDecoder().decode(method === 0 ? bytes : inflateRawSync(bytes)))
        offset = start + compressed
    }
    return { xml: xml.join('\n'), names }
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
        expect(xml).toContain('block')
        expect(xml).toContain('raw')
        expect(xml).toContain('Segoe UI')
        expect(xml).toContain('Menlo')
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
        // Header ignores margins, so the bar starts at the paper edge and spans the sheet.
        expect(xml).toContain('w:header="0"')
        expect(xml).toContain('w:left="0"')
        expect(xml).toContain('cx="10058400"')
        expect(xml).toContain('relativeFrom="page"')
        // Contents is laid out in the file: dotted leaders and a page number, not an empty Word TOC field.
        expect(xml).toContain('w:leader="dot"')
        expect(xml).toMatch(/Alpha<\/w:t>[\s\S]{0,400}<w:tab\/>[\s\S]{0,250}>3<\/w:t>/)
        expect(xml).not.toContain('TOC \\h \\o')
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
        expect(xml).toContain('w:top="0"')
        expect(xml).toContain('wp:inline')
        expect(xml).toContain('cx="7553325"')
        // Later pages bleed the bars to the top, bottom, and side edges.
        expect(xml).toContain('w:header="0"')
        expect(xml).toContain('w:footer="0"')
        expect(xml).toContain('w:left="0"')
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

    it('indents a table when the header bar reaches the page edge', async () => {
        const { xml } = await render('| a |\n| --- |\n| b |', (draft) => {
            draft.header.enabled = true
            draft.header.ignoreMargins = true
        })
        expect(xml).toContain('w:tblInd')
        expect(xml).toContain('b')
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

function stubDocument(mode: 'png' | 'no-context' | 'no-blob') {
    vi.stubGlobal('document', {
        createElement() {
            return {
                width: 0,
                height: 0,
                getContext() {
                    if (mode === 'no-context') return null
                    return { clearRect() {}, translate() {}, rotate() {}, fillText() {} }
                },
                toBlob(callback: (blob: Blob | null) => void) {
                    callback(mode === 'no-blob' ? null : new Blob([PNG]))
                },
            }
        },
    })
}
