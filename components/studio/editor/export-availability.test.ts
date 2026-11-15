import { describe, expect, it } from 'vitest'
import { exportAvailability, type ExportState } from './export-availability'

/** A Markdown file with text, nothing expanded, nothing running. */
const markdown: ExportState = {
    tabKind: 'markdown',
    exporting: false,
    hasMarkdown: true,
    hasDiagram: false,
    hasDiagramSource: false,
    diagramError: false,
    isPending: false,
    isEmpty: false,
    isStale: false,
}

/** A Mermaid file whose diagram is drawn. */
const mermaid: ExportState = { ...markdown, tabKind: 'mermaid', hasMarkdown: false, hasDiagram: true, hasDiagramSource: true }

const on = { disabled: false, reason: '' }
const off = (reason: string) => ({ disabled: true, reason })

describe('exportAvailability', () => {
    it('turns everything off when no document is open', () => {
        const none = exportAvailability({ ...markdown, tabKind: null, hasMarkdown: false })
        expect(none.trigger).toEqual(off('Open a document to export'))
        expect(none.document).toMatchObject(off('Open a document to export'))
        expect(none.diagram).toMatchObject(off('Open a document to export'))
    })

    it('lets a Markdown file export as a document, and its diagram only once one is expanded', () => {
        const result = exportAvailability(markdown)
        expect(result.trigger).toEqual(on)
        expect(result.document).toEqual({ ...on, shown: true })
        expect(result.diagram).toMatchObject({ ...off('Expand a diagram in the preview to export it'), shown: false })

        const expanded = exportAvailability({ ...markdown, hasDiagram: true, hasDiagramSource: true })
        expect(expanded.diagram).toMatchObject({ ...on, shown: true })
    })

    it('lets a Mermaid file export only its diagram', () => {
        const result = exportAvailability(mermaid)
        expect(result.trigger).toEqual(on)
        expect(result.document).toEqual({ ...off('Only Markdown files export as PDF, Word or HTML'), shown: false })
        expect(result.diagram).toMatchObject({ ...on, shown: true, drawing: false })
    })

    it.each([
        { case: 'an empty Markdown file', state: { ...markdown, hasMarkdown: false }, reason: 'Nothing to export: the document is empty' },
        { case: 'an empty diagram', state: { ...mermaid, hasDiagramSource: false }, reason: 'Nothing to export: the diagram is empty' },
        { case: 'a diagram with an error', state: { ...mermaid, diagramError: true }, reason: 'Fix the diagram error to export' },
        { case: 'a diagram still drawing', state: { ...mermaid, isPending: true }, reason: 'Drawing the diagram…' },
        { case: 'a diagram with nothing to draw', state: { ...mermaid, isEmpty: true }, reason: 'No diagram to export' },
        { case: 'an export already running', state: { ...markdown, exporting: true }, reason: 'Exporting…' },
    ])('turns export off for $case and says why', ({ state, reason }) => {
        expect(exportAvailability(state).trigger).toEqual(off(reason))
    })

    it('keeps the export button on while an edited diagram redraws, but holds back its items', () => {
        const result = exportAvailability({ ...mermaid, isStale: true })
        // The button doesn't flicker while typing.
        expect(result.trigger).toEqual(on)
        expect(result.diagram).toMatchObject({ ...off('Drawing the diagram…'), drawing: true })
    })

    it('keeps the export button on for an empty Markdown file with an expanded diagram', () => {
        const result = exportAvailability({ ...markdown, hasMarkdown: false, hasDiagram: true, hasDiagramSource: true })
        expect(result.trigger).toEqual(on)
        expect(result.document).toEqual({ ...off('Nothing to export: the document is empty'), shown: true })
        expect(result.diagram).toMatchObject(on)
    })
})
