import { inflateRawSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const isTauri = vi.hoisted(() => vi.fn(() => true))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@/lib/tauri/platform', () => ({ isTauri, isWindowsTauri: () => true }))

const { embedDocumentImages } = await import('./export-images')
const { buildExportDocument } = await import('./export-document')
const { renderExportPdf } = await import('./markdown-to-export-html')
const { renderExportDocx } = await import('./export-docx')
const { forgetWorkspaceImages } = await import('@/lib/workspace/workspace-images')

const ROOT = 'C:\\notes'
const DOC = 'C:\\notes\\guides\\setup.md'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+'

/** A real PNG that says it is 4000×1000 pixels. */
const WIDE_PNG = (() => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    bytes.writeUInt32BE(4000, 16)
    bytes.writeUInt32BE(1000, 20)
    return `data:image/png;base64,${bytes.toString('base64')}`
})()

/** The main part of a Word file: the zip entry `word/document.xml`, unpacked. */
function wordXml(docx: Uint8Array): string {
    const data = Buffer.from(docx)
    for (let offset = 0; data.readUInt32LE(offset) === 0x04034b50;) {
        const compressed = data.readUInt32LE(offset + 18)
        const nameLength = data.readUInt16LE(offset + 26)
        const start = offset + 30 + nameLength + data.readUInt16LE(offset + 28)
        const body = data.subarray(start, start + compressed)
        if (data.toString('utf8', offset + 30, offset + 30 + nameLength) === 'word/document.xml') {
            return (data.readUInt16LE(offset + 8) === 0 ? body : inflateRawSync(body)).toString('utf8')
        }
        offset = start + compressed
    }
    throw new Error('No word/document.xml')
}

type Files = Record<string, string | Error>

/** The app's answer for each file in the open folder: a picture, or why it can't be read. */
function folderHas(files: Files) {
    invoke.mockImplementation(async (command: string, args: { root?: string; path?: string }) => {
        if (command !== 'read_workspace_image') throw new Error(`unexpected ${command}`)
        expect(args.root).toBe(ROOT)
        const found = files[args.path!]
        if (found === undefined) throw 'Image not found.'
        if (found instanceof Error) throw found.message
        return found
    })
}

/** The body of the PDF page for `source` once its images are embedded, and what was left out. */
async function exportBody(source: string, options: { allowRemoteImages?: boolean; documentPath?: string | null } = {}) {
    const document = buildExportDocument(source)
    const { missing, webImagesLeftOut } = await embedDocumentImages(document.tree, {
        documentPath: options.documentPath === undefined ? DOC : options.documentPath,
        workspaceRoot: ROOT,
        allowRemoteImages: options.allowRemoteImages ?? false,
    })
    const { html } = await renderExportPdf(document, { allowRemoteImages: options.allowRemoteImages ?? false })
    return { body: html.slice(html.indexOf('<div class="pdf-body">')), missing, webImagesLeftOut }
}

describe('embedDocumentImages', () => {
    beforeEach(() => {
        invoke.mockReset()
        isTauri.mockReturnValue(true)
        // Read afresh in each test: the folder's images are kept in memory between reads.
        forgetWorkspaceImages([ROOT])
    })

    it('embeds an image from the open folder, found from the document', async () => {
        folderHas({ 'C:\\notes\\guides\\chart.png': PNG })

        const { body, missing } = await exportBody('![Sales chart](chart.png)')

        expect(body).toContain(`<img src="${PNG}" alt="Sales chart">`)
        expect(missing).toEqual([])
    })

    it('lists each image it couldn’t embed, once, and prints its alt text in its place', async () => {
        folderHas({ 'C:\\notes\\guides\\huge.png': new Error('Image is too large to show (limit 12 MB).') })

        const { body, missing } = await exportBody('![Old chart](gone.png) and ![](gone.png)\n\n![](huge.png)\n\n![Key](../../secret.png)')

        expect(body).not.toContain('<img')
        expect(body).toContain('<p dir="auto">Old chart and [image]</p>')
        expect(body).toContain('<p dir="auto">Key</p>')
        expect(missing).toEqual([
            { slot: 'Image', path: 'gone.png', reason: 'Image not found.' },
            { slot: 'Image', path: 'huge.png', reason: 'Image is too large to show (limit 12 MB).' },
            { slot: 'Image', path: '../../secret.png', reason: 'Only images inside the open folder are shown.' },
        ])
    })

    it('embeds reference-style images, leaving links to the same address alone', async () => {
        folderHas({ 'C:\\notes\\guides\\logo.png': PNG })

        const { body, missing } = await exportBody(
            '![Logo][brand] [the file][brand] ![Gone][missing] ![no definition][nowhere]\n\n[brand]: logo.png "Our logo"\n[missing]: gone.png\n[Brand]: other.png'
        )

        expect(body).toContain(`<img src="${PNG}" alt="Logo" title="Our logo">`)
        expect(body).toContain('<a href="logo.png" title="Our logo">the file</a>')
        expect(body).toContain('Gone ![no definition][nowhere]')
        expect(missing).toEqual([{ slot: 'Image', path: 'gone.png', reason: 'Image not found.' }])
    })

    it('embeds images in raw HTML, keeping their size, and prints the alt text of one it couldn’t read', async () => {
        folderHas({ 'C:\\notes\\guides\\logo.png': PNG, 'C:\\notes\\guides\\a&b.png': PNG })

        const { body, missing } = await exportBody(
            [
                '<p align="center"><img src="logo.png" width="120" alt="Logo > all"></p>',
                'Inline <img src=\'gone.png\' alt="Gone"> and <IMG SRC=a&amp;b.png> here.<br><img alt="No address">',
                '<div><img src="gone.png" width="300"> <img src="lost.png" alt="A < B"></div>',
                '<!-- <img src="old.png"> -->',
            ].join('\n\n')
        )

        expect(body).toContain(`<p align="center" dir="auto"><img src="${PNG}" width="120" alt="Logo > all"></p>`)
        // As for a Markdown picture: its alt text or [image], not an empty gap the picture's size.
        expect(body).toContain(`Inline Gone and <img src="${PNG}"> here.<br><img alt="No address">`)
        expect(body).toContain('[image] A &#x3C; B</div>')
        expect(missing).toEqual([
            { slot: 'Image', path: 'gone.png', reason: 'Image not found.' },
            { slot: 'Image', path: 'lost.png', reason: 'Image not found.' },
        ])
        expect(invoke).toHaveBeenCalledTimes(4)
    })

    it('leaves web images out, as the preview does, until the user loads them there, and counts them', async () => {
        const { body, missing, webImagesLeftOut } = await exportBody(
            '![Badge](https://img.example.com/b.svg) <img src="http://img.example.com/c.png" alt="Chart"> ![Again](https://img.example.com/b.svg)'
        )

        expect(body).toContain('<p dir="auto">Badge Chart Again</p>')
        expect(missing).toEqual([])
        // Once for each address, as the images it couldn't embed are listed.
        expect(webImagesLeftOut).toBe(2)
        expect(invoke).not.toHaveBeenCalled()
    })

    it('reads no picture the export never shows, and leaves those as written', async () => {
        folderHas({ 'C:\\notes\\guides\\logo.png': PNG })
        const hidden = [
            '<noscript><img src="https://tracker.example.com/p.gif"></noscript>',
            'Text <noscript>![Pixel](https://tracker.example.com/q.gif)</noscript>',
            '<template><img src="logo.png"></template>',
            '<script>\nlet a = \'<img src="https://tracker.example.com/s.gif">\'\n</script>',
            '<style>\n/* <img src="https://tracker.example.com/t.gif"> */\n</style>',
            '<textarea>\n<img src="https://tracker.example.com/u.gif">\n</textarea>',
            '<a title=\'<img src="https://tracker.example.com/w.gif">\'>Link</a>',
            '[^unused]: ![Never](https://tracker.example.com/v.gif)',
        ]
        const document = buildExportDocument([...hidden, '![Shown](logo.png)'].join('\n\n'))
        const asWritten = JSON.stringify(document.tree.children.slice(0, -1))

        for (const allowRemoteImages of [true, false]) {
            const result = await embedDocumentImages(document.tree, { documentPath: DOC, workspaceRoot: ROOT, allowRemoteImages })
            expect(result, `allowRemoteImages: ${allowRemoteImages}`).toEqual({ missing: [], webImagesLeftOut: 0 })
        }

        expect(invoke).toHaveBeenCalledTimes(1)
        expect(invoke).toHaveBeenCalledWith('read_workspace_image', { root: ROOT, path: 'C:\\notes\\guides\\logo.png' })
        expect(JSON.stringify(document.tree.children.slice(0, -1))).toBe(asWritten)
        const { html } = await renderExportPdf(document)
        // The textarea's text prints as written.
        expect(html).toContain('&#x3C;img src="https://tracker.example.com/u.gif">')
        expect(html).toContain(`<img src="${PNG}" alt="Shown">`)
    })

    it('downloads web images through the app once they are loaded, and lists the ones it couldn’t', async () => {
        invoke.mockImplementation(async (command: string, args: { url: string }) => {
            expect(command).toBe('fetch_export_image')
            if (args.url === 'https://img.example.com/b.svg') return SVG
            throw 'The site answered 404 Not Found.'
        })

        const { body, missing, webImagesLeftOut } = await exportBody(
            '![Badge](https://img.example.com/b.svg) ![Gone](//img.example.com/gone.png) ![Bad](http://[img.example.com/c.png)',
            { allowRemoteImages: true }
        )

        expect(body).toContain(`<p dir="auto"><img src="${SVG}" alt="Badge"> Gone Bad</p>`)
        expect(webImagesLeftOut).toBe(0)
        expect(missing).toEqual([
            { slot: 'Image', path: '//img.example.com/gone.png', reason: 'The site answered 404 Not Found.' },
            { slot: 'Image', path: 'http://[img.example.com/c.png', reason: 'This web address isn’t valid.' },
        ])
        // As the export page would read it.
        expect(invoke).toHaveBeenCalledWith('fetch_export_image', { url: 'http://img.example.com/gone.png' })
    })

    it('gives the Word file the same pictures, shrunk to the 718px text width', async () => {
        folderHas({ 'C:\\notes\\guides\\wide.png': WIDE_PNG })
        const document = buildExportDocument('![Wide](wide.png)\n\n<p><img src="wide.png" alt="Raw" width="9000"></p>')

        await embedDocumentImages(document.tree, { documentPath: DOC, workspaceRoot: ROOT, allowRemoteImages: false })
        const xml = wordXml((await renderExportDocx(document)).bytes)

        for (const descr of ['Wide', 'Raw']) {
            const at = xml.indexOf(`descr="${descr}"`)
            expect(at, descr).toBeGreaterThan(0)
            const extent = [...xml.slice(0, at).matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)].pop()!
            expect({ width: Number(extent[1]) / 9525, height: Number(extent[2]) / 9525 }, descr).toEqual({ width: 718, height: 180 })
        }
    })

    it('leaves inline pictures as they are, and outside the desktop app web images too', async () => {
        isTauri.mockReturnValue(false)

        const source = `![Dot](${PNG}) ![Badge](https://img.example.com/b.svg)`
        const { body, missing, webImagesLeftOut } = await exportBody(source, { allowRemoteImages: true })

        expect(body).toContain(`<img src="${PNG}" alt="Dot"> <img src="https://img.example.com/b.svg" alt="Badge" referrerpolicy="no-referrer">`)
        expect(missing).toEqual([])
        // The print dialog's page fetches it, so it isn't left out, unless the user hasn't loaded it.
        expect(webImagesLeftOut).toBe(0)
        await expect(exportBody(source)).resolves.toMatchObject({ webImagesLeftOut: 1 })
        expect(invoke).not.toHaveBeenCalled()
    })
})
