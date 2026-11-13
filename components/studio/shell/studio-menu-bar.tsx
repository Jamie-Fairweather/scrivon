'use client'

import Image from 'next/image'
import { Menubar } from '@base-ui/react/menubar'
import { Check, Loader2 } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import appIcon from '@/app-icon.png'
import { APP_NAME } from '@/lib/app-branding'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { AboutDialog } from '@/components/studio/dialogs/about-dialog'
import { displayPath } from '@/lib/workspace/display-path'
import { folderLabels } from '@/lib/workspace/paths'
import { OpenSourceLicensesDialog } from '@/components/studio/dialogs/open-source-licenses-dialog'
import { useMenubarAccessKey } from '@/components/studio/shell/use-menubar-access-key'
import {
    TITLEBAR_ABOVE_DIALOGS_CLASS,
    TITLEBAR_MENUS_BLOCKED_CLASS,
    WindowTitlebarControls,
} from '@/components/studio/shell/window-titlebar-controls'
import { useCanvasFit, useDocumentSave, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import {
    Menu,
    MenuCheckboxItem,
    MenuGroup,
    MenuItem,
    MenuPopup,
    MenuSeparator,
    MenuShortcut,
    MenuSub,
    MenuSubPopup,
    MenuSubTrigger,
    MenuTrigger,
} from '@/components/ui/menu'
import { MenuBarUpdateButton } from '@/components/studio/shell/menu-bar-update-button'
import { TitleBarDocumentName } from '@/components/studio/shell/title-bar-document-name'
import { ThemeMenu } from '@/components/studio/theme/theme-menu'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import type { KeybindActionId } from '@/lib/settings/types'
import { getBaseName, samePath } from '@/lib/tauri/fs'
import { cn } from '@/lib/utils'

function MenuBarEntry({
    label,
    children,
    focusAfterCommand,
}: {
    label: string
    children: ReactNode
    focusAfterCommand: () => HTMLElement | boolean
}) {
    // A chosen command sends focus back to where it was before the menu bar, not to this title. Esc,
    // clicking away and moving to the next menu keep Base UI's own focus handling.
    const [closedByCommand, setClosedByCommand] = useState(false)
    return (
        <Menu onOpenChange={(open, details) => setClosedByCommand(!open && details.reason === 'item-press')}>
            <MenuTrigger
                render={
                    <Button variant="ghost" size="xs" className="h-7 min-h-0 rounded-md px-2.5 font-normal text-foreground/90 hover:bg-accent/80" />
                }
            >
                {label}
            </MenuTrigger>
            <MenuPopup align="start" className="min-w-48" finalFocus={closedByCommand ? focusAfterCommand : undefined}>
                {children}
            </MenuPopup>
        </Menu>
    )
}

/** The user's current chord for a menu item, right-aligned. Renders nothing when the action is unbound. */
function MenuHint({ shortcut, className }: { shortcut: string | undefined; className?: string }) {
    return shortcut ? <MenuShortcut className={cn('ps-6 tracking-normal', className)}>{shortcut}</MenuShortcut> : null
}

/** Checkbox rows keep their label in a grid cell, so lay out label and hint as a row inside it. */
function CheckboxLabelWithHint({ label, shortcut }: { label: string; shortcut: string | undefined }) {
    return (
        <span className="flex items-center">
            {label}
            {/* Checkbox rows have more end padding than plain items; pull the hint out to line up with them. */}
            <MenuHint shortcut={shortcut} className="-me-2" />
        </span>
    )
}

export function StudioMenuBar() {
    const { isDesktop, workspaceRoot, openingWorkspace, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace } =
        useWorkspaceSession()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOnly } = useStudioLayout()
    const { autosaveEnabled, setAutosaveEnabled } = useDocumentSave()
    const { settings, openSettings } = useAppSettings()
    const { requestCanvasFit } = useCanvasFit()
    // Off when nothing is drawn (an empty file, a Markdown tab with no diagram opened full size).
    const { canFitToView } = useCanvasControls()
    const [aboutOpen, setAboutOpen] = useState(false)
    const [licensesOpen, setLicensesOpen] = useState(false)
    const menubarRef = useRef<HTMLDivElement>(null)
    const focusAfterCommand = useMenubarAccessKey(menubarRef)

    const hasWorkspace = Boolean(workspaceRoot)
    // Read from settings on every render so the menu follows the user's own key bindings.
    const shortcut = (actionId: KeybindActionId) => formatKeybindForAction(actionId, settings.keybinds)

    return (
        <header
            aria-label="Application title bar"
            className={cn(
                'pointer-events-auto flex h-[var(--titlebar-height)] shrink-0 items-center border-b border-border bg-background select-none',
                TITLEBAR_ABOVE_DIALOGS_CLASS
            )}
        >
            <div className="flex shrink-0 items-center pr-1 pl-2">
                <Image src={appIcon} alt="" width={20} height={20} className="size-5 shrink-0 rounded-sm" aria-hidden />
                <span className="sr-only">{APP_NAME}</span>
            </div>
            <nav aria-label="Application menu" className={cn('flex shrink-0 items-center px-1', TITLEBAR_MENUS_BLOCKED_CLASS)}>
                <Menubar ref={menubarRef} modal={false} className="flex items-center gap-0.5">
                    <MenuBarEntry label="File" focusAfterCommand={focusAfterCommand}>
                        <MenuGroup>
                            <MenuItem disabled={!isDesktop} onClick={() => void pickAndOpenWorkspace()}>
                                Open Folder…
                            </MenuItem>
                            <MenuItem disabled={!hasWorkspace} onClick={() => void closeWorkspace()}>
                                Close Folder
                            </MenuItem>
                        </MenuGroup>
                        {recentWorkspaces.length > 0 && (
                            <>
                                <MenuSeparator />
                                <MenuSub>
                                    <MenuSubTrigger>Open Recent</MenuSubTrigger>
                                    <MenuSubPopup className="min-w-56">
                                        <MenuGroup>
                                            {folderLabels(recentWorkspaces).map(({ path, location }) => {
                                                const current = workspaceRoot !== null && samePath(path, workspaceRoot)
                                                // Still being read; the other folders stay open to pick, since the last one picked wins.
                                                const opening = openingWorkspace !== null && samePath(path, openingWorkspace)
                                                return (
                                                    <MenuItem
                                                        key={path}
                                                        disabled={!isDesktop || opening}
                                                        onClick={() => void openWorkspace(path)}
                                                        title={current ? `${displayPath(path)} (current folder)` : displayPath(path)}
                                                        aria-busy={opening || undefined}
                                                    >
                                                        {/* A column like a radio menu's: a tick on the open folder, a spinner on one being opened. */}
                                                        {opening ? (
                                                            <Loader2 className="animate-spin" aria-hidden />
                                                        ) : current ? (
                                                            <Check aria-hidden />
                                                        ) : (
                                                            <span className="-mx-0.5 size-4.5 shrink-0 sm:size-4" aria-hidden />
                                                        )}
                                                        <span dir="auto" className="truncate">
                                                            {getBaseName(path)}
                                                        </span>
                                                        {/* Said, not aria-current: Windows Contrast themes fill aria-current rows like the
                                                            keyboard's row (app/globals.css), so two rows would look picked. */}
                                                        {current && <span className="sr-only"> (current folder)</span>}
                                                        {location && (
                                                            <span
                                                                className="ms-auto truncate ps-4 text-xs text-muted-foreground
                                                                    in-data-highlighted:text-accent-foreground"
                                                            >
                                                                {displayPath(location)}
                                                            </span>
                                                        )}
                                                    </MenuItem>
                                                )
                                            })}
                                        </MenuGroup>
                                    </MenuSubPopup>
                                </MenuSub>
                            </>
                        )}
                    </MenuBarEntry>

                    <MenuBarEntry label="Options" focusAfterCommand={focusAfterCommand}>
                        <MenuGroup>
                            <MenuItem onClick={() => openSettings()}>
                                Settings…
                                <MenuHint shortcut={shortcut('settings.open')} />
                            </MenuItem>
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuGroup>
                            <MenuCheckboxItem
                                variant="switch"
                                checked={autosaveEnabled}
                                onCheckedChange={(checked) => setAutosaveEnabled(checked === true)}
                            >
                                Autosave
                            </MenuCheckboxItem>
                        </MenuGroup>
                        <MenuSeparator />
                        <ThemeMenu />
                    </MenuBarEntry>

                    {hasWorkspace && (
                        <MenuBarEntry label="View" focusAfterCommand={focusAfterCommand}>
                            <MenuGroup>
                                <MenuCheckboxItem checked={layout.explorerOpen} onCheckedChange={(checked) => setExplorerOpen(checked === true)}>
                                    <CheckboxLabelWithHint label="Explorer" shortcut={shortcut('view.toggleExplorer')} />
                                </MenuCheckboxItem>
                                <MenuCheckboxItem checked={layout.editorOpen} onCheckedChange={(checked) => setEditorOpen(checked === true)}>
                                    <CheckboxLabelWithHint label="Editor" shortcut={shortcut('view.toggleEditor')} />
                                </MenuCheckboxItem>
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuItem onClick={setPreviewOnly}>
                                Preview Only
                                <MenuHint shortcut={shortcut('view.previewOnly')} />
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem disabled={!canFitToView} onClick={requestCanvasFit}>
                                Fit Diagram to Screen
                                <MenuHint shortcut={shortcut('view.fitDiagram')} />
                            </MenuItem>
                        </MenuBarEntry>
                    )}

                    <MenuBarEntry label="Help" focusAfterCommand={focusAfterCommand}>
                        <MenuGroup>
                            <MenuItem onClick={() => setAboutOpen(true)}>About {APP_NAME}…</MenuItem>
                            <MenuItem onClick={() => setLicensesOpen(true)}>Licences…</MenuItem>
                        </MenuGroup>
                    </MenuBarEntry>
                </Menubar>

                {isDesktop && <MenuBarUpdateButton />}
            </nav>

            <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} onOpenLicenses={() => setLicensesOpen(true)} />
            <OpenSourceLicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />

            {isDesktop ? (
                // Tauri's built-in drag script handles both dragging and double-click to maximise here.
                <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center self-stretch px-3" data-tauri-drag-region>
                    <TitleBarDocumentName />
                </div>
            ) : (
                <div className="flex min-w-0 flex-1 items-center justify-center px-3">
                    <TitleBarDocumentName />
                </div>
            )}

            {isDesktop && <WindowTitlebarControls />}
        </header>
    )
}
