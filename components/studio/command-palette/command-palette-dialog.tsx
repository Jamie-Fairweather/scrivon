'use client'

import { ArrowDownIcon, ArrowUpIcon, ClockIcon, CornerDownLeftIcon, FileTextIcon, FolderIcon, NetworkIcon } from 'lucide-react'
import { Fragment, useCallback } from 'react'
import type { PaletteGroup, PaletteItem } from '@/components/studio/command-palette/types'
import {
    Command,
    CommandCollection,
    CommandDialog,
    CommandDialogPopup,
    CommandEmpty,
    CommandFooter,
    CommandGroup,
    CommandGroupLabel,
    CommandInput,
    CommandItem,
    CommandList,
    CommandPanel,
    CommandSeparator,
    CommandShortcut,
} from '@/components/ui/command'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'

type CommandPaletteDialogProps = {
    open: boolean
    onOpenChange: (open: boolean) => void
    query: string
    onQueryChange: (query: string) => void
    groups: PaletteGroup[]
    isSearchingText: boolean
    textCapped: boolean
    hasWorkspace: boolean
    onSelectItem: (item: PaletteItem) => void | Promise<void>
}

function highlightPreview(preview: string, query: string) {
    const trimmed = query.trim()
    if (!trimmed) return preview

    const idx = preview.toLowerCase().indexOf(trimmed.toLowerCase())
    if (idx === -1) return preview

    return (
        <>
            {preview.slice(0, idx)}
            <mark className="rounded-sm bg-accent/80 px-0.5 text-accent-foreground">{preview.slice(idx, idx + trimmed.length)}</mark>
            {preview.slice(idx + trimmed.length)}
        </>
    )
}

function DocumentIcon({ kind }: { kind: 'markdown' | 'mermaid' }) {
    if (kind === 'mermaid') return <NetworkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    return <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function PaletteItemRow({ item, query, onSelect }: { item: PaletteItem; query: string; onSelect: (item: PaletteItem) => void }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect])

    if (item.kind === 'action') {
        return (
            <CommandItem disabled={item.disabled} onClick={handleClick} title={item.disabledReason} value={item.value}>
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
            </CommandItem>
        )
    }

    if (item.kind === 'tab') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <DocumentIcon kind={item.name.endsWith('.md') ? 'markdown' : 'mermaid'} />
                <span className="flex-1 truncate">{item.name}</span>
                {item.isDirty ? <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unsaved changes" /> : null}
            </CommandItem>
        )
    }

    if (item.kind === 'file' || item.kind === 'recent') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                {item.kind === 'recent' ? (
                    <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                    <DocumentIcon kind={item.documentKind} />
                )}
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.relativePath}</span>
                </span>
            </CommandItem>
        )
    }

    if (item.kind === 'workspace') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.path}</span>
                </span>
            </CommandItem>
        )
    }

    return (
        <CommandItem onClick={handleClick} value={item.value}>
            <DocumentIcon kind={item.name.endsWith('.md') ? 'markdown' : 'mermaid'} />
            <span className="min-w-0 flex-1">
                <span className="block truncate">
                    {item.name} · {item.line}:{item.column}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{highlightPreview(item.preview, query)}</span>
            </span>
        </CommandItem>
    )
}

function paletteItemToStringValue(itemValue: unknown): string {
    if (!itemValue) return ''
    if (typeof itemValue === 'string') return itemValue
    if (typeof itemValue === 'object' && 'searchText' in itemValue) {
        return String((itemValue as PaletteItem).searchText)
    }
    return ''
}

export function CommandPaletteDialog({
    open,
    onOpenChange,
    query,
    onQueryChange,
    groups,
    isSearchingText,
    textCapped,
    hasWorkspace,
    onSelectItem,
}: CommandPaletteDialogProps) {
    const handleSelect = useCallback(
        async (item: PaletteItem) => {
            await onSelectItem(item)
            onOpenChange(false)
        },
        [onSelectItem, onOpenChange]
    )

    const emptyMessage = hasWorkspace ? 'No results found. Try a shorter query or type > for commands.' : 'Open a folder to search files and text.'

    return (
        <CommandDialog onOpenChange={onOpenChange} open={open}>
            <CommandDialogPopup>
                <Command itemToStringValue={paletteItemToStringValue} items={groups} mode="none" onValueChange={onQueryChange} value={query}>
                    <CommandInput
                        endAddon={isSearchingText ? <Spinner className="size-4 text-muted-foreground" /> : undefined}
                        placeholder="Search files, text, and commands…"
                    />
                    <CommandPanel>
                        <CommandEmpty>{emptyMessage}</CommandEmpty>
                        <CommandList>
                            {(group: PaletteGroup, index: number) => (
                                <Fragment key={group.id}>
                                    <CommandGroup items={group.items}>
                                        <CommandGroupLabel>{group.label}</CommandGroupLabel>
                                        <CommandCollection>
                                            {(item: PaletteItem) => (
                                                <PaletteItemRow key={item.value} item={item} onSelect={handleSelect} query={query} />
                                            )}
                                        </CommandCollection>
                                    </CommandGroup>
                                    {index < groups.length - 1 ? <CommandSeparator /> : null}
                                </Fragment>
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
                                <span>Open</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {textCapped ? <span className="text-muted-foreground/80">More matches exist — refine query</span> : null}
                            <Kbd>Esc</Kbd>
                            <span>Close</span>
                        </div>
                    </CommandFooter>
                </Command>
            </CommandDialogPopup>
        </CommandDialog>
    )
}
