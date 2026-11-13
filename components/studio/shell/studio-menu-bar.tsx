'use client'

import Image from 'next/image'
import { Menubar } from '@base-ui/react/menubar'
import { Check, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import appIcon from '@/app-icon.png'
import { APP_NAME } from '@/lib/app-branding'
import { useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
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

/**
 * A menu item for a shared command, with the same label, tick, shortcut and enabled state as the
 * palette shows. Nothing shows while no feature has registered the command.
 */
function CommandMenuItem({ command, variant }: { command: ShownCommand | undefined; variant?: 'switch' }) {
    if (!command) return null
    const run = () => void command.run()
    if (command.checked !== undefined) {
        return (
            <MenuCheckboxItem variant={variant} checked={command.checked} disabled={command.disabled} onCheckedChange={run}>
                {variant === 'switch' ? command.label : <CheckboxLabelWithHint label={command.label} shortcut={command.shortcut} />}
            </MenuCheckboxItem>
        )
    }
    return (
        <MenuItem disabled={command.disabled} onClick={run}>
            {command.label}
            <MenuHint shortcut={command.shortcut} />
        </MenuItem>
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
                        </MenuGroup>
                        <MenuSeparator />
                        {item('close-tab')}
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
                                {item('edit.go-to-line')}
                            </MenuGroup>
                        </MenuBarEntry>
                    )}

                    {hasWorkspace && (
                        <MenuBarEntry label="View" focusAfterCommand={focusAfterCommand}>
                            <MenuGroup>
                                {item('toggle-explorer')}
                                {item('toggle-editor')}
                                {item('toggle-outline')}
                            </MenuGroup>
                            <MenuSeparator />
                            <MenuGroup>
                                {item('layout-all-panels')}
                                {item('layout-editor-preview')}
                                {item('preview-only')}
                            </MenuGroup>
                            <MenuSeparator />
                            {item('fit-diagram')}
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
                        {item('toggle-autosave', 'switch')}
                        <MenuSeparator />
                        <ThemeMenu />
                    </MenuBarEntry>

                    <MenuBarEntry label="Help" focusAfterCommand={focusAfterCommand}>
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
