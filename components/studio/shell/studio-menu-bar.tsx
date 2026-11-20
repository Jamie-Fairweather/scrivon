'use client'

import Image from 'next/image'
import { Menubar } from '@base-ui/react/menubar'
import { Check, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import appIcon from '@/app-icon.png'
import { APP_NAME } from '@/lib/app-branding'
import { CommandMenuItem } from '@/components/studio/commands/command-menu-item'
import { useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
import { EXPORT_FOLDER_DIAGRAMS_ID } from '@/components/studio/batch-export/batch-export-commands'
import { PNG_SCALES } from '@/components/studio/editor/export-commands'
import { displayPath } from '@/lib/workspace/display-path'
import { folderLabels } from '@/lib/workspace/paths'
import { useMenubarAccessKey } from '@/components/studio/shell/use-menubar-access-key'
import {
    TITLEBAR_ABOVE_DIALOGS_CLASS,
    TITLEBAR_MENUS_BLOCKED_CLASS,
    WindowTitlebarControls,
} from '@/components/studio/shell/window-titlebar-controls'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { Menu, MenuGroup, MenuItem, MenuPopup, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from '@/components/ui/menu'
import { MenuBarUpdateButton } from '@/components/studio/shell/menu-bar-update-button'
import { TitleBarDocumentName } from '@/components/studio/shell/title-bar-document-name'
import { ThemeMenu } from '@/components/studio/theme/theme-menu'
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

/** True when none of these commands can run (or none is registered). */
function allOff(commands: (ShownCommand | undefined)[]): boolean {
    return commands.every((command) => !command || command.disabled)
}

/**
 * File → Export: each kind of export, greyed out when the active tab can't do it, and the export of every
 * diagram in the open folder, which needs no tab. It's left out until a folder is open: the export providers
 * register these commands only then, and the welcome screen's greyed-out folder export is for the palette.
 */
function ExportSubmenu({ byId, hasWorkspace }: { byId: ReadonlyMap<string, ShownCommand>; hasWorkspace: boolean }) {
    const png = PNG_SCALES.map((scale) => byId.get(`export-png-${scale}`))
    const others = ['export-pdf', 'export-docx', 'export-html', 'export-svg', 'copy-diagram-svg', 'copy-diagram-png', EXPORT_FOLDER_DIAGRAMS_ID].map(
        (id) => byId.get(id)
    )
    if (!hasWorkspace || (!byId.has('export') && !byId.has(EXPORT_FOLDER_DIAGRAMS_ID))) return null
    return (
        <>
            <MenuSeparator />
            <MenuSub>
                <MenuSubTrigger disabled={allOff([...others, ...png])}>Export</MenuSubTrigger>
                <MenuSubPopup className="min-w-48">
                    <MenuGroup>
                        <CommandMenuItem command={byId.get('export-pdf')} label="PDF…" />
                        <CommandMenuItem command={byId.get('export-docx')} label="Word…" />
                        <CommandMenuItem command={byId.get('export-html')} label="HTML…" />
                    </MenuGroup>
                    <MenuSeparator />
                    <MenuGroup>
                        <CommandMenuItem command={byId.get('export-svg')} label="Diagram as SVG…" />
                        <MenuSub>
                            <MenuSubTrigger disabled={allOff(png)}>Diagram as PNG</MenuSubTrigger>
                            <MenuSubPopup className="min-w-36">
                                <MenuGroup>
                                    {png.map((command, index) => (
                                        <CommandMenuItem key={PNG_SCALES[index]} command={command} label={`${PNG_SCALES[index]}×…`} />
                                    ))}
                                </MenuGroup>
                            </MenuSubPopup>
                        </MenuSub>
                        <CommandMenuItem command={byId.get('copy-diagram-svg')} />
                        <CommandMenuItem command={byId.get('copy-diagram-png')} />
                    </MenuGroup>
                    {byId.has(EXPORT_FOLDER_DIAGRAMS_ID) ? (
                        <>
                            <MenuSeparator />
                            <CommandMenuItem command={byId.get(EXPORT_FOLDER_DIAGRAMS_ID)} label="All Diagrams in Folder…" />
                        </>
                    ) : null}
                </MenuSubPopup>
            </MenuSub>
        </>
    )
}

export function StudioMenuBar() {
    const { isDesktop, workspaceRoot, openingWorkspace, recentWorkspaces, openWorkspace } = useWorkspaceSession()
    const menubarRef = useRef<HTMLDivElement>(null)
    const focusAfterCommand = useMenubarAccessKey(menubarRef)

    // Every item but the Open Recent and Theme lists is a shared command, as in the palette.
    const commands = useCommands()
    const byId = useMemo(() => new Map(commands.map((command) => [command.id, command])), [commands])
    const item = (id: string, variant?: 'switch') => <CommandMenuItem command={byId.get(id)} variant={variant} />

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
                    <MenuBarEntry label="File" focusAfterCommand={focusAfterCommand}>
                        <MenuGroup>
                            {item('new-diagram')}
                            {item('new-document')}
                            {item('new-folder')}
                            {item('new-from-template')}
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuGroup>
                            {item('open-folder')}
                            {item('close-folder')}
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
                        <MenuSeparator />
                        <MenuGroup>
                            {item('save')}
                            {item('save-all')}
                            {item('revert-file')}
                            {item('show-file-history')}
                        </MenuGroup>
                        <ExportSubmenu byId={byId} hasWorkspace={hasWorkspace} />
                        <MenuSeparator />
                        <MenuGroup>
                            {item('close-tab')}
                            {item('reopen-closed-tab')}
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuGroup>
                            {item('next-tab')}
                            {item('previous-tab')}
                            {item('move-tab-left')}
                            {item('move-tab-right')}
                        </MenuGroup>
                        <MenuSeparator />
                        {item('exit')}
                    </MenuBarEntry>

                    {hasWorkspace && (
                        <MenuBarEntry label="Edit" focusAfterCommand={focusAfterCommand}>
                            <MenuGroup>
                                {item('edit.undo')}
                                {item('edit.redo')}
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuGroup>
                                {item('edit.cut')}
                                {item('edit.copy')}
                                {item('edit.paste')}
                            </MenuGroup>
                            <MenuSeparator />
                            {item('edit.select-all')}
                            <MenuSeparator />
                            <MenuGroup>
                                {item('edit.find')}
                                {item('edit.replace')}
                                {item('find-in-workspace')}
                                {item('edit.go-to-line')}
                                {item('go-to-file')}
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuGroup>
                                {item('edit.bold')}
                                {item('edit.italic')}
                                {item('edit.inline-code')}
                                {item('edit.link')}
                            </MenuGroup>
                        </MenuBarEntry>
                    )}

                    {hasWorkspace && (
                        <MenuBarEntry label="View" focusAfterCommand={focusAfterCommand}>
                            <MenuGroup>
                                {item('toggle-explorer')}
                                {item('toggle-editor')}
                                {item('toggle-preview')}
                                {item('toggle-outline')}
                                {item('toggle-status-bar')}
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuGroup>
                                {item('layout-all-panels')}
                                {item('layout-editor-preview')}
                                {item('preview-only')}
                            </MenuGroup>
                            <MenuSeparator />
                            {item('present')}
                            <MenuSeparator />
                            <MenuGroup>
                                {item('reveal-active-file')}
                                {item('collapse-all-folders')}
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuGroup>
                                {item('fit-diagram')}
                                {item('zoom-diagram-in')}
                                {item('zoom-diagram-out')}
                                {item('reset-diagram-zoom')}
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuGroup>
                                {item('app-zoom-in')}
                                {item('app-zoom-out')}
                                {item('app-zoom-reset')}
                            </MenuGroup>
                        </MenuBarEntry>
                    )}

                    <MenuBarEntry label="Options" focusAfterCommand={focusAfterCommand}>
                        {item('open-settings')}
                        <MenuSeparator />
                        <MenuGroup>
                            {item('toggle-autosave', 'switch')}
                            {item('toggle-spellcheck', 'switch')}
                        </MenuGroup>
                        <MenuSeparator />
                        <ThemeMenu />
                    </MenuBarEntry>

                    <MenuBarEntry label="Help" focusAfterCommand={focusAfterCommand}>
                        {/* In Help, which always shows, so the mouse can open it on the welcome screen too. */}
                        {byId.has('command-palette') && (
                            <>
                                {item('command-palette')}
                                <MenuSeparator />
                            </>
                        )}
                        {/* Only the desktop app registers it. */}
                        {byId.has('check-for-updates') && (
                            <>
                                {item('check-for-updates')}
                                <MenuSeparator />
                            </>
                        )}
                        <MenuGroup>
                            {item('report-issue')}
                            {item('copy-diagnostic-info')}
                            {item('open-logs-folder')}
                        </MenuGroup>
                        <MenuSeparator />
                        <MenuGroup>
                            {item('about')}
                            {item('licences')}
                        </MenuGroup>
                    </MenuBarEntry>
                </Menubar>

                {isDesktop && <MenuBarUpdateButton />}
            </nav>

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
