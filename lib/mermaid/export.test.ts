import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

const dialog = vi.hoisted(() => ({
    pickSavePath: vi.fn<(options: { defaultPath?: string }) => Promise<string | null>>(async () => null),
    writeBinaryFile: vi.fn(async () => undefined),
    writeTextFileAtPath: vi.fn(async () => undefined),
}))

type Notice = { description?: string; action?: { label: string; onClick: () => void } }
const notify = vi.hoisted(() => ({
    notifyError: vi.fn(),
    notifyWarning: vi.fn<(title: string, options?: Notice) => void>(),
    notifySuccess: vi.fn<(title: string, options?: Notice) => void>(),
}))
const opener = vi.hoisted(() => ({ revealItemInDir: vi.fn<(path: string) => Promise<void>>(async () => undefined) }))

const render = vi.hoisted(() => ({ fakeSvg: null as string | null }))

vi.mock('@/lib/tauri/dialog', () => dialog)
vi.mock('@tauri-apps/plugin-opener', () => opener)
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))
vi.mock('@/lib/notify', () => notify)
vi.mock('@/lib/mermaid/render', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/mermaid/render')>()
    return {
        ...actual,
        renderMermaidDiagramForExport: (...args: Parameters<typeof actual.renderMermaidDiagramForExport>) =>
            render.fakeSvg ?? actual.renderMermaidDiagramForExport(...args),
    }
})

import {
    buildExportSvg,
    copyPng,
    copySvg,
    diagramFileStem,
    exportBaseName,
    exportPng,
    exportSvg,
    fitPngScale,
    markdownDiagramPosition,
    type DiagramLook,
} from '@/lib/mermaid/export'
import { getDiagramColors } from '@/lib/theme/catalog'

const LIGHT: DiagramLook = { themeId: 'scrivon-light', transparent: false }

beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    render.fakeSvg = null
})

/** A stand-in canvas: records the size it was given and what was painted, and encodes anything. */
function stubCanvas() {
    const fills: string[] = []
    const canvas = {
        width: 0,
        height: 0,
        fills,
        getContext: () => {
            const ctx = {
                fillStyle: '',
                fillRect: () => fills.push(ctx.fillStyle),
                drawImage: () => {},
            }
            return ctx
        },
        toBlob: (done: (blob: Blob | null) => void) => done(new Blob(['png'], { type: 'image/png' })),
    }
    class LoadedImage {
        onload: (() => void) | null = null
        set src(_url: string) {
            queueMicrotask(() => this.onload?.())
        }
    }
    vi.stubGlobal('document', { createElement: () => canvas })
    vi.stubGlobal('Image', LoadedImage)
    return canvas
}

describe('exportBaseName', () => {
    it.each([
        ['flow.mmd', 'flow'],
        ['flow.mermaid', 'flow'],
        ['notes.md', 'notes'],
        ['v1.2 plan.mmd', 'v1.2 plan'],
        ['CI/CD Pipeline.mmd', 'CI-CD Pipeline'],
        ['Inheritance (<|--).mmd', 'Inheritance (-)'],
        ['Composition (\\*--).mmd', 'Composition (-)'],
        ['linkStyle: Color-Coded Edges.mmd', 'linkStyle- Color-Coded Edges'],
        ['::: Class Shorthand.mmd', 'Class Shorthand'],
        ['Ends with a dot..mmd', 'Ends with a dot'],
        ['CON.mmd', 'CON_'],
        ['lpt1.mmd', 'lpt1_'],
        ['.mmd', 'diagram'],
        ['', 'diagram'],
    ])('%s -> %s', (tabName, expected) => {
        expect(exportBaseName(tabName)).toBe(expected)
    })

    it('falls back to "diagram" when there is no tab', () => {
        expect(exportBaseName(undefined)).toBe('diagram')
    })
})

const NOTES = ['# Notes', '', '```mermaid', 'graph TD', '  A --> B', '```', '', 'Text', '', '~~~~mermaid', 'graph LR', '  C --> D', '~~~~', ''].join(
    '\n'
)

describe('diagram file names', () => {
    it('finds which mermaid block a diagram is', () => {
        expect(markdownDiagramPosition(NOTES, 'graph LR\n  C --> D')).toEqual({ index: 2, count: 2 })
        expect(markdownDiagramPosition(NOTES, 'graph TD\n  A --> B\n')).toEqual({ index: 1, count: 2 })
        expect(markdownDiagramPosition(NOTES, 'graph TD\n  X --> Y')).toEqual({ index: 0, count: 2 })
    })

    it('gives each diagram in a Markdown file its own name, without ".md"', () => {
        expect(diagramFileStem('graph LR\n  C --> D', { tabName: 'notes.md', markdown: NOTES })).toBe('notes-diagram-2')
        expect(diagramFileStem('graph TD\n  A --> B', { tabName: 'notes.md', markdown: NOTES })).toBe('notes-diagram-1')
        expect(diagramFileStem('graph TD', { tabName: 'notes.md', markdown: '```mermaid\ngraph TD\n```' })).toBe('notes-diagram')
        expect(diagramFileStem('edited since', { tabName: 'notes.md', markdown: NOTES })).toBe('notes-diagram')
    })

    it('uses the tab name for a Mermaid file', () => {
        expect(diagramFileStem('graph TD', { tabName: 'CI/CD Pipeline.mmd' })).toBe('CI-CD Pipeline')
    })
})

describe('exportSvg', () => {
    it('opens the save dialog next to the document with a clean name', async () => {
        await exportSvg('graph TD\n  A --> B', LIGHT, {
            tabName: 'notes.md',
            tabPath: 'D:\\docs\\notes.md',
            markdown: '```mermaid\ngraph TD\n  A --> B\n```',
        })

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(dialog.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'D:\\docs\\notes-diagram.svg' }))
    })

    it('suggests a bare, safe name for example tabs', async () => {
        await exportSvg('graph TD\n  A --> B', LIGHT, { tabName: 'CI/CD Pipeline.mmd', tabPath: 'example:ci-cd' })

        expect(dialog.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'CI-CD Pipeline.svg' }))
    })

    it('says where the file went, with a button that shows it in its folder', async () => {
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\flow.svg')

        await exportSvg('graph TD\n  A --> B', LIGHT, { tabName: 'flow.mmd' })

        expect(notify.notifySuccess).toHaveBeenCalledWith(
            'Saved flow.svg',
            expect.objectContaining({ description: 'D:\\out\\flow.svg', action: expect.objectContaining({ label: 'Show in folder' }) })
        )
        notify.notifySuccess.mock.calls[0]![1]!.action!.onClick()
        expect(opener.revealItemInDir).toHaveBeenCalledWith('D:\\out\\flow.svg')
    })

    it('says so when the folder cannot be shown', async () => {
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\flow.svg')
        const gone = new Error('The file is gone.')
        opener.revealItemInDir.mockRejectedValueOnce(gone)

        await exportSvg('graph TD\n  A --> B', LIGHT, { tabName: 'flow.mmd' })
        notify.notifySuccess.mock.calls[0]![1]!.action!.onClick()

        await vi.waitFor(() => expect(notify.notifyError).toHaveBeenCalledWith('Could not show the file', gone))
    })

    it('says nothing when the save dialog is cancelled', async () => {
        await exportSvg('graph TD\n  A --> B', LIGHT, { tabName: 'flow.mmd' })

        expect(notify.notifySuccess).not.toHaveBeenCalled()
        expect(notify.notifyError).not.toHaveBeenCalled()
    })

    it('says clearly why the file could not be saved', async () => {
        dialog.pickSavePath.mockResolvedValueOnce('D:\\locked\\flow.svg')
        dialog.writeTextFileAtPath.mockRejectedValueOnce(new Error('Access is denied.') as never)

        await exportSvg('graph TD\n  A --> B', LIGHT, { tabName: 'flow.mmd' })

        expect(notify.notifySuccess).not.toHaveBeenCalled()
        expect(notify.notifyError).toHaveBeenCalledWith('Export failed', new Error('Access is denied.'))
    })
})

describe('diagram look (F45)', () => {
    const FLOW = 'graph TD\n  A --> B'

    it('paints the theme background by default', () => {
        const svg = buildExportSvg(FLOW, 'scrivon-light')
        expect(svg).toMatch(/<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="#ffffff"\/>/)
        expect(svg).toContain('background:#ffffff')
    })

    it('leaves the background out when asked for a transparent one', () => {
        const svg = buildExportSvg(FLOW, 'scrivon-light', { transparent: true })
        expect(svg).not.toMatch(/<rect x="0" y="0" width="[\d.]+" height="[\d.]+" fill="#ffffff"\/>/)
        expect(svg).not.toContain('background:')
        // Still drawn in the theme's colours.
        expect(svg).toContain('A')
    })

    it('saves a PNG with no background painted under a transparent diagram', async () => {
        const canvas = stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\flow.png')

        await exportPng(FLOW, { themeId: 'scrivon-light', transparent: true }, { tabName: 'flow.mmd' }, 2)

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(canvas.fills).toEqual([])
        expect(dialog.writeBinaryFile).toHaveBeenCalled()
    })

    it('keeps the label halo on a transparent PNG, so lifelines still stop short of the labels', async () => {
        stubCanvas()
        const drawn = vi.spyOn(URL, 'createObjectURL')
        onTestFinished(() => drawn.mockRestore())
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\talk.png')

        await exportPng('sequenceDiagram\n  Alice->>Bob: Hello', { themeId: 'scrivon-dark', transparent: true }, { tabName: 'talk.mmd' }, 2)

        expect(notify.notifyError).not.toHaveBeenCalled()
        const svg = await (drawn.mock.calls[0]![0] as Blob).text()
        expect(svg).not.toContain('background:')
        expect(svg).toContain(`paint-order: stroke; stroke: ${getDiagramColors('scrivon-dark').bg}`)
    })

    it('paints the chosen theme behind a PNG otherwise', async () => {
        const canvas = stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\flow.png')

        await exportPng(FLOW, { themeId: 'scrivon-dark', transparent: false }, { tabName: 'flow.mmd' }, 2)

        expect(canvas.fills).toEqual([getDiagramColors('scrivon-dark').bg])
    })

    it('saves an SVG in the chosen theme, with no background when transparent', async () => {
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\clear.svg').mockResolvedValueOnce('D:\\out\\solid.svg')

        await exportSvg(FLOW, { themeId: 'scrivon-dark', transparent: true }, { tabName: 'flow.mmd' })
        await exportSvg(FLOW, { themeId: 'scrivon-dark', transparent: false }, { tabName: 'flow.mmd' })

        const [[, clear], [, solid]] = dialog.writeTextFileAtPath.mock.calls as unknown as [string, string][]
        expect(clear).not.toContain('background:')
        expect(solid).toContain(`background:${getDiagramColors('scrivon-dark').bg}`)
    })
})

describe('copy to the clipboard (F45)', () => {
    const FLOW = 'graph TD\n  A --> B'
    const SEQUENCE = 'sequenceDiagram\n  Alice->>Bob: Hello'

    /** What the app put on the clipboard: one entry per format. */
    type Copied = Record<string, Blob>

    /** A clipboard that keeps what it's given. `svg` says whether it takes the SVG picture format. */
    function stubClipboard({ svg = true } = {}) {
        const copied: Copied[] = []
        class FakeClipboardItem {
            constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
            static supports(type: string) {
                return type === 'image/png' || type === 'text/plain' || (svg && type === 'image/svg+xml')
            }
        }
        const write = vi.fn(async (items: FakeClipboardItem[]) => {
            for (const item of items) {
                const entry: Copied = {}
                for (const [type, blob] of Object.entries(item.items)) entry[type] = await blob
                copied.push(entry)
            }
        })
        vi.stubGlobal('ClipboardItem', FakeClipboardItem)
        vi.stubGlobal('navigator', { clipboard: { write } })
        return copied
    }

    it('copies a PNG of the diagram and says so', async () => {
        const canvas = stubCanvas()
        const copied = stubClipboard()

        await copyPng(FLOW, LIGHT)

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(Object.keys(copied[0]!)).toEqual(['image/png'])
        expect(copied[0]!['image/png']!.type).toBe('image/png')
        expect(canvas.fills).toEqual(['#ffffff'])
        expect(notify.notifySuccess).toHaveBeenCalledWith('Diagram copied as PNG')
        // Nothing is saved to disk.
        expect(dialog.pickSavePath).not.toHaveBeenCalled()
    })

    it('copies a transparent PNG with no background painted', async () => {
        const canvas = stubCanvas()
        stubClipboard()

        await copyPng(FLOW, { themeId: 'scrivon-light', transparent: true })

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(canvas.fills).toEqual([])
    })

    it('copies a big diagram smaller, and says so', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30000 400" width="30000" height="400"></svg>'
        const canvas = stubCanvas()
        stubClipboard()

        await copyPng(FLOW, LIGHT)

        expect(canvas.width).toBe(32_767)
        expect(notify.notifySuccess).not.toHaveBeenCalled()
        expect(notify.notifyWarning).toHaveBeenCalledWith('Copied a smaller PNG', {
            description: 'This diagram is too big for 2×, so it was copied at 32767 × 437 px.',
        })
    })

    it('says to copy as SVG when the diagram is too big for any PNG', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70000 300" width="70000" height="300"></svg>'
        stubCanvas()
        const copied = stubClipboard()

        await copyPng(FLOW, LIGHT)

        expect(copied).toEqual([])
        expect(notify.notifyError).toHaveBeenCalledWith(
            "Couldn't copy the diagram",
            new Error('This diagram is too big to copy as a PNG. Copy it as SVG instead.')
        )
    })

    it('copies the SVG as a picture and as text, without the label halo, and says so', async () => {
        const copied = stubClipboard()

        await copySvg(SEQUENCE, { themeId: 'scrivon-dark', transparent: true })

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(Object.keys(copied[0]!).sort()).toEqual(['image/svg+xml', 'text/plain'])
        const text = await copied[0]!['text/plain']!.text()
        expect(text).toMatch(/^<svg /)
        expect(text).toContain('Hello')
        expect(text).not.toContain('paint-order')
        expect(text).not.toContain('background:')
        expect(await copied[0]!['image/svg+xml']!.text()).toBe(text)
        expect(notify.notifySuccess).toHaveBeenCalledWith('Diagram copied as SVG')
    })

    it('copies the SVG as text alone where the clipboard does not take SVG pictures', async () => {
        const copied = stubClipboard({ svg: false })

        await copySvg(FLOW, LIGHT)

        expect(Object.keys(copied[0]!)).toEqual(['text/plain'])
        expect(notify.notifySuccess).toHaveBeenCalledWith('Diagram copied as SVG')
    })

    it('says so when there is no clipboard to write to', async () => {
        stubCanvas()
        vi.stubGlobal('navigator', {})

        await copyPng(FLOW, LIGHT)
        await copySvg(FLOW, LIGHT)

        expect(notify.notifySuccess).not.toHaveBeenCalled()
        expect(notify.notifyError).toHaveBeenCalledTimes(2)
        expect(notify.notifyError).toHaveBeenCalledWith("Couldn't copy the diagram", new Error('The clipboard is not available.'))
    })

    it('says why when the clipboard refuses', async () => {
        stubClipboard()
        const denied = new Error('Write permission denied.')
        vi.stubGlobal('navigator', { clipboard: { write: vi.fn(async () => Promise.reject(denied)) } })

        await copySvg(FLOW, LIGHT)

        expect(notify.notifyError).toHaveBeenCalledWith("Couldn't copy the diagram", denied)
    })

    it('says so instead of copying an empty diagram', async () => {
        const copied = stubClipboard()

        await copySvg('graph TD', LIGHT)

        expect(copied).toEqual([])
        expect(notify.notifyError).toHaveBeenCalledWith(
            "Couldn't copy the diagram",
            new Error('The diagram is empty, so there is nothing to export.')
        )
    })
})

describe('empty diagrams (U39)', () => {
    it('refuses to build an SVG for a diagram with nothing to draw', () => {
        expect(() => buildExportSvg('graph TD', 'scrivon-light')).toThrow('The diagram is empty, so there is nothing to export.')
    })

    it('says so instead of saving an empty file', async () => {
        await exportSvg('sequenceDiagram\n  Alice', LIGHT, { tabName: 'flow.mmd' })

        expect(dialog.pickSavePath).not.toHaveBeenCalled()
        expect(notify.notifyError).toHaveBeenCalledWith('Export failed', new Error('The diagram is empty, so there is nothing to export.'))
    })
})

describe('sequence label halo (U82)', () => {
    const SEQUENCE = 'sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Reply'

    it('keeps the halo for PNG, baked to the background colour', () => {
        expect(buildExportSvg(SEQUENCE, 'scrivon-light')).toMatch(/\.message text \{ paint-order: stroke; stroke: #ffffff;/)
    })

    it('leaves it out of saved .svg files, since some apps would draw it over the letters', async () => {
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\seq.svg')

        await exportSvg(SEQUENCE, LIGHT, { tabName: 'seq.mmd' })

        expect(notify.notifyError).not.toHaveBeenCalled()
        const [, content] = dialog.writeTextFileAtPath.mock.calls[0] as unknown as [string, string]
        expect(content).toContain('Hello')
        expect(content).not.toContain('paint-order')
    })
})

describe('PNG size limits (B106)', () => {
    const DIAGRAM = 'graph LR\n  A --> B'

    it('keeps the requested scale when it fits', () => {
        expect(fitPngScale({ width: 800, height: 600 }, 4)).toBe(4)
    })

    it('shrinks the scale so neither side passes 32,767 px', () => {
        const scale = fitPngScale({ width: 10_000, height: 200 }, 4)
        expect(10_000 * scale).toBeCloseTo(32_767, 6)
    })

    it('shrinks the scale so the image stays under 100 million pixels', () => {
        const scale = fitPngScale({ width: 6000, height: 6000 }, 4)
        expect(6000 * scale * 6000 * scale).toBeCloseTo(100_000_000, 0)
    })

    it('saves a smaller PNG and says so when 4x is too big', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 400" width="10000" height="400"></svg>'
        const canvas = stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\wide.png')

        await exportPng(DIAGRAM, LIGHT, { tabName: 'wide.mmd' }, 4)

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(canvas.width).toBe(32_767)
        expect(canvas.height).toBe(1311)
        expect(dialog.writeBinaryFile).toHaveBeenCalled()
        // Still says where it went.
        expect(notify.notifyWarning).toHaveBeenCalledWith('Saved a smaller PNG', {
            description: 'This diagram is too big for 4×, so it was saved at 32767 × 1311 px.',
            action: expect.objectContaining({ label: 'Show in folder' }),
        })
        expect(notify.notifySuccess).not.toHaveBeenCalled()
    })

    it('says where a PNG at full size went', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" width="800" height="400"></svg>'
        stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\flow.png')

        await exportPng(DIAGRAM, LIGHT, { tabName: 'flow.mmd' }, 2)

        expect(notify.notifySuccess).toHaveBeenCalledWith(
            'Saved flow.png',
            expect.objectContaining({ description: 'D:\\out\\flow.png', action: expect.objectContaining({ label: 'Show in folder' }) })
        )
        expect(notify.notifyWarning).not.toHaveBeenCalled()
    })

    it('still saves a long thin diagram at 1x, as it could before the size limits (B106 review)', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 400" width="20000" height="400"></svg>'
        const canvas = stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\chain.png')

        await exportPng(DIAGRAM, LIGHT, { tabName: 'chain.mmd' }, 1)

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(canvas.width).toBe(20_000)
        expect(canvas.height).toBe(400)
        expect(dialog.writeBinaryFile).toHaveBeenCalled()
        expect(notify.notifyWarning).not.toHaveBeenCalled()
    })

    it('saves below 1x, and says so, when even 1x is too big (B106 review)', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40000 300" width="40000" height="300"></svg>'
        const canvas = stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\chain.png')

        await exportPng(DIAGRAM, LIGHT, { tabName: 'chain.mmd' }, 1)

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(canvas.width).toBe(32_767)
        expect(canvas.height).toBe(246)
        expect(notify.notifyWarning).toHaveBeenCalledWith('Saved a smaller PNG', {
            description: 'This diagram is too big for 1×, so it was saved at 32767 × 246 px.',
            action: expect.objectContaining({ label: 'Show in folder' }),
        })
    })

    it('says to use SVG when even half size is too big, instead of a vague canvas error', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 70000 300" width="70000" height="300"></svg>'
        stubCanvas()

        await exportPng(DIAGRAM, LIGHT, { tabName: 'huge.mmd' }, 1)

        expect(dialog.pickSavePath).not.toHaveBeenCalled()
        expect(notify.notifyError).toHaveBeenCalledWith(
            'Export failed',
            new Error('This diagram is too big to save as a PNG. Save it as SVG instead.')
        )
    })

    it('does not warn when the user cancels the save dialog', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10000 400" width="10000" height="400"></svg>'
        stubCanvas()

        await exportPng(DIAGRAM, LIGHT, { tabName: 'wide.mmd' }, 4)

        expect(notify.notifyWarning).not.toHaveBeenCalled()
        expect(notify.notifyError).not.toHaveBeenCalled()
    })
})
