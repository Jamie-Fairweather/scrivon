'use client'

import { Download, Loader2 } from 'lucide-react'
import { useDocumentExport } from '@/components/studio/editor/document-export-provider'
import { PNG_SCALES } from '@/components/studio/editor/export-commands'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import { BetaBadge } from '@/components/ui/beta-badge'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from '@/components/ui/menu'

/** The tab bar's Export button and menu. What it can export, and the export itself, live in DocumentExportProvider. */
export function DocumentExportMenu() {
    const { availability, exporting, menuOpen, setMenuOpen, openDialog, exportDiagram } = useDocumentExport()
    const { settings } = useAppSettings()
    const { trigger, document, diagram } = availability

    const keys = formatKeybindForAction('document.export', settings.keybinds)
    const triggerTitle = trigger.disabled ? trigger.reason : keys ? `Export document (${keys})` : 'Export document'
    // A spinner on the diagram items says they are waiting for the drawing, not broken.
    const drawing = diagram.drawing ? <Loader2 className="animate-spin" aria-hidden /> : null

    return (
        // The button is aria-disabled rather than disabled, so it can still be focused or hovered to say why.
        // The menu stays shut while it is off, and shuts if it goes off while open (see DocumentExportProvider).
        <Menu open={menuOpen} onOpenChange={(next) => setMenuOpen(next && !trigger.disabled)}>
            {/* The tooltip's trigger renders the menu's trigger, which renders the button, so both work on one button. */}
            <IconTooltip label={triggerTitle} description={trigger.disabled ? trigger.reason : undefined}>
                <MenuTrigger
                    render={
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Export document"
                            aria-disabled={trigger.disabled || undefined}
                            className="aria-disabled:cursor-default aria-disabled:opacity-64 aria-disabled:hover:bg-transparent"
                        />
                    }
                >
                    {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                </MenuTrigger>
            </IconTooltip>
            <MenuPopup align="end" className="min-w-44">
                <MenuGroup>
                    {document.shown ? (
                        <>
                            <MenuItem disabled={document.disabled} onClick={() => openDialog('pdf')}>
                                Save PDF
                                <BetaBadge className="ms-auto" />
                            </MenuItem>
                            <MenuItem disabled={document.disabled} onClick={() => openDialog('docx')}>
                                Save Word
                                <BetaBadge className="ms-auto" />
                            </MenuItem>
                            <MenuItem disabled={document.disabled} onClick={() => openDialog('html')}>
                                Save HTML
                            </MenuItem>
                        </>
                    ) : null}
                    {diagram.shown ? (
                        <>
                            <MenuItem disabled={diagram.disabled} aria-busy={diagram.drawing || undefined} onClick={() => exportDiagram('svg')}>
                                Save SVG
                                {drawing}
                            </MenuItem>
                            <MenuSub>
                                <MenuSubTrigger disabled={diagram.disabled} aria-busy={diagram.drawing || undefined}>
                                    Save PNG
                                    {drawing}
                                </MenuSubTrigger>
                                <MenuSubPopup className="min-w-36">
                                    <MenuGroup>
                                        {PNG_SCALES.map((scale) => (
                                            <MenuItem key={scale} disabled={diagram.disabled} onClick={() => exportDiagram(scale)}>
                                                {scale}×
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
