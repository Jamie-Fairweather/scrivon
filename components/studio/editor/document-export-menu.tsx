'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { useMarkdownExpand } from '@/components/studio/markdown/markdown-expand-context'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { exportMarkdownToPdf } from '@/lib/markdown/export-pdf'
import { exportPng, exportSvg, type PngExportScale } from '@/lib/mermaid/export'
import { documentKind } from '@/lib/workspace/file-types'
import { Button } from '@/components/ui/button'
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from '@/components/ui/menu'

const PNG_SCALES: { label: string; scale: PngExportScale }[] = [
    { label: '1×', scale: 1 },
    { label: '2×', scale: 2 },
    { label: '4×', scale: 4 },
]

export function DocumentExportMenu() {
    const { activeTab, activeTabId } = useDocumentTabs()
    const { expanded } = useMarkdownExpand()
    const { themeId } = useAppTheme()

    const tabKind = activeTab ? documentKind(activeTab.name) : null
    const isMarkdownTab = tabKind === 'markdown'
    const isMermaidTab = tabKind === 'mermaid'

    const markdownSource = activeTab?.content ?? ''
    const diagramExportSource = isMarkdownTab ? (expanded?.source ?? '') : (activeTab?.content ?? '')
    const diagramExportCanvasKey = isMarkdownTab ? (expanded?.canvasKey ?? null) : activeTabId

    const { error, isPending } = useMermaidSvg(diagramExportSource, diagramExportCanvasKey)
    const [exporting, setExporting] = useState(false)

    const hasMarkdown = markdownSource.trim().length > 0
    const hasDiagramSource = diagramExportSource.trim().length > 0
    const showDiagramExport = isMermaidTab || (isMarkdownTab && Boolean(expanded))
    const diagramBlocked = isMarkdownTab && !expanded
    const diagramDisabled = diagramBlocked || !hasDiagramSource || Boolean(error) || isPending || exporting
    const pdfDisabled = !hasMarkdown || exporting

    const runExport = async (action: () => Promise<void>) => {
        setExporting(true)
        try {
            await action()
        } finally {
            setExporting(false)
        }
    }

    const tabName = activeTab?.name
    const triggerDisabled =
        exporting || (isMermaidTab && diagramDisabled) || (isMarkdownTab && pdfDisabled && (!showDiagramExport || diagramDisabled))

    return (
        <Menu>
            <MenuTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label="Export document" title="Export document" disabled={triggerDisabled} />}
            >
                {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-44">
                <MenuGroup>
                    {isMarkdownTab ? (
                        <MenuItem disabled={pdfDisabled} onClick={() => void runExport(() => exportMarkdownToPdf(markdownSource, tabName))}>
                            Save PDF
                        </MenuItem>
                    ) : null}
                    {showDiagramExport ? (
                        <>
                            <MenuItem
                                disabled={diagramDisabled}
                                onClick={() => void runExport(() => exportSvg(diagramExportSource, themeId, tabName))}
                            >
                                Save SVG
                            </MenuItem>
                            <MenuSub>
                                <MenuSubTrigger disabled={diagramDisabled}>Save PNG</MenuSubTrigger>
                                <MenuSubPopup className="min-w-36">
                                    <MenuGroup>
                                        {PNG_SCALES.map(({ label, scale }) => (
                                            <MenuItem
                                                key={scale}
                                                disabled={diagramDisabled}
                                                onClick={() => void runExport(() => exportPng(diagramExportSource, themeId, tabName, scale))}
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
    )
}
