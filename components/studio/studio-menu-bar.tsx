'use client'

import type { MouseEvent, ReactNode } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from '@/lib/tauri/platform'
import { WindowTitlebarControls } from '@/components/studio/window-titlebar-controls'
import { useCanvasFit, useDocumentSave, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace-provider'
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
import { getBaseName } from '@/lib/tauri/fs'

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
    const { isDesktop, workspaceRoot, recentWorkspaces, pickAndOpenWorkspace, openWorkspace, closeWorkspace } =
        useWorkspaceSession()
    const { layout, setExplorerOpen, setEditorOpen, setPreviewOnly } = useStudioLayout()
    const { autosaveEnabled, setAutosaveEnabled } = useDocumentSave()
    const { requestCanvasFit } = useCanvasFit()

    const hasWorkspace = Boolean(workspaceRoot)

    const onDragRegionMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        if (!isTauri() || event.button !== 0) return

        const appWindow = getCurrentWindow()
        if (event.detail === 2) {
            void appWindow.toggleMaximize()
            return
        }

        void appWindow.startDragging()
    }

    return (
        <header
            aria-label="Application title bar"
            className="pointer-events-auto flex h-[var(--titlebar-height)] shrink-0 items-center border-b border-border bg-background select-none"
        >
            <nav aria-label="Application menu" className="flex shrink-0 items-center px-1">
                <div className="flex items-center gap-0.5">
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
                            <MenuCheckboxItem
                                variant="switch"
                                checked={autosaveEnabled}
                                onCheckedChange={(checked) => setAutosaveEnabled(checked === true)}
                            >
                                Autosave
                            </MenuCheckboxItem>
                        </MenuGroup>
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
                </div>
            </nav>

            {isDesktop ? (
                <div className="min-h-0 min-w-0 flex-1 self-stretch" data-tauri-drag-region onMouseDown={onDragRegionMouseDown} />
            ) : (
                <div className="min-w-0 flex-1" />
            )}

            {isDesktop && <WindowTitlebarControls />}
        </header>
    )
}
