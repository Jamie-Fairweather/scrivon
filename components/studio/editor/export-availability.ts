import type { DocumentKind } from '@/lib/workspace/file-types'

/** What the active tab holds, as far as exporting it goes. */
export type ExportState = {
    tabKind: DocumentKind | null
    /** An export is running; only one runs at a time. */
    exporting: boolean
    /** The Markdown file has text (always false for a Mermaid file). */
    hasMarkdown: boolean
    /** There is a diagram to export: a Mermaid file, or a diagram expanded from a Markdown file. */
    hasDiagram: boolean
    hasDiagramSource: boolean
    diagramError: boolean
    /** The diagram is being drawn for the first time. */
    isPending: boolean
    /** The diagram's text draws nothing yet (just `graph TD`, say). */
    isEmpty: boolean
    /** The text on screen is newer than the drawn picture, and may turn out broken or empty. */
    isStale: boolean
}

/** Whether something can run now, and why not when it can't. */
export type Availability = { disabled: boolean; reason: string }

export type ExportAvailability = {
    /** The tab bar's Export button, and the Export… command. On when either kind of export can run. */
    trigger: Availability
    /** PDF, Word and HTML. `shown` for a Markdown file, the only kind they work for. */
    document: Availability & { shown: boolean }
    /** SVG and PNG. `shown` when the tab has a diagram to export; `drawing` while its picture catches up with the text. */
    diagram: Availability & { shown: boolean; drawing: boolean }
}

const ON: Availability = { disabled: false, reason: '' }
const off = (reason: string): Availability => ({ disabled: true, reason })

/** Why the diagram can't be exported, or '' when it can. */
function diagramOffReason(state: ExportState): string {
    if (!state.hasDiagram) return 'Expand a diagram in the preview to export it'
    if (!state.hasDiagramSource) return 'Nothing to export: the diagram is empty'
    if (state.diagramError) return 'Fix the diagram error to export'
    if (state.isPending) return 'Drawing the diagram…'
    if (state.isEmpty) return 'No diagram to export'
    return ''
}

/** What can be exported from the active tab right now, and why not when something can't. */
export function exportAvailability(state: ExportState): ExportAvailability {
    const { tabKind, exporting } = state
    const isMarkdown = tabKind === 'markdown'
    if (!tabKind || exporting) {
        const reason = tabKind ? 'Exporting…' : 'Open a document to export'
        return {
            trigger: off(reason),
            document: { ...off(reason), shown: isMarkdown },
            diagram: { ...off(reason), shown: state.hasDiagram, drawing: false },
        }
    }

    const documentState = !isMarkdown
        ? off('Only Markdown files export as PDF, Word or HTML')
        : state.hasMarkdown
          ? ON
          : off('Nothing to export: the document is empty')
    const document = { ...documentState, shown: isMarkdown }
    const diagramReason = diagramOffReason(state)
    // Only the items wait for a redraw: turning the whole Export button off too would make it flicker on every keystroke.
    const drawing = !diagramReason && state.isStale
    const diagram = { ...(diagramReason ? off(diagramReason) : drawing ? off('Drawing the diagram…') : ON), shown: state.hasDiagram, drawing }

    if (!document.disabled || !diagramReason) return { trigger: ON, document, diagram }
    // A Markdown file says why its text can't go; otherwise say what's wrong with the diagram.
    const trigger = isMarkdown ? documentState : off(diagramReason)
    return { trigger, document, diagram }
}
