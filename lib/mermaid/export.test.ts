import { beforeEach, describe, expect, it, vi } from 'vitest'

const dialog = vi.hoisted(() => ({
    pickSavePath: vi.fn<(options: { defaultPath?: string }) => Promise<string | null>>(async () => null),
    showError: vi.fn(async () => undefined),
    writeBinaryFile: vi.fn(async () => undefined),
    writeTextFileAtPath: vi.fn(async () => undefined),
}))

vi.mock('@/lib/tauri/dialog', () => dialog)
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))

import { diagramFileStem, exportBaseName, exportSvg, markdownDiagramPosition, savePathBesideDocument } from '@/lib/mermaid/export'

beforeEach(() => {
    vi.clearAllMocks()
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

        expect(dialog.showError).not.toHaveBeenCalled()
        expect(dialog.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'D:\\docs\\notes-diagram.svg' }))
    })

    it('suggests a bare, safe name for example tabs', async () => {
        await exportSvg('graph TD\n  A --> B', 'scrivon-light', { tabName: 'CI/CD Pipeline.mmd', tabPath: 'example:ci-cd' })

        expect(dialog.pickSavePath).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'CI-CD Pipeline.svg' }))
    })
})
