'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { diagramExportThemeId } from '@/components/studio/editor/diagram-export-theme'
import { exportAvailability, type ExportAvailability } from '@/components/studio/editor/export-availability'
import { buildExportCommands, type DiagramExportKind } from '@/components/studio/editor/export-commands'
import { PdfExportDialog } from '@/components/studio/editor/pdf-export-dialog'
import { useMarkdownExpand, useMarkdownPreviewMemory } from '@/components/studio/markdown/markdown-expand-context'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import type { ExportFormat } from '@/lib/markdown/export-document'
import type { DiagramExportTarget, DiagramLook } from '@/lib/mermaid/export'
import { notifyError } from '@/lib/notify'
import type { DiagramExportSettings } from '@/lib/settings/types'
import { documentKind } from '@/lib/workspace/file-types'

/** Loaded when the user exports, so the export code and the diagram renderer it needs aren't part of every launch. */
const loadDiagramExport = () => import('@/lib/mermaid/export')

export type DocumentExport = {
    availability: ExportAvailability
    exporting: boolean
    /** The tab bar's export menu, which Export… opens for a tab that only has a diagram. */
    menuOpen: boolean
    setMenuOpen: (open: boolean) => void
    /** Opens the export dialog (Markdown files only) at this format. */
    openDialog: (format: ExportFormat) => void
    exportDiagram: (kind: DiagramExportKind) => void
    /** How saved and copied diagrams look. Kept in the settings. */
    diagramOptions: DiagramExportSettings
    setDiagramOptions: (change: Partial<DiagramExportSettings>) => void
}

const DocumentExportContext = createContext<DocumentExport | null>(null)

/** What a diagram export needs. */
type DiagramJob = { source: string; look: DiagramLook; target: DiagramExportTarget }

/** Runs one kind of diagram export from the export code. */
function runDiagramExport(code: Awaited<ReturnType<typeof loadDiagramExport>>, kind: DiagramExportKind, { source, look, target }: DiagramJob) {
    if (kind === 'svg') return code.exportSvg(source, look, target)
    if (kind === 'copy-svg') return code.copySvg(source, look)
    if (kind === 'copy-png') return code.copyPng(source, look)
    return code.exportPng(source, look, target, kind)
}

/**
 * Saves or copies the diagram as SVG or PNG. The function stays the same as the text changes, since
 * it reads the diagram only when it runs, so typing doesn't rebuild the export commands.
 */
function useDiagramExport(job: DiagramJob, setExporting: (exporting: boolean) => void): (kind: DiagramExportKind) => void {
    const jobRef = useRef(job)
    useEffect(() => {
        jobRef.current = job
    })
    return useCallback(
        (kind: DiagramExportKind) => {
            const current = jobRef.current
            setExporting(true)
            loadDiagramExport()
                .then((code) => runDiagramExport(code, kind, current))
                // The exports report their own failures, so this is the export code failing to load.
                .catch((err: unknown) => notifyError('Export failed', err))
                .finally(() => setExporting(false))
        },
        [setExporting]
    )
}

/**
 * Export for the active tab, from anywhere: the tab bar's menu, the File menu, the palette and the
 * shortcut. Holds whether an export is running (only one runs at a time) and the export dialog.
 */
export function DocumentExportProvider({ children }: { children: ReactNode }) {
    const { activeTab, activeTabId } = useDocumentTabs()
    // The export embeds images inside the open folder, as the preview shows them.
    const { workspaceRoot } = useWorkspaceSession()
    const { expanded } = useMarkdownExpand()
    // Web images the user chose to load in this tab's preview go in its export too.
    const { remoteImageTabs } = useMarkdownPreviewMemory()
    const { themeId } = useAppTheme()
    const { settings, updateSettings } = useAppSettings()
    const diagramOptions = settings.diagramExport

    const tabKind = activeTab ? documentKind(activeTab.name) : null
    const isMarkdownTab = tabKind === 'markdown'
    const markdownSource = activeTab?.content ?? ''
    // A Mermaid file, or the Mermaid block expanded in a Markdown file.
    const diagramSource = isMarkdownTab ? (expanded?.source ?? '') : (activeTab?.content ?? '')
    const diagramCanvasKey = isMarkdownTab ? (expanded?.canvasKey ?? null) : activeTabId
    const { currentError, isPending, isStale, isEmpty } = useMermaidSvg(diagramSource, diagramCanvasKey)

    const [exporting, setExporting] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [format, setFormat] = useState<ExportFormat>('pdf')
    const [menuOpen, setMenuOpen] = useState(false)
    // The dialog only exists for a Markdown tab. Switching away drops it, so drop its open flag too;
    // otherwise it would pop open by itself the next time a Markdown tab is active.
    if (dialogOpen && !isMarkdownTab) setDialogOpen(false)

    // Only what decides what can run, so typing in a tab doesn't rebuild the commands.
    const hasMarkdown = markdownSource.trim().length > 0
    const hasDiagram = tabKind === 'mermaid' || (isMarkdownTab && Boolean(expanded))
    const hasDiagramSource = diagramSource.trim().length > 0
    const diagramError = Boolean(currentError)
    const availability = useMemo(
        () => exportAvailability({ tabKind, exporting, hasMarkdown, hasDiagram, hasDiagramSource, diagramError, isPending, isEmpty, isStale }),
        [tabKind, exporting, hasMarkdown, hasDiagram, hasDiagramSource, diagramError, isPending, isEmpty, isStale]
    )
    // The menu shuts when there is nothing left to export, and stays shut when there is again.
    if (menuOpen && availability.trigger.disabled) setMenuOpen(false)

    const exportDiagram = useDiagramExport(
        {
            source: diagramSource,
            look: { themeId: diagramExportThemeId(diagramOptions.theme, themeId, settings.theme), transparent: diagramOptions.transparent },
            target: { tabName: activeTab?.name, tabPath: activeTab?.path, markdown: isMarkdownTab ? markdownSource : undefined },
        },
        setExporting
    )
    const setDiagramOptions = useCallback(
        (change: Partial<DiagramExportSettings>) =>
            updateSettings((current) => ({ ...current, diagramExport: { ...current.diagramExport, ...change } })),
        [updateSettings]
    )

    const openDialog = useCallback((next: ExportFormat) => {
        setFormat(next)
        setDialogOpen(true)
    }, [])
    const openMenu = useCallback(() => setMenuOpen(true), [])

    const commands = useMemo(
        () => buildExportCommands({ availability, lastFormat: format, openDialog, openMenu, exportDiagram, diagramOptions, setDiagramOptions }),
        [availability, format, openDialog, openMenu, exportDiagram, diagramOptions, setDiagramOptions]
    )
    useRegisterCommands(commands)

    const value = useMemo(
        () => ({ availability, exporting, menuOpen, setMenuOpen, openDialog, exportDiagram, diagramOptions, setDiagramOptions }),
        [availability, exporting, menuOpen, openDialog, exportDiagram, diagramOptions, setDiagramOptions]
    )

    return (
        <DocumentExportContext.Provider value={value}>
            {children}
            {isMarkdownTab ? (
                <PdfExportDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    source={markdownSource}
                    tabName={activeTab?.name}
                    tabPath={activeTab?.path}
                    workspaceRoot={workspaceRoot}
                    format={format}
                    // So the next Export… opens at the format picked in the dialog.
                    onFormatChange={setFormat}
                    allowRemoteImages={activeTabId ? remoteImageTabs.has(activeTabId) : false}
                    exporting={exporting}
                    onExportingChange={setExporting}
                />
            ) : null}
        </DocumentExportContext.Provider>
    )
}

/** The active tab's export. Only inside a DocumentExportProvider. */
export function useDocumentExport(): DocumentExport {
    const value = useContext(DocumentExportContext)
    if (!value) throw new Error('useDocumentExport must be used within DocumentExportProvider')
    return value
}
