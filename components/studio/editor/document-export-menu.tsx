'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { PdfExportDialog } from '@/components/studio/editor/pdf-export-dialog'
import { useMarkdownExpand, useMarkdownPreviewMemory } from '@/components/studio/markdown/markdown-expand-context'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import type { ExportFormat } from '@/lib/markdown/export-document'
import type { PngExportScale } from '@/lib/mermaid/export'
import { notifyError } from '@/lib/notify'
import { documentKind } from '@/lib/workspace/file-types'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from '@/components/ui/menu'

/** Loaded when the user exports, so the export code and the diagram renderer it needs aren't part of every launch. */
const loadDiagramExport = () => import('@/lib/mermaid/export')

const PNG_SCALES: { label: string; scale: PngExportScale }[] = [
    { label: '1×', scale: 1 },
    { label: '2×', scale: 2 },
    { label: '4×', scale: 4 },
]

type ExportOffState = {
    tabKind: ReturnType<typeof documentKind>
    exporting: boolean
    hasMarkdown: boolean
    hasDiagramSource: boolean
    diagramError: boolean
    isPending: boolean
}

/** Why the Export button is off, shown in its tooltip and read out as its description. */
function exportOffReason({ tabKind, exporting, hasMarkdown, hasDiagramSource, diagramError, isPending }: ExportOffState): string {
    if (!tabKind) return 'Open a document to export'
    if (exporting) return 'Exporting…'
    if (tabKind === 'markdown' && !hasMarkdown) return 'Nothing to export: the document is empty'
    // A Mermaid file, or the Mermaid block expanded in a Markdown file.
    if (!hasDiagramSource) return 'Nothing to export: the diagram is empty'
    if (diagramError) return 'Fix the diagram error to export'
    if (isPending) return 'Drawing the diagram…'
    return 'No diagram to export'
}

export function DocumentExportMenu() {
    const { activeTab, activeTabId } = useDocumentTabs()
    const { expanded } = useMarkdownExpand()
    // Web images the user chose to load in this tab's preview print in its PDF too.
    const { remoteImageTabs } = useMarkdownPreviewMemory()
    const { themeId } = useAppTheme()

    const tabKind = activeTab ? documentKind(activeTab.name) : null
    const isMarkdownTab = tabKind === 'markdown'
    const isMermaidTab = tabKind === 'mermaid'

    const markdownSource = activeTab?.content ?? ''
    const diagramExportSource = isMarkdownTab ? (expanded?.source ?? '') : (activeTab?.content ?? '')
    const diagramExportCanvasKey = isMarkdownTab ? (expanded?.canvasKey ?? null) : activeTabId

    const { currentError, isPending, isStale, isEmpty } = useMermaidSvg(diagramExportSource, diagramExportCanvasKey)
    const [exporting, setExporting] = useState(false)
    const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf')
    const [pdfDialogOpen, setPdfDialogOpen] = useState(false)
    const [menuOpen, setMenuOpen] = useState(false)
    // The dialog only exists for a Markdown tab. Switching away drops it, so drop its open flag too;
    // otherwise it would pop open by itself the next time a Markdown tab is active.
    if (pdfDialogOpen && !isMarkdownTab) setPdfDialogOpen(false)

    const hasMarkdown = markdownSource.trim().length > 0
    const hasDiagramSource = diagramExportSource.trim().length > 0
    const showDiagramExport = isMermaidTab || (isMarkdownTab && Boolean(expanded))
    const diagramBlocked = isMarkdownTab && !expanded
    const diagramDisabled = diagramBlocked || !hasDiagramSource || Boolean(currentError) || isPending || isEmpty || exporting
    // The text on screen is newer than the picture and may turn out broken or empty. Only the items wait for
    // it: dimming the whole Export button too would make it flicker on every keystroke.
    const diagramItemDisabled = diagramDisabled || isStale
    // A spinner on those items says why they are off for now.
    const diagramDrawing = isStale && !diagramDisabled
    const pdfDisabled = !hasMarkdown || exporting

    const runExport = async (action: () => Promise<void>) => {
        setExporting(true)
        try {
            await action()
        } catch (err) {
            // The exports report their own failures, so this is the export code failing to load.
            notifyError('Export failed', err)
        } finally {
            setExporting(false)
        }
    }

    const tabName = activeTab?.name
    const diagramTarget = { tabName, tabPath: activeTab?.path, markdown: isMarkdownTab ? markdownSource : undefined }
    // With no Markdown or Mermaid tab open the menu would have nothing in it.
    const triggerDisabled =
        !tabKind || exporting || (isMermaidTab && diagramDisabled) || (isMarkdownTab && pdfDisabled && (!showDiagramExport || diagramDisabled))
    const triggerTitle = triggerDisabled
        ? exportOffReason({ tabKind, exporting, hasMarkdown, hasDiagramSource, diagramError: Boolean(currentError), isPending })
        : 'Export document'
    // The button is aria-disabled rather than disabled, so it can still be focused or hovered to say why.
    // The menu stays shut while it is off, and shuts if it goes off while open.
    if (menuOpen && triggerDisabled) setMenuOpen(false)

    return (
        <>
            <Menu open={menuOpen} onOpenChange={(next) => setMenuOpen(next && !triggerDisabled)}>
                {/* The tooltip's trigger renders the menu's trigger, which renders the button, so both work on one button. */}
                <IconTooltip label={triggerTitle} description={triggerDisabled ? triggerTitle : undefined}>
                    <MenuTrigger
                        render={
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Export document"
                                aria-disabled={triggerDisabled || undefined}
                                className="aria-disabled:cursor-default aria-disabled:opacity-64 aria-disabled:hover:bg-transparent"
                            />
                        }
                    >
                        {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                    </MenuTrigger>
                </IconTooltip>
                <MenuPopup align="end" className="min-w-44">
                    <MenuGroup>
                        {isMarkdownTab ? (
                            <>
                                <MenuItem
                                    disabled={pdfDisabled}
                                    onClick={() => {
                                        setExportFormat('pdf')
                                        setPdfDialogOpen(true)
                                    }}
                                >
                                    Save PDF
                                </MenuItem>
                                <MenuItem
                                    disabled={pdfDisabled}
                                    onClick={() => {
                                        setExportFormat('docx')
                                        setPdfDialogOpen(true)
                                    }}
                                >
                                    Save Word
                                </MenuItem>
                            </>
                        ) : null}
                        {showDiagramExport ? (
                            <>
                                <MenuItem
                                    disabled={diagramItemDisabled}
                                    aria-busy={diagramDrawing || undefined}
                                    onClick={() =>
                                        void runExport(async () => (await loadDiagramExport()).exportSvg(diagramExportSource, themeId, diagramTarget))
                                    }
                                >
                                    Save SVG
                                    {diagramDrawing && <Loader2 className="animate-spin" aria-hidden />}
                                </MenuItem>
                                <MenuSub>
                                    <MenuSubTrigger disabled={diagramItemDisabled} aria-busy={diagramDrawing || undefined}>
                                        Save PNG
                                        {diagramDrawing && <Loader2 className="animate-spin" aria-hidden />}
                                    </MenuSubTrigger>
                                    <MenuSubPopup className="min-w-36">
                                        <MenuGroup>
                                            {PNG_SCALES.map(({ label, scale }) => (
                                                <MenuItem
                                                    key={scale}
                                                    disabled={diagramItemDisabled}
                                                    onClick={() =>
                                                        void runExport(async () =>
                                                            (await loadDiagramExport()).exportPng(diagramExportSource, themeId, diagramTarget, scale)
                                                        )
                                                    }
                                                >
                                                    {label}
                                                </MenuItem>
                                            ))}
                                        </MenuGroup>
                                    </MenuSubPopup>
                                </MenuSub>
                            </>
                        ) : null}
                    </MenuGroup>
                </MenuPopup>
            </Menu>
            {isMarkdownTab ? (
                <PdfExportDialog
                    open={pdfDialogOpen}
                    onOpenChange={setPdfDialogOpen}
                    source={markdownSource}
                    tabName={tabName}
                    tabPath={activeTab?.path}
                    format={exportFormat}
                    allowRemoteImages={activeTabId ? remoteImageTabs.has(activeTabId) : false}
                    exporting={exporting}
                    onExportingChange={setExporting}
                />
            ) : null}
        </>
    )
}
