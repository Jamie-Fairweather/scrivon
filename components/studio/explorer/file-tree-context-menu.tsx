'use client'

import { Copy, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useCallback, type RefObject } from 'react'
import { NewItemMenuItems } from '@/components/studio/explorer/new-item-menu-items'
import { PathMenuItems } from '@/components/studio/explorer/path-menu-items'
import { useRowEntryActions } from '@/components/studio/explorer/use-file-tree-actions'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { ContextMenuAtPoint, useContextMenuAtPoint } from '@/components/ui/context-menu'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { isSupportedDocument } from '@/lib/tauri/fs'
import type { FileNode } from '@/lib/workspace/types'

function FileTreeMenuItems({ node }: { node: FileNode }) {
    const { openFile, duplicateFile } = useWorkspaceSession()
    const { renameWithPrompt, deleteWithConfirm } = useRowEntryActions()

    if (node.kind === 'file') {
        return (
            <>
                <MenuItem disabled={!isSupportedDocument(node.name)} onClick={() => void openFile(node.path)}>
                    Open
                </MenuItem>
                <MenuItem onClick={() => void renameWithPrompt(node)}>
                    <Pencil />
                    Rename
                </MenuItem>
                <MenuItem onClick={() => void duplicateFile(node.path)}>
                    <Copy />
                    Duplicate
                </MenuItem>
                <MenuSeparator />
                <PathMenuItems path={node.path} />
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => void deleteWithConfirm(node)}>
                    <Trash2 />
                    Delete
                </MenuItem>
            </>
        )
    }

    return (
        <>
            <NewItemMenuItems folder={node.path} />
            <MenuItem onClick={() => void renameWithPrompt(node)}>
                <Pencil />
                Rename
            </MenuItem>
            <MenuSeparator />
            <PathMenuItems path={node.path} />
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => void deleteWithConfirm(node)}>
                <Trash2 />
                Delete
            </MenuItem>
        </>
    )
}

/**
 * The '...' button at the end of a row, for the mouse. Keyboard users reach the same menu with Shift+F10 or the
 * menu key on the row, so the button is left out of the Tab order and hidden from screen readers.
 */
export function FileTreeContextMenu({ node, rowRef }: { node: FileNode; rowRef: RefObject<HTMLElement | null> }) {
    // Closing the menu puts focus back on the row, so the arrow keys keep working. But only while focus is still in
    // the menu (or nowhere): a name prompt or delete confirmation opened from it has taken focus and keeps it.
    // This runs as the menu closes, before it leaves the page, so it sees where focus really is.
    const backToRow = useCallback(() => {
        const active = document.activeElement
        const focusInMenu = !active || active === document.body || active.closest('[data-slot="menu-popup"]') !== null
        return focusInMenu ? rowRef.current : false
    }, [rowRef])

    return (
        <Menu>
            <MenuTrigger
                render={
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        tabIndex={-1}
                        aria-hidden
                        // Shown on hover, when the row has keyboard focus, and while its own menu is open.
                        className="size-6 shrink-0 opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 focus-visible:opacity-100
                            data-popup-open:opacity-100"
                        aria-label={`Actions for ${node.name}`}
                    >
                        <MoreHorizontal className="size-3.5" />
                    </Button>
                }
            />
            <MenuPopup align="start" className="min-w-44" finalFocus={backToRow}>
                <FileTreeMenuItems node={node} />
            </MenuPopup>
        </Menu>
    )
}

function isMenuKey(e: React.KeyboardEvent): boolean {
    return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
}

export function FileTreeRowContextMenu({ node, children }: { node: FileNode; children: React.ReactNode }) {
    const { open, anchor, openAt, onOpenChange } = useContextMenuAtPoint()

    const onContextMenu = useCallback(
        (e: React.MouseEvent) => {
            // React also delivers right-clicks from this row's open menus (they render in a portal); leave those alone.
            if (!e.currentTarget.contains(e.target as Node)) return
            e.preventDefault()
            e.stopPropagation()
            openAt({ x: e.clientX, y: e.clientY })
        },
        [openAt]
    )

    // Shift+F10 or the menu key on the focused row opens its menu just below the row.
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            const target = e.target as HTMLElement
            if (target.getAttribute('role') !== 'treeitem' || !e.currentTarget.contains(target) || !isMenuKey(e)) return
            e.preventDefault()
            e.stopPropagation()
            const rect = target.getBoundingClientRect()
            openAt({ x: rect.left, y: rect.bottom })
        },
        [openAt]
    )

    return (
        <span onContextMenu={onContextMenu} onKeyDown={onKeyDown} className="contents">
            {children}
            <ContextMenuAtPoint open={open} onOpenChange={onOpenChange} anchor={anchor} align="start" className="min-w-44">
                <FileTreeMenuItems node={node} />
            </ContextMenuAtPoint>
        </span>
    )
}
