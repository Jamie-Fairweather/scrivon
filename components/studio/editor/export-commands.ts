import type { AppCommand } from '@/components/studio/commands/app-command'
import type { Availability, ExportAvailability } from '@/components/studio/editor/export-availability'
import type { ExportFormat } from '@/lib/markdown/export-document'
import type { PngExportScale } from '@/lib/mermaid/export'
import type { DiagramExportSettings, DiagramExportTheme } from '@/lib/settings/types'

/** A diagram saved as SVG, or as PNG at this scale, or copied to the clipboard. */
export type DiagramExportKind = 'svg' | PngExportScale | 'copy-svg' | 'copy-png'

export type ExportCommandsContext = {
    availability: ExportAvailability
    /** The format Export… opens the dialog at: the one last picked. */
    lastFormat: ExportFormat
    openDialog: (format: ExportFormat) => void
    /** Opens the tab bar's export menu, for a tab that has only a diagram to export. */
    openMenu: () => void
    exportDiagram: (kind: DiagramExportKind) => void
    /** How saved and copied diagrams look. */
    diagramOptions: DiagramExportSettings
    setDiagramOptions: (change: Partial<DiagramExportSettings>) => void
}

const DOCUMENT_FORMATS: { format: ExportFormat; id: string; name: string; keywords: string }[] = [
    { format: 'pdf', id: 'export-pdf', name: 'PDF', keywords: 'pdf print' },
    { format: 'docx', id: 'export-docx', name: 'Word', keywords: 'word docx' },
    { format: 'html', id: 'export-html', name: 'HTML', keywords: 'html web page' },
]

export const PNG_SCALES: PngExportScale[] = [1, 2, 4]

/** The diagram theme choices, as the export menu lists them. */
export const DIAGRAM_THEMES: { theme: DiagramExportTheme; name: string }[] = [
    { theme: 'app', name: 'Same as App' },
    { theme: 'light', name: 'Light' },
    { theme: 'dark', name: 'Dark' },
]

function state({ disabled, reason }: Availability): Pick<AppCommand, 'disabled' | 'disabledReason'> {
    return { disabled, disabledReason: reason || undefined }
}

/**
 * Export from the palette, the File menu and the shortcut: one command per kind of export,
 * each greyed out (with the reason) when the active tab can't do it.
 */
export function buildExportCommands(ctx: ExportCommandsContext): AppCommand[] {
    const { availability } = ctx
    return [
        {
            id: 'export',
            label: 'Export…',
            keywords: 'export save download pdf word html svg png',
            keybind: 'document.export',
            ...state(availability.trigger),
            // A Mermaid file has no dialog: its menu offers SVG and PNG.
            run: () => (availability.document.disabled ? ctx.openMenu() : ctx.openDialog(ctx.lastFormat)),
        },
        ...DOCUMENT_FORMATS.map(({ format, id, name, keywords }) => ({
            id,
            label: `Export as ${name}…`,
            keywords: `export save ${keywords}`,
            ...state(availability.document),
            run: () => ctx.openDialog(format),
        })),
        {
            id: 'export-svg',
            label: 'Export Diagram as SVG…',
            keywords: 'export save diagram image svg',
            ...state(availability.diagram),
            run: () => ctx.exportDiagram('svg'),
        },
        ...PNG_SCALES.map((scale) => ({
            id: `export-png-${scale}`,
            label: `Export Diagram as PNG (${scale}×)…`,
            keywords: 'export save diagram image png picture',
            ...state(availability.diagram),
            run: () => ctx.exportDiagram(scale),
        })),
        {
            id: 'copy-diagram-svg',
            label: 'Copy Diagram as SVG',
            keywords: 'copy clipboard diagram image svg',
            ...state(availability.diagram),
            run: () => ctx.exportDiagram('copy-svg'),
        },
        {
            id: 'copy-diagram-png',
            label: 'Copy Diagram as PNG',
            keywords: 'copy clipboard diagram image png picture',
            ...state(availability.diagram),
            run: () => ctx.exportDiagram('copy-png'),
        },
        // The options can be set at any time, with or without a diagram open.
        {
            id: 'diagram-export-transparent',
            label: 'Diagram Export: Transparent Background',
            keywords: 'export copy diagram image png svg transparent background clear',
            checked: ctx.diagramOptions.transparent,
            run: () => ctx.setDiagramOptions({ transparent: !ctx.diagramOptions.transparent }),
        },
        ...DIAGRAM_THEMES.map(({ theme, name }) => ({
            id: `diagram-export-theme-${theme}`,
            label: `Diagram Export Theme: ${name}`,
            keywords: 'export copy diagram image png svg theme colour color light dark',
            disabled: ctx.diagramOptions.theme === theme,
            disabledReason: 'In use',
            run: () => ctx.setDiagramOptions({ theme }),
        })),
    ]
}
