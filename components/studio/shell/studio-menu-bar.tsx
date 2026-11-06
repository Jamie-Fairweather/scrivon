'use client'

import Image from 'next/image'
import { Menubar } from '@base-ui/react/menubar'
import { useRef, useState, type ReactNode } from 'react'
import appIcon from '@/app-icon.png'
import { APP_NAME } from '@/lib/app-branding'
import { AboutDialog } from '@/components/studio/dialogs/about-dialog'
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
    MenuSub,
    MenuSubPopup,
    MenuSubTrigger,
    MenuTrigger,
} from '@/components/ui/menu'
import { MenuBarUpdateButton } from '@/components/studio/shell/menu-bar-update-button'
import { ThemeMenu } from '@/components/studio/theme/theme-menu'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { getBaseName } from '@/lib/tauri/fs'
import { cn } from '@/lib/utils'

function MenuBarEntry({ label, children }: { label: string; children: ReactNode }) {
    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button variant="ghost" size="xs" className="h-7 min-h-0 rounded-md px-2.5 font-normal text-foreground/90 hover:bg-accent/80" />
                }
            >
                {label}
            </MenuTrigger>
            <MenuPopup align="start" className="min-w-48">
                {children}
            </MenuPopup>
        </Menu>
    )
}

export function StudioMenuBar() {
    const { isDesktop, workspaceRoot, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace } = useWorkspaceSession()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOnly } = useStudioLayout()
    const { autosaveEnabled, setAutosaveEnabled } = useDocumentSave()
    const { openSettings } = useAppSettings()
    const { requestCanvasFit } = useCanvasFit()
    const [aboutOpen, setAboutOpen] = useState(false)
    const [licensesOpen, setLicensesOpen] = useState(false)
    const menubarRef = useRef<HTMLDivElement>(null)
    useMenubarAccessKey(menubarRef)

    const hasWorkspace = Boolean(workspaceRoot)

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
                    <MenuBarEntry label="File">
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
                                            {recentWorkspaces.map((path) => (
                                                <MenuItem key={path} disabled={!isDesktop} onClick={() => void openWorkspace(path)} title={path}>
                                                    <span className="truncate">{getBaseName(path)}</span>
                                                </MenuItem>
                                            ))}
                                        </MenuGroup>
                                    </MenuSubPopup>
                                </MenuSub>
                            </>
                        )}
                    </MenuBarEntry>

                    <MenuBarEntry label="Options">
                        <MenuGroup>
                            <MenuItem onClick={() => openSettings()}>Settings…</MenuItem>
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
                        <MenuBarEntry label="View">
                            <MenuGroup>
                                <MenuCheckboxItem checked={layout.explorerOpen} onCheckedChange={(checked) => setExplorerOpen(checked === true)}>
                                    Explorer
                                </MenuCheckboxItem>
                                <MenuCheckboxItem checked={layout.editorOpen} onCheckedChange={(checked) => setEditorOpen(checked === true)}>
                                    Editor
                                </MenuCheckboxItem>
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuItem onClick={setPreviewOnly}>Preview Only</MenuItem>
                            <MenuSeparator />
                            <MenuItem onClick={requestCanvasFit}>Fit Diagram to Screen</MenuItem>
                        </MenuBarEntry>
                    )}

                    <MenuBarEntry label="Help">
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
                <div className="min-h-0 min-w-0 flex-1 self-stretch" data-tauri-drag-region />
            ) : (
                <div className="min-w-0 flex-1" />
            )}

            {isDesktop && <WindowTitlebarControls />}
        </header>
    )
}
