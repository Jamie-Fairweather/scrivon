'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useMermaidSvg } from '@/components/studio/canvas/use-mermaid-svg'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from '@/components/ui/menu'
import { exportPng, exportSvg, type PngExportScale } from '@/lib/mermaid/export'

type DiagramExportMenuProps = {
    disabled?: boolean
}

const PNG_SCALES: { label: string; scale: PngExportScale }[] = [
    { label: '1×', scale: 1 },
    { label: '2×', scale: 2 },
    { label: '4×', scale: 4 },
]

export function DiagramExportMenu({ disabled: disabledProp }: DiagramExportMenuProps) {
    const { activeTab, activeTabId } = useDocumentTabs()
    const { themeId } = useAppTheme()
    const source = activeTab?.content ?? ''
    const { error, isPending } = useMermaidSvg(source, activeTabId)
    const [exporting, setExporting] = useState(false)

    const hasSource = source.trim().length > 0
    const disabled = disabledProp || !hasSource || Boolean(error) || isPending || exporting

    const runExport = async (action: () => Promise<void>) => {
        if (disabled) return
        setExporting(true)
        try {
            await action()
        } finally {
            setExporting(false)
        }
    }

    const tabName = activeTab?.name

    return (
        <Menu>
            <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Export diagram" title="Export diagram" disabled={disabled} />}>
                {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-44">
                <MenuGroup>
                    <MenuItem disabled={disabled} onClick={() => void runExport(() => exportSvg(source, themeId, tabName))}>
                        Save SVG
                    </MenuItem>
                    <MenuSub>
                        <MenuSubTrigger disabled={disabled}>Save PNG</MenuSubTrigger>
                        <MenuSubPopup className="min-w-36">
                            <MenuGroup>
                                {PNG_SCALES.map(({ label, scale }) => (
                                    <MenuItem
                                        key={scale}
                                        disabled={disabled}
                                        onClick={() => void runExport(() => exportPng(source, themeId, tabName, scale))}
                                    >
                                        {label}
                                    </MenuItem>
                                ))}
                            </MenuGroup>
                        </MenuSubPopup>
                    </MenuSub>
                </MenuGroup>
            </MenuPopup>
        </Menu>
    )
}
