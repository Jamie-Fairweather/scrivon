'use client'

import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon, FolderIcon } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import {
    Command,
    CommandDialog,
    CommandDialogPopup,
    CommandDialogPrimitive,
    CommandEmpty,
    CommandFooter,
    CommandInput,
    CommandItem,
    CommandList,
    CommandPanel,
} from '@/components/ui/command'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { samePath } from '@/lib/tauri/fs'
import { displayPath } from '@/lib/workspace/display-path'
import { moveTargets, type MoveTarget } from '@/lib/workspace/move-entry'
import type { FileNode } from '@/lib/workspace/types'

type MoveToContextValue = {
    /** Asks which folder in the open one to move `node` to. Resolves to its path, or null when the user cancels. */
    chooseFolder: (node: FileNode) => Promise<string | null>
}

const MoveToContext = createContext<MoveToContextValue | null>(null)

export function useMoveTo(): MoveToContextValue {
    const ctx = useContext(MoveToContext)
    if (!ctx) throw new Error('useMoveTo must be used within MoveToProvider')
    return ctx
}

const targetLabel = (target: unknown) => (target as MoveTarget | null)?.label ?? ''

/** The Move to… folder list: every folder in the open one, searched by typing, picked with Enter or a click. */
export function MoveToProvider({ children }: { children: ReactNode }) {
    const { tree, workspaceRoot } = useWorkspaceSession()
    const pendingRef = useRef<((path: string | null) => void) | null>(null)
    const [open, setOpen] = useState(false)
    const [node, setNode] = useState<FileNode | null>(null)

    // Worked out as it opens; the tree can change while the list is open, and the move checks again anyway.
    const targets = useMemo(() => (node && workspaceRoot ? moveTargets(tree, workspaceRoot, node) : []), [node, tree, workspaceRoot])

    const finish = useCallback((path: string | null) => {
        pendingRef.current?.(path)
        pendingRef.current = null
        setOpen(false)
    }, [])

    const chooseFolder = useCallback((moving: FileNode) => {
        return new Promise<string | null>((resolve) => {
            pendingRef.current?.(null)
            pendingRef.current = resolve
            setNode(moving)
            setOpen(true)
        })
    }, [])

    const value = useMemo(() => ({ chooseFolder }), [chooseFolder])

    return (
        <MoveToContext.Provider value={value}>
            {children}
            <CommandDialog
                open={open}
                onOpenChange={(next) => {
                    if (!next) finish(null)
                }}
            >
                <CommandDialogPopup>
                    <CommandDialogPrimitive.Title className="relative px-5 pt-4 text-sm font-medium wrap-anywhere">
                        Move &quot;{node?.name}&quot; to…
                    </CommandDialogPrimitive.Title>
                    <Command items={targets} itemToStringValue={targetLabel}>
                        <CommandInput aria-label="Folder to move to" dir="auto" placeholder="Search folders…" />
                        <CommandPanel>
                            <CommandEmpty>No folders match.</CommandEmpty>
                            <CommandList>
                                {(target: MoveTarget) => (
                                    <CommandItem key={target.path} disabled={target.current} onClick={() => finish(target.path)} value={target}>
                                        <FolderIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                                        <span dir="auto" className="min-w-0 flex-1 truncate text-left">
                                            {displayPath(target.label)}
                                        </span>
                                        {workspaceRoot && samePath(target.path, workspaceRoot) ? (
                                            <span className="ms-2 shrink-0 text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                                                Top of the folder
                                            </span>
                                        ) : null}
                                        {target.current ? (
                                            <span className="ms-2 shrink-0 text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                                                Current folder
                                            </span>
                                        ) : null}
                                    </CommandItem>
                                )}
                            </CommandList>
                        </CommandPanel>
                        <CommandFooter>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <KbdGroup>
                                        <Kbd>
                                            <ArrowUpIcon />
                                        </Kbd>
                                        <Kbd>
                                            <ArrowDownIcon />
                                        </Kbd>
                                    </KbdGroup>
                                    <span>Navigate</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Kbd>
                                        <CornerDownLeftIcon />
                                    </Kbd>
                                    <span>Move here</span>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Kbd>Esc</Kbd>
                                <span>Cancel</span>
                            </div>
                        </CommandFooter>
                    </Command>
                </CommandDialogPopup>
            </CommandDialog>
        </MoveToContext.Provider>
    )
}
