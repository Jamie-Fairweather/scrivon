import { beforeEach, describe, expect, it, vi } from 'vitest'

const dialog = vi.hoisted(() => ({
    pickSavePath: vi.fn<(options: { defaultPath?: string }) => Promise<string | null>>(async () => null),
    writeBinaryFile: vi.fn(async () => undefined),
    writeTextFileAtPath: vi.fn(async () => undefined),
}))

const notify = vi.hoisted(() => ({
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
}))

const render = vi.hoisted(() => ({ fakeSvg: null as string | null }))

vi.mock('@/lib/tauri/dialog', () => dialog)
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
    diagramFileStem,
    exportBaseName,
    exportPng,
    exportSvg,
    fitPngScale,
    markdownDiagramPosition,
    savePathBesideDocument,
} from '@/lib/mermaid/export'

beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    render.fakeSvg = null
})

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

describe('savePathBesideDocument', () => {
    it.each([
        ['D:\\Projects\\spec\\flow.mmd', 'D:\\Projects\\spec\\flow.svg'],
        ['C:\\flow.mmd', 'C:\\flow.svg'],
        ['\\\\server\\share\\flow.mmd', '\\\\server\\share\\flow.svg'],
        ['/home/me/flow.mmd', '/home/me/flow.svg'],
        ['example:ci-cd', 'flow.svg'],
        [undefined, 'flow.svg'],
    ])('%s -> %s', (documentPath, expected) => {
        expect(savePathBesideDocument('flow.svg', documentPath)).toBe(expected)
    })
})

describe('exportSvg', () => {
    it('opens the save dialog next to the document with a clean name', async () => {
        await exportSvg('graph TD\n  A --> B', 'scrivon-light', {
            tabName: 'notes.md',
            tabPath: 'D:\\docs\\notes.md',
            markdown: '```mermaid\ngraph TD\n  A --> B\n```',
        })

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(dialog.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'D:\\docs\\notes-diagram.svg' }))
    })

    it('suggests a bare, safe name for example tabs', async () => {
        await exportSvg('graph TD\n  A --> B', 'scrivon-light', { tabName: 'CI/CD Pipeline.mmd', tabPath: 'example:ci-cd' })

        expect(dialog.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'CI-CD Pipeline.svg' }))
    })
})

describe('empty diagrams (U39)', () => {
    it('refuses to build an SVG for a diagram with nothing to draw', () => {
        expect(() => buildExportSvg('graph TD', 'scrivon-light')).toThrow('The diagram is empty, so there is nothing to export.')
    })

    it('says so instead of saving an empty file', async () => {
        await exportSvg('sequenceDiagram\n  Alice', 'scrivon-light', { tabName: 'flow.mmd' })

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

        await exportSvg(SEQUENCE, 'scrivon-light', { tabName: 'seq.mmd' })

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

    it('shrinks the scale so neither side passes 16,384 px', () => {
        const scale = fitPngScale({ width: 8312, height: 200 }, 4)
        expect(8312 * scale).toBeCloseTo(16_384, 6)
    })

    it('shrinks the scale so the image stays under 100 million pixels', () => {
        const scale = fitPngScale({ width: 6000, height: 6000 }, 4)
        expect(6000 * scale * 6000 * scale).toBeCloseTo(100_000_000, 0)
    })

    /** A stand-in canvas: records the size it was given and encodes anything. */
    function stubCanvas() {
        const canvas = {
            width: 0,
            height: 0,
            getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
            toBlob: (done: (blob: Blob | null) => void) => done(new Blob(['png'])),
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

    it('saves a smaller PNG and says so when 4x is too big', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8000 400" width="8000" height="400"></svg>'
        const canvas = stubCanvas()
        dialog.pickSavePath.mockResolvedValueOnce('D:\\out\\wide.png')

        await exportPng(DIAGRAM, 'scrivon-light', { tabName: 'wide.mmd' }, 4)

        expect(notify.notifyError).not.toHaveBeenCalled()
        expect(canvas.width).toBe(16_384)
        expect(canvas.height).toBe(819)
        expect(dialog.writeBinaryFile).toHaveBeenCalled()
        expect(notify.notifyWarning).toHaveBeenCalledWith('Saved a smaller PNG', {
            description: 'This diagram is too big for 4×, so it was saved at 16384 × 819 px.',
        })
    })

    it('says to use SVG when even 1x is too big, instead of a vague canvas error', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42000 300" width="42000" height="300"></svg>'
        stubCanvas()

        await exportPng(DIAGRAM, 'scrivon-light', { tabName: 'huge.mmd' }, 1)

        expect(dialog.pickSavePath).not.toHaveBeenCalled()
        expect(notify.notifyError).toHaveBeenCalledWith(
            'Export failed',
            new Error('This diagram is too big to save as a PNG. Save it as SVG instead.')
        )
    })

    it('does not warn when the user cancels the save dialog', async () => {
        render.fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8000 400" width="8000" height="400"></svg>'
        stubCanvas()

        await exportPng(DIAGRAM, 'scrivon-light', { tabName: 'wide.mmd' }, 4)

        expect(notify.notifyWarning).not.toHaveBeenCalled()
        expect(notify.notifyError).not.toHaveBeenCalled()
    })
})
