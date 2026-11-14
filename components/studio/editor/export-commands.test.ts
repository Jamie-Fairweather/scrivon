import { describe, expect, it, vi } from 'vitest'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { exportAvailability, type ExportState } from './export-availability'
import { buildExportCommands, type ExportCommandsContext } from './export-commands'

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
const mermaid: ExportState = { ...markdown, tabKind: 'mermaid', hasMarkdown: false, hasDiagram: true, hasDiagramSource: true }

function context(state: ExportState, lastFormat: ExportCommandsContext['lastFormat'] = 'pdf') {
    return {
        availability: exportAvailability(state),
        lastFormat,
        openDialog: vi.fn(),
        openMenu: vi.fn(),
        exportDiagram: vi.fn(),
    } satisfies ExportCommandsContext
}

function find(commands: AppCommand[], id: string): AppCommand {
    const command = commands.find((candidate) => candidate.id === id)
    if (!command) throw new Error(`No command ${id}`)
    return command
}

const DOCUMENT_IDS = ['export-pdf', 'export-docx', 'export-html']
const DIAGRAM_IDS = ['export-svg', 'export-png-1', 'export-png-2', 'export-png-4']

describe('buildExportCommands', () => {
    it('has a command for every kind of export, and Export… on its shortcut', () => {
        const commands = buildExportCommands(context(markdown))
        expect(commands.map((command) => [command.id, command.label])).toEqual([
            ['export', 'Export…'],
            ['export-pdf', 'Export as PDF…'],
            ['export-docx', 'Export as Word…'],
            ['export-html', 'Export as HTML…'],
            ['export-svg', 'Export Diagram as SVG…'],
            ['export-png-1', 'Export Diagram as PNG (1×)…'],
            ['export-png-2', 'Export Diagram as PNG (2×)…'],
            ['export-png-4', 'Export Diagram as PNG (4×)…'],
        ])
        expect(find(commands, 'export').keybind).toBe('document.export')
    })

    it('opens the export dialog at the chosen format for a Markdown file', () => {
        const ctx = context(markdown)
        const commands = buildExportCommands(ctx)
        for (const id of DOCUMENT_IDS) expect(find(commands, id).disabled).toBe(false)

        void find(commands, 'export-docx').run()
        expect(ctx.openDialog).toHaveBeenLastCalledWith('docx')
        void find(commands, 'export-html').run()
        expect(ctx.openDialog).toHaveBeenLastCalledWith('html')
        void find(commands, 'export-pdf').run()
        expect(ctx.openDialog).toHaveBeenLastCalledWith('pdf')
    })

    it('greys out the diagram exports in a Markdown file until a diagram is expanded', () => {
        const commands = buildExportCommands(context(markdown))
        for (const id of DIAGRAM_IDS) {
            expect(find(commands, id)).toMatchObject({ disabled: true, disabledReason: 'Expand a diagram in the preview to export it' })
        }
    })

    it('saves a Mermaid file as SVG or PNG straight away, and greys out the document formats', () => {
        const ctx = context(mermaid)
        const commands = buildExportCommands(ctx)
        for (const id of DOCUMENT_IDS) {
            expect(find(commands, id)).toMatchObject({ disabled: true, disabledReason: 'Only Markdown files export as PDF, Word or HTML' })
        }

        void find(commands, 'export-svg').run()
        expect(ctx.exportDiagram).toHaveBeenLastCalledWith('svg')
        void find(commands, 'export-png-4').run()
        expect(ctx.exportDiagram).toHaveBeenLastCalledWith(4)
        void find(commands, 'export-png-1').run()
        expect(ctx.exportDiagram).toHaveBeenLastCalledWith(1)
        expect(ctx.openDialog).not.toHaveBeenCalled()
    })

    it('opens the dialog at the last format with Export…, or the export menu when only the diagram can go', () => {
        const forMarkdown = context(markdown, 'html')
        void find(buildExportCommands(forMarkdown), 'export').run()
        expect(forMarkdown.openDialog).toHaveBeenCalledWith('html')
        expect(forMarkdown.openMenu).not.toHaveBeenCalled()

        const forMermaid = context(mermaid)
        void find(buildExportCommands(forMermaid), 'export').run()
        expect(forMermaid.openMenu).toHaveBeenCalled()
        expect(forMermaid.openDialog).not.toHaveBeenCalled()
    })

    it('greys out everything, and says why, with no document open', () => {
        const commands = buildExportCommands(context({ ...markdown, tabKind: null, hasMarkdown: false }))
        for (const command of commands) expect(command).toMatchObject({ disabled: true, disabledReason: 'Open a document to export' })
    })
})
