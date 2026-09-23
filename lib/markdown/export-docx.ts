import {
    AlignmentType,
    Bookmark,
    BorderStyle,
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
} from 'docx'
import type {
    Blockquote,
    Code,
    Definition,
    Heading,
    Html,
    Image,
    Link,
    LinkReference,
    List,
    ListItem,
    Paragraph as MdParagraph,
    PhrasingContent,
    RootContent,
    Table as MdTable,
    TableCell as MdTableCell,
    TableRow as MdTableRow,
    Text,
} from 'mdast'
import { visit } from 'unist-util-visit'
import type { ExportDocument } from '@/lib/markdown/export-document'
import { pdfPageSizeMm, resolvePdfExportLayout } from '@/lib/markdown/export-html-css'
import { pdfPageNumberTemplate, resolvePdfChromeText } from '@/lib/markdown/export-metadata'
import { highlightFencedCodeTokens, type HighlightedToken } from '@/lib/markdown/shiki-highlighter'
import { renderMermaidDiagramForExport } from '@/lib/mermaid/render'
import { svgToPngBlob } from '@/lib/mermaid/export'
import type { AppThemeId } from '@/lib/theme/catalog'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'

type Block = Paragraph | Table
type ImageKind = 'png' | 'jpg' | 'gif' | 'bmp'
type PreparedCode =
    | { kind: 'code'; lines: HighlightedToken[][] }
    | { kind: 'diagram'; png: Uint8Array | null; source: string }
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
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const GRID_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'E5E5E5' }
/** Same cap the PDF cover uses (`max-height: 150mm`). */
const LOGO_MAX_HEIGHT_MM = 150
/** CSS heading sizes: 1.5rem, 1.25rem, 1.125rem, 1rem, then the two smaller steps. */
const HEADING_HALF_POINTS = [36, 30, 27, 24, 22, 20] as const
/** CSS heading margins, in twips. 1rem = 240. */
const HEADING_SPACING = [
    { before: 0, after: 240 },
    { before: 360, after: 180 },
    { before: 300, after: 120 },
    { before: 240, after: 120 },
    { before: 200, after: 80 },
    { before: 160, after: 80 },
] as const
/** PDF list padding (`padding-left: 1.25rem`) is about this. The marker hangs inside it, not in the page margin. */
const LIST_STEP = 360
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

function wordFont(stack: string, fallback: string): string {
    for (const part of stack.split(',')) {
        const name = part.trim().replace(/^["']|["']$/g, '')
        if (!name || name.startsWith('-') || GENERIC_FONTS.has(name) || SKIP_FONTS.has(name.toLowerCase())) continue
        return name
    }
    return fallback
}

function hexColor(value: string, fallback: string): string {
    const raw = value.trim().replace(/^#/, '')
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase()
    if (/^[0-9a-fA-F]{3}$/.test(raw))
        return raw
            .split('')
            .map((char) => `${char}${char}`)
            .join('')
            .toUpperCase()
    return fallback
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
    const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(trimmed)
    if (!match) return null
    const payload = match[3]!
    try {
        if (match[2]) {
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

function embeddedImage(dataUrl: string, maxWidth: number, maxHeight: number, name: string): ImageRun | null {
    const bytes = decodeDataUrl(dataUrl)
    if (!bytes) return null
    const kind = imageKind(bytes)
    if (!kind) return null
    const size = fit(imageSize(kind, bytes) ?? { width: maxWidth, height: maxHeight }, maxWidth, maxHeight)
    return new ImageRun({ type: kind, data: bytes, transformation: size, altText: { name, description: name } })
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

/** Diagonal watermark. Returns null where canvas is unavailable; the caller then writes the words into the header. */
async function createWatermarkPng(text: string): Promise<Uint8Array | null> {
    const trimmed = text.trim()
    if (!trimmed) return null
    try {
        const canvas = document.createElement('canvas')
        canvas.width = 900
        canvas.height = 220
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.translate(canvas.width / 2, canvas.height / 2)
        ctx.rotate(-Math.PI / 6)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
        ctx.font = '700 72px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(trimmed, 0, 0)
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'))
        if (!blob) return null
        return new Uint8Array(await blob.arrayBuffer())
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

function plainText(node: { value?: string; children?: unknown[] }): string {
    if (typeof node.value === 'string') return node.value
    if (!Array.isArray(node.children)) return ''
    return node.children.map((child) => plainText(child as { value?: string; children?: unknown[] })).join('')
}

type RenderState = {
    document: ExportDocument
    prepared: Map<Code, PreparedCode>
    numbering: { reference: string; levels: ILevelsOptions[] }[]
    nextList: number
    footnotes: Record<number, { children: Paragraph[] }>
    definitions: Map<string, string>
    footnoteIds: Map<string, number>
    bodyFont: string
    headingFont: string
    monoFont: string
    accent: string
    link: string
    bodyHalfPoints: number
    contentPx: number
    contentTwip: number
    pageWidthPx: number
    pageWidthTwip: number
    /** Paragraph inset used when the page's own side margins are zero so a bar can reach the paper edge. */
    insetLeft: number
    insetRight: number
}

function createState(document: ExportDocument, prepared: Map<Code, PreparedCode>): RenderState {
    const { profile } = document
    const portrait = pdfPageSizeMm(profile)
    const landscape = profile.page.orientation === 'landscape'
    const widthMm = landscape ? portrait.height : portrait.width
    const marginLeft = convertMillimetersToTwip(profile.page.marginsMm.left)
    const marginRight = convertMillimetersToTwip(profile.page.marginsMm.right)
    const widthTwip = convertMillimetersToTwip(widthMm)
    const layout = resolvePdfExportLayout(profile)
    const sidesBleed = layout.headerBleeds || layout.footerBleeds
    return {
        document,
        prepared,
        numbering: [],
        nextList: 1,
        footnotes: {},
        definitions: collectDefinitions(document.tree),
        footnoteIds: new Map(),
        bodyFont: wordFont(profile.typography.bodyFont, 'Calibri'),
        headingFont: wordFont(profile.typography.headingFont, 'Calibri'),
        monoFont: wordFont(profile.typography.monoFont, 'Consolas'),
        accent: hexColor(profile.brand.accentColor, '262626'),
        link: hexColor(profile.brand.linkColor.trim() || profile.brand.accentColor, '262626'),
        bodyHalfPoints: Math.round(profile.typography.bodySizePt * 2),
        contentPx: mmToPx(widthMm - profile.page.marginsMm.left - profile.page.marginsMm.right),
        contentTwip: widthTwip - marginLeft - marginRight,
        pageWidthPx: mmToPx(widthMm),
        pageWidthTwip: widthTwip,
        insetLeft: sidesBleed ? marginLeft : 0,
        insetRight: sidesBleed ? marginRight : 0,
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

/** Body text inset. Empty when the page margins already provide it. */
function contentIndent(state: RenderState, extraLeft = 0): { left: number; right: number } | undefined {
    const left = state.insetLeft + extraLeft
    const right = state.insetRight
    if (left === 0 && right === 0) return undefined
    return { left, right }
}

function footnoteId(state: RenderState, identifier: string): number {
    const existing = state.footnoteIds.get(identifier)
    if (existing) return existing
    const id = state.footnoteIds.size + 1
    state.footnoteIds.set(identifier, id)
    return id
}

function textRun(state: RenderState, text: string, marks: Marks = {}): TextRun {
    const heading = marks.headingSize
    const color = marks.link ? state.link : marks.quote ? '525252' : heading !== undefined ? state.accent : undefined
    return new TextRun({
        text,
        bold: marks.bold || heading !== undefined,
        italics: marks.italics || marks.quote,
        strike: marks.strike,
        font: marks.code ? state.monoFont : heading !== undefined ? state.headingFont : state.bodyFont,
        size: marks.code ? Math.max(16, Math.round(state.bodyHalfPoints * 0.85)) : (heading ?? state.bodyHalfPoints),
        color,
        shading: marks.code ? { type: ShadingType.CLEAR, fill: 'F5F5F5' } : undefined,
        underline: marks.link ? { type: UnderlineType.SINGLE, color: state.link } : undefined,
    })
}

function renderInlines(
    state: RenderState,
    nodes: PhrasingContent[],
    marks: Marks = {}
): (TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | FootnoteReferenceRun)[] {
    const children: (TextRun | ImageRun | ExternalHyperlink | InternalHyperlink | FootnoteReferenceRun)[] = []
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
        } else if (node.type === 'image') {
            const image = renderImage(state, node)
            children.push(image ?? textRun(state, node.alt || node.url, marks))
        } else if (node.type === 'imageReference') {
            children.push(textRun(state, node.alt || node.identifier, marks))
        } else if (node.type === 'footnoteReference') {
            children.push(new FootnoteReferenceRun(footnoteId(state, node.identifier)))
        } else {
            children.push(textRun(state, (node as Html).value, marks))
        }
    }
    return children
}

function collectDefinitions(tree: ExportDocument['tree']): Map<string, string> {
    const urls = new Map<string, string>()
    visit(tree, 'definition', (node: Definition) => {
        urls.set(node.identifier, node.url)
    })
    return urls
}

function renderLink(state: RenderState, node: Link | LinkReference, marks: Marks) {
    const inner = renderInlines(state, node.children, { ...marks, link: true })
    if (inner.length === 0) return []
    const url = node.type === 'link' ? node.url : state.definitions.get(node.identifier)!
    if (url.startsWith('#')) return [new InternalHyperlink({ anchor: url.slice(1), children: inner })]
    return [new ExternalHyperlink({ link: url, children: inner })]
}

function renderImage(state: RenderState, node: Image): ImageRun | null {
    return embeddedImage(node.url, Math.min(state.contentPx, 640), 480, node.alt || 'image')
}

function paragraphOptions(state: RenderState, marks: Marks = {}) {
    return {
        spacing: { after: 120, ...bodyLineSpacing(state) },
        border: marks.quote ? { left: { style: BorderStyle.SINGLE, size: 12, color: state.accent, space: 8 } } : undefined,
        indent: contentIndent(state, marks.quote ? 120 : 0),
    }
}

function renderParagraph(state: RenderState, node: MdParagraph, marks: Marks = {}): Paragraph {
    const justify = state.document.profile.typography.justify && !marks.quote
    return new Paragraph({
        ...paragraphOptions(state, marks),
        alignment: justify ? AlignmentType.JUSTIFIED : undefined,
        children: renderInlines(state, node.children, marks),
    })
}

function headingId(node: Heading): string {
    const props = node.data?.hProperties as { id?: string } | undefined
    return typeof props?.id === 'string' ? props.id : ''
}

function renderHeading(state: RenderState, node: Heading, isFirstBlock: boolean): Paragraph {
    const depth = Math.min(Math.max(node.depth, 1), 6)
    const level = state.document.profile.flow.newPageFromHeading
    const id = headingId(node)
    const inlines = renderInlines(state, node.children, { headingSize: HEADING_HALF_POINTS[depth - 1] })
    return new Paragraph({
        heading: HEADING_LEVELS[depth - 1],
        pageBreakBefore: level >= 1 && !isFirstBlock && node.depth <= level,
        keepNext: true,
        spacing: {
            ...HEADING_SPACING[depth - 1],
            line: lineBoxTwip(HEADING_HALF_POINTS[depth - 1]!, state.document.profile.typography.lineHeight),
            lineRule: LineRuleType.AT_LEAST,
        },
        indent: contentIndent(state),
        children: id ? [new Bookmark({ id, children: inlines })] : inlines,
    })
}

function listIndent(state: RenderState, depth: number, hang: boolean): { left: number; hanging: number; right: number } {
    const text = state.insetLeft + LIST_STEP * (depth + 1)
    return { left: text, hanging: hang ? LIST_STEP : 0, right: state.insetRight }
}

function listNumbering(state: RenderState, ordered: boolean, depth: number, start: number): string {
    const reference = `list-${state.nextList}`
    state.nextList += 1
    state.numbering.push({
        reference,
        levels: [
            {
                level: 0,
                format: ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET,
                text: ordered ? '%1.' : '•',
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
    const reference = listNumbering(state, ordered, depth, ordered && list.start && list.start > 1 ? list.start : 1)
    const blocks: Block[] = []
    for (const item of list.children) blocks.push(...(await renderListItem(state, item, reference, depth)))
    return blocks
}

async function renderListItem(state: RenderState, item: ListItem, reference: string, depth: number): Promise<Block[]> {
    const blocks: Block[] = []
    let markerPlaced = false
    const task = item.checked === true || item.checked === false
    const prefix = item.checked === true ? '☑ ' : item.checked === false ? '☐ ' : ''
    for (const child of item.children) {
        if (child.type === 'paragraph') {
            const inlines = renderInlines(state, child.children)
            if (prefix && !markerPlaced) inlines.unshift(textRun(state, prefix))
            blocks.push(
                new Paragraph({
                    spacing: { after: 60, ...bodyLineSpacing(state) },
                    indent: listIndent(state, depth, !task && !markerPlaced),
                    numbering: task || markerPlaced ? undefined : { reference, level: 0 },
                    children: inlines,
                })
            )
            markerPlaced = true
        } else if (child.type === 'list') {
            blocks.push(...(await renderList(state, child, depth + 1)))
        } else {
            blocks.push(...(await renderBlocks(state, [child])))
        }
    }
    if (!markerPlaced) {
        blocks.unshift(
            new Paragraph({
                spacing: { after: 60, ...bodyLineSpacing(state) },
                indent: listIndent(state, depth, true),
                numbering: { reference, level: 0 },
            })
        )
    }
    return blocks
}

async function renderBlockquote(state: RenderState, node: Blockquote): Promise<Block[]> {
    const blocks: Block[] = []
    for (const child of node.children) {
        if (child.type === 'paragraph') blocks.push(renderParagraph(state, child, { quote: true, italics: true }))
        else blocks.push(...(await renderBlocks(state, [child])))
    }
    return blocks
}

function renderTable(state: RenderState, table: MdTable): Table {
    const width = Math.max(1, state.contentTwip)
    return new Table({
        width: { size: width, type: WidthType.DXA },
        columnWidths: columnWidths(table, width),
        indent: state.insetLeft > 0 ? { size: state.insetLeft, type: WidthType.DXA } : undefined,
        margins: TABLE_CELL_MARGIN,
        layout: TableLayoutType.FIXED,
        rows: table.children.map((row, rowIndex) => renderTableRow(state, row, table.align, rowIndex === 0)),
    })
}

function columnWidths(table: MdTable, width: number): number[] {
    const count = table.children[0]!.children.length
    const column = Math.round(width / count)
    return Array.from({ length: count }, () => column)
}

function renderTableRow(state: RenderState, row: MdTableRow, align: MdTable['align'], header: boolean): TableRow {
    return new TableRow({
        tableHeader: header,
        children: row.children.map((cell, index) => renderTableCell(state, cell, align?.[index], header)),
    })
}

function renderTableCell(state: RenderState, cell: MdTableCell, align: 'left' | 'center' | 'right' | null | undefined, header: boolean): TableCell {
    return new TableCell({
        verticalAlign: VerticalAlignTable.TOP,
        margins: TABLE_CELL_MARGIN,
        shading: header ? { type: ShadingType.CLEAR, fill: 'F5F5F5' } : undefined,
        borders: { top: GRID_BORDER, bottom: GRID_BORDER, left: GRID_BORDER, right: GRID_BORDER },
        children: [
            new Paragraph({
                spacing: { after: 0, ...bodyLineSpacing(state) },
                alignment: align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.END : AlignmentType.START,
                children: renderInlines(state, cell.children, header ? { bold: true } : {}),
            }),
        ],
    })
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
    return lines.map((line, index) => {
        const runs = line.flatMap((token) =>
            token.text ? [new TextRun({ text: token.text, font: state.monoFont, size: 18, color: hexColor(token.color ?? fallback, fallback) })] : []
        )
        return new Paragraph({
            shading: { type: ShadingType.CLEAR, fill },
            indent: contentIndent(state),
            spacing: { before: index === 0 ? 80 : 0, after: index === lines.length - 1 ? 80 : 0, line: 276, lineRule: LineRuleType.AUTO },
            children: runs.length > 0 ? runs : [new TextRun({ text: ' ', font: state.monoFont, size: 18 })],
        })
    })
}

function renderPrepared(state: RenderState, prepared: PreparedCode): Block[] {
    if (prepared.kind === 'error') {
        return [new Paragraph({ ...paragraphOptions(state), children: [textRun(state, prepared.message, { code: true })] })]
    }
    if (prepared.kind === 'diagram') {
        const size = prepared.png ? imageSize('png', prepared.png) : null
        if (!prepared.png || !size)
            return renderCodeLines(
                state,
                prepared.source.split('\n').map((text) => [{ text }])
            )
        return [
            new Paragraph({
                ...paragraphOptions(state),
                children: [
                    new ImageRun({
                        type: 'png',
                        data: prepared.png,
                        transformation: fit(size, Math.min(state.contentPx, 640), 480),
                        altText: { name: 'Diagram', description: 'Diagram' },
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
        if (node.type === 'heading') blocks.push(renderHeading(state, node, parentIsRoot && index === 0))
        else if (node.type === 'paragraph') blocks.push(renderParagraph(state, node))
        else if (node.type === 'list') blocks.push(...(await renderList(state, node, 0)))
        else if (node.type === 'blockquote') blocks.push(...(await renderBlockquote(state, node)))
        else if (node.type === 'code') blocks.push(...renderPrepared(state, state.prepared.get(node)!))
        else if (node.type === 'table') blocks.push(renderTable(state, node))
        else if (node.type === 'thematicBreak') {
            blocks.push(new Paragraph({ border: { bottom: GRID_BORDER }, indent: contentIndent(state), spacing: { before: 200, after: 200 } }))
        } else if (node.type === 'html') {
            blocks.push(new Paragraph({ ...paragraphOptions(state), children: [textRun(state, (node as Html).value)] }))
        } else if (node.type === 'footnoteDefinition') {
            const id = footnoteId(state, node.identifier)
            const note = plainText(node).trim()
            state.footnotes[id] = { children: [new Paragraph({ children: [new TextRun(note || ' ')] })] }
        }
    }
    return blocks
}

function chromeVisible(profile: PdfExportProfile, kind: 'header' | 'footer', group: 'title' | 'toc' | 'body'): boolean {
    const layout = resolvePdfExportLayout(profile)
    const shown = kind === 'header' ? layout.showHeader : layout.showFooter
    if (!shown) return false
    const hide = (kind === 'header' ? profile.header : profile.footer).hideOnFirstPages
    if (group === 'body' || hide === 'none') return true
    if (group === 'title') return false
    return hide === 'title'
}

function edgeDistance(bleeds: boolean, marginMm: number): number {
    if (bleeds) return 0
    return convertMillimetersToTwip(Math.min(8, marginMm))
}

function pageNumberRuns(state: RenderState, color: string): TextRun[] {
    const { profile, metadata } = state.document
    const format = profile.footer.pageNumbers
    const run = (text?: string, field?: (typeof PageNumber)[keyof typeof PageNumber]) =>
        new TextRun({ text, children: field ? [field] : undefined, font: state.bodyFont, size: state.bodyHalfPoints, color })
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
    const bleeds =
        kind === 'header' ? resolvePdfExportLayout(state.document.profile).headerBleeds : resolvePdfExportLayout(state.document.profile).footerBleeds
    const pad = bleeds
        ? { left: align === AlignmentType.RIGHT ? 0 : state.insetLeft, right: align === AlignmentType.RIGHT ? state.insetRight : 0 }
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

function chromeTable(state: RenderState, kind: 'header' | 'footer'): (Paragraph | Table)[] {
    const { profile, metadata, assets } = state.document
    const layout = resolvePdfExportLayout(profile)
    const chrome = kind === 'header' ? profile.header : profile.footer
    const bleeds = kind === 'header' ? layout.headerBleeds : layout.footerBleeds
    const sidesBleed = layout.headerBleeds || layout.footerBleeds
    const images = kind === 'header' ? assets.header : assets.footer
    const color = hexColor(chrome.textColor, '262626')
    const maxHeight = chrome.heightMm > 0 ? mmToPx(chrome.heightMm) : 28
    const leftImage = embeddedImage(images.left, 160, maxHeight, `${kind} left`)
    const rightImage = embeddedImage(images.right, 160, maxHeight, `${kind} right`)
    const leftText = resolvePdfChromeText(chrome.left.text, metadata)
    const rightRuns = kind === 'footer' ? pageNumberRuns(state, color) : textRuns(state, resolvePdfChromeText(chrome.right.text, metadata), color)
    const leftChildren = [...(leftImage ? [leftImage] : []), ...(leftText ? [textRun(state, leftText)] : [])]
    const rightChildren = [...rightRuns, ...(rightImage ? [rightImage] : [])]
    const width = bleeds ? state.pageWidthTwip : state.contentTwip
    const leftWidth = Math.max(1, Math.round(width / 2))
    const rightWidth = Math.max(1, width - leftWidth)
    const shading = chrome.backgroundColor.trim() ? { type: ShadingType.CLEAR, fill: hexColor(chrome.backgroundColor, 'FFFFFF') } : undefined
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
        indent: !bleeds && sidesBleed ? { size: state.insetLeft, type: WidthType.DXA } : undefined,
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
    return text ? [new TextRun({ text, font: state.bodyFont, size: state.bodyHalfPoints, color })] : []
}

function watermarkBlocks(state: RenderState, png: Uint8Array | null): Paragraph[] {
    const text = state.document.profile.content.watermark.trim()
    if (!text) return []
    if (!png) {
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
                    data: png,
                    transformation: { width: 500, height: 140 },
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

/** A cover image that should run to the paper edge. The PDF keys this off the logo path; here the resolved image is what gets drawn. */
function logoHasBleed(state: RenderState): boolean {
    const { profile, assets } = state.document
    return profile.frontMatter.titlePage && profile.brand.logoIgnoreMargins && assets.logoDataUrl.trim() !== ''
}

/**
 * The cover can be its own zero-margin page when its header/footer differ from
 * the next page. An inline page-width image then reaches the paper edge; a
 * floating image would sit in the margin, which Word on the web clips.
 */
function coverIsInline(state: RenderState): boolean {
    const { profile, toc } = state.document
    if (!logoHasBleed(state) || headerShowsOnTitle(profile)) return false
    const next: 'toc' | 'body' = toc.length > 0 ? 'toc' : 'body'
    return (
        chromeVisible(profile, 'header', 'title') !== chromeVisible(profile, 'header', next) ||
        chromeVisible(profile, 'footer', 'title') !== chromeVisible(profile, 'footer', next)
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
    const bytes = decodeDataUrl(assets.logoDataUrl)
    if (!bytes) return null
    const kind = imageKind(bytes)
    if (!kind) return null
    const intrinsic = imageSize(kind, bytes)
    const bleed = profile.brand.logoIgnoreMargins
    const inline = coverIsInline(state)
    // Stay a hair inside the sheet. Rounding millimetres up to pixels makes the image wider than the page, and Word then wraps it.
    const maxWidth = bleed ? Math.max(1, Math.floor(state.pageWidthTwip / 15)) : state.contentPx
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
            altText: { name: 'Logo', description: 'Logo' },
        }),
    }
}

function titleIndent(state: RenderState, edge: boolean): { left: number; right: number } | undefined {
    const inset = contentIndent(state)
    if (inset || !edge) return inset
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
    blocks.push(
        new Paragraph({
            indent,
            spacing: { before, after: 200, line: lineBoxTwip(48, profile.typography.lineHeight), lineRule: LineRuleType.AT_LEAST },
            children: [new TextRun({ text: metadata.title, bold: true, font: state.headingFont, size: 48, color: state.accent })],
        })
    )
    for (const line of [metadata.subtitle, metadata.author, metadata.date]) {
        if (!line) continue
        blocks.push(
            new Paragraph({
                indent,
                spacing: { after: 80 },
                children: [new TextRun({ text: line, font: state.bodyFont, size: state.bodyHalfPoints, color: '525252' })],
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
    const showHeader = chromeVisible(profile, 'header', group)
    const showFooter = chromeVisible(profile, 'footer', group)
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

function textBlockTwip(state: RenderState, text: string, halfPoints: number, width: number, before: number, after: number): number {
    const line = lineBoxTwip(halfPoints, state.document.profile.typography.lineHeight)
    const charTwip = Math.max(60, Math.round(halfPoints * 4.5))
    const perLine = Math.max(8, Math.floor(Math.max(width, charTwip) / charTwip))
    const length = Math.max(1, text.replace(/\s+/g, ' ').trim().length)
    return before + Math.ceil(length / perLine) * line + after
}

function imageTwip(state: RenderState, dataUrl: string): number {
    const bytes = decodeDataUrl(dataUrl)
    const kind = bytes ? imageKind(bytes) : null
    const size = bytes && kind ? imageSize(kind, bytes) : null
    const fitted = fit(size ?? { width: Math.min(state.contentPx, 640), height: 200 }, Math.min(state.contentPx, 640), 480)
    return pxToTwip(fitted.height)
}

function paragraphTwip(state: RenderState, node: MdParagraph, width: number): number {
    let image = 0
    const parts: string[] = []
    const walk = (nodes: PhrasingContent[]) => {
        for (const child of nodes) {
            if (child.type === 'image') image = Math.max(image, imageTwip(state, child.url))
            else if (child.type === 'text') parts.push(child.value)
            else if ('children' in child) walk(child.children)
        }
    }
    walk(node.children)
    const text = parts.join('')
    const textHeight = text.trim() ? textBlockTwip(state, text, state.bodyHalfPoints, width, 0, 120) : 120
    return image > 0 ? Math.max(textHeight, image + 120) : textHeight
}

function codeTwip(state: RenderState, node: Code): number {
    const prepared = state.prepared.get(node)
    if (prepared?.kind === 'diagram' && prepared.png) {
        const size = imageSize('png', prepared.png)
        const fitted = fit(size ?? { width: 640, height: 200 }, Math.min(state.contentPx, 640), 480)
        return pxToTwip(fitted.height) + 120
    }
    if (prepared?.kind === 'error') return textBlockTwip(state, prepared.message, state.bodyHalfPoints, state.contentTwip, 0, 120)
    const lines = prepared?.kind === 'code' ? Math.max(1, prepared.lines.length) : Math.max(1, node.value.replace(/\n$/, '').split('\n').length)
    return 160 + lines * 276
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
                textBlockTwip(state, plainText(node), HEADING_HALF_POINTS[depth - 1]!, width, spacing.before, spacing.after),
                breakBefore
            )
            const id = headingId(node)
            if (id) pages.set(id, cursor.page)
        } else if (node.type === 'paragraph') {
            placeBlock(cursor, pageHeight, paragraphTwip(state, node, width))
        } else if (node.type === 'list') {
            measureList(state, node, 0, width, pages, cursor, pageHeight)
        } else if (node.type === 'blockquote') {
            measureFlow(state, node.children, Math.max(200, width - 120), pages, cursor, pageHeight, false)
        } else if (node.type === 'code') {
            placeBlock(cursor, pageHeight, codeTwip(state, node))
        } else if (node.type === 'table') {
            const columns = Math.max(1, node.children[0].children.length)
            const column = Math.max(200, Math.floor(width / columns) - 360)
            let table = 200
            for (const row of node.children) {
                let rowHeight = 240
                for (const cell of row.children)
                    rowHeight = Math.max(rowHeight, textBlockTwip(state, plainText(cell), state.bodyHalfPoints, column, 120, 120))
                table += rowHeight
            }
            placeBlock(cursor, pageHeight, table)
        } else if (node.type === 'thematicBreak') {
            placeBlock(cursor, pageHeight, 400)
        } else if (node.type === 'html') {
            placeBlock(cursor, pageHeight, textBlockTwip(state, node.value, state.bodyHalfPoints, width, 0, 120))
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

/** Page each contents entry lands on. Word on the web never fills a TOC field, so the number is written in. */
function headingPages(state: RenderState): Map<string, number> {
    const { profile, toc, tree } = state.document
    let page = (profile.frontMatter.titlePage ? 1 : 0) + 1
    const tocHeight = pageContentTwip(state, 'toc')
    let used = 560
    let first = true
    for (const item of toc) {
        const height = tocEntrySpacing(item.level, first).before + 260
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

function tocRun(state: RenderState, text: string, level: number, pageNumber = false): TextRun {
    const size = level >= 4 ? Math.round(state.bodyHalfPoints * 0.9) : level === 3 ? Math.round(state.bodyHalfPoints * 0.94) : state.bodyHalfPoints
    const color = pageNumber ? '404040' : level <= 1 ? '171717' : level >= 4 ? '525252' : level === 3 ? '404040' : '262626'
    return new TextRun({ text, bold: level <= 1 && !pageNumber, font: state.bodyFont, size, color })
}

function tocBlocks(state: RenderState): Paragraph[] {
    const pages = headingPages(state)
    const tab = state.contentTwip + state.insetLeft
    let first = true
    const entries = state.document.toc.map((item) => {
        const level = Math.min(Math.max(item.level, 1), 6)
        const spacing = tocEntrySpacing(level, first)
        first = false
        const left = state.insetLeft + (level - 1) * 240
        return new Paragraph({
            spacing,
            indent: { left, right: state.insetRight },
            tabStops: [{ type: TabStopType.RIGHT, position: Math.max(left + 240, tab), leader: LeaderType.DOT }],
            children: [
                new InternalHyperlink({
                    anchor: item.id,
                    children: [
                        tocRun(state, item.text, level),
                        new TextRun({ children: [new Tab()], font: state.bodyFont, size: state.bodyHalfPoints }),
                        tocRun(state, String(pages.get(item.id) ?? 1), level, true),
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
            children: [new TextRun({ text: 'Contents', bold: true, font: state.headingFont, size: 40, color: state.accent })],
        }),
        ...entries,
    ]
}

type FrontGroup = 'title' | 'toc' | 'body'

function sectionProperties(state: RenderState, showHeader: boolean, showFooter: boolean, titleOnly: boolean): ISectionOptions['properties'] {
    const { profile } = state.document
    const layout = resolvePdfExportLayout(profile)
    const portrait = pdfPageSizeMm(profile)
    const landscape = profile.page.orientation === 'landscape'
    const margins = profile.page.marginsMm
    const sidesBleed = layout.headerBleeds || layout.footerBleeds
    const coverEdge = titleOnly && logoHasBleed(state) && !showHeader
    const center = titleOnly && !logoHasBleed(state)
    const topMm = coverEdge
        ? 0
        : layout.headerBleeds && showHeader
          ? Math.max(margins.top, profile.header.heightMm + profile.header.gapMm)
          : margins.top
    const bottomMm = layout.footerBleeds && showFooter ? Math.max(margins.bottom, profile.footer.heightMm + profile.footer.gapMm) : margins.bottom
    const zeroSides = sidesBleed || coverEdge
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

function buildSections(state: RenderState, groups: { id: FrontGroup; children: Block[] }[], watermark: Uint8Array | null): ISectionOptions[] {
    const { profile } = state.document
    const merged: { key: string; showHeader: boolean; showFooter: boolean; titleOnly: boolean; children: Block[] }[] = []
    for (const group of groups) {
        const showHeader = chromeVisible(profile, 'header', group.id)
        const showFooter = chromeVisible(profile, 'footer', group.id)
        const key = `${showHeader}:${showFooter}`
        const previous = merged[merged.length - 1]
        if (previous && previous.key === key) {
            previous.titleOnly = false
            previous.children.push(new Paragraph({ children: [new PageBreak()] }), ...group.children)
        } else {
            merged.push({ key, showHeader, showFooter, titleOnly: group.id === 'title', children: [...group.children] })
        }
    }

    return merged.map((section, index) => {
        const chrome = section.showHeader ? chromeTable(state, 'header') : []
        const headerChildren = [...chrome, ...watermarkBlocks(state, watermark)]
        return {
            properties: {
                ...sectionProperties(state, section.showHeader, section.showFooter, section.titleOnly),
                type: index === 0 ? undefined : SectionType.NEXT_PAGE,
            },
            headers: headerChildren.length > 0 ? { default: new Header({ children: headerChildren }) } : undefined,
            footers: section.showFooter ? { default: new Footer({ children: chromeTable(state, 'footer') }) } : undefined,
            children: section.children,
        }
    })
}

async function prepareCode(node: Code, profile: PdfExportProfile): Promise<PreparedCode> {
    const text = node.value.replace(/\n$/, '')
    if ((node.lang ?? '').toLowerCase() === 'mermaid') {
        try {
            const svg = renderMermaidDiagramForExport(text, profile.content.mermaidThemeId)
            return { kind: 'diagram', png: await diagramPng(svg, profile.content.mermaidThemeId), source: text }
        } catch (err) {
            return { kind: 'error', message: errorMessage(err) }
        }
    }
    return { kind: 'code', lines: await highlightFencedCodeTokens(text, node.lang ?? undefined, profile.content.codeTheme) }
}

/** Word renderer for an {@link ExportDocument}. */
export async function renderExportDocx(document: ExportDocument): Promise<Uint8Array> {
    const codes: Code[] = []
    visit(document.tree, 'code', (node: Code) => {
        codes.push(node)
    })
    const preparedList = await Promise.all(codes.map((node) => prepareCode(node, document.profile)))
    const prepared = new Map(codes.map((node, index) => [node, preparedList[index]!]))
    const state = createState(document, prepared)
    const body = await renderBlocks(state, document.tree.children, true)
    const groups: { id: FrontGroup; children: Block[] }[] = []
    if (document.profile.frontMatter.titlePage) groups.push({ id: 'title', children: await titleBlocks(state) })
    if (document.toc.length > 0) groups.push({ id: 'toc', children: tocBlocks(state) })
    groups.push({ id: 'body', children: body })
    const watermark = await createWatermarkPng(document.profile.content.watermark)

    const doc = new Document({
        title: document.metadata.title,
        creator: document.metadata.author || undefined,
        description: document.metadata.subtitle || undefined,
        features: { updateFields: true },
        styles: {
            default: {
                document: {
                    run: { font: state.bodyFont, size: state.bodyHalfPoints, color: '262626' },
                    paragraph: { spacing: bodyLineSpacing(state) },
                },
                heading1: { run: { font: state.headingFont, size: 36, bold: true, color: state.accent } },
                heading2: { run: { font: state.headingFont, size: 30, bold: true, color: state.accent } },
                heading3: { run: { font: state.headingFont, size: 27, bold: true, color: state.accent } },
                heading4: { run: { font: state.headingFont, size: 24, bold: true, color: state.accent } },
                heading5: { run: { font: state.headingFont, size: 22, bold: true, color: state.accent } },
                heading6: { run: { font: state.headingFont, size: 20, bold: true, color: state.accent } },
                hyperlink: { run: { color: state.link, underline: { type: UnderlineType.SINGLE, color: state.link } } },
            },
        },
        numbering: state.numbering.length > 0 ? { config: state.numbering } : undefined,
        footnotes: Object.keys(state.footnotes).length > 0 ? state.footnotes : undefined,
        sections: buildSections(state, groups, watermark),
    })

    const buffer = await Packer.toBuffer(doc)
    return new Uint8Array(buffer)
}
