'use client'

import { ArrowDownIcon, ArrowUpIcon, ClockIcon, CornerDownLeftIcon, FileTextIcon, FolderIcon, NetworkIcon, XIcon } from 'lucide-react'
import { Fragment, useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent } from 'react'
import { parsePaletteQuery } from '@/components/studio/command-palette/parse-palette-query'
import { MAX_HITS, MAX_HITS_PER_FILE, meetsTextQueryMinimum } from '@/components/studio/command-palette/search-content'
import type { PaletteGroup, PaletteItem, PaletteMode } from '@/components/studio/command-palette/types'
import { Badge } from '@/components/ui/badge'
import {
    Command,
    CommandCollection,
    CommandDialog,
    CommandDialogPopup,
    CommandDialogPrimitive,
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
    /** Called after the open or close animation has finished. */
    onOpenChangeComplete?: (open: boolean) => void
    mode: PaletteMode
    onModeChange: (mode: PaletteMode) => void
    query: string
    onQueryChange: (query: string) => void
    groups: PaletteGroup[]
    isSearchingText: boolean
    textCapped: boolean
    /** Files whose extra matches were left out by the per-file limit. */
    textTruncatedFiles: number
    textUnreadableFiles: number
    hasWorkspace: boolean
    onSelectItem: (item: PaletteItem) => void | Promise<void>
}

/** Highlights the hit's own match, by position, rather than the first look-alike in the preview. */
function highlightPreview(preview: string, matchStart: number, matchLength: number) {
    const start = Math.max(0, Math.min(matchStart, preview.length))
    const end = Math.min(preview.length, start + matchLength)
    if (end <= start) return preview

    return (
        <>
            {preview.slice(0, start)}
            {/* Not the accent tint: that is also the highlighted row's background, so the match would vanish there. */}
            <mark className="rounded-sm bg-ring/25 px-0.5 font-semibold text-foreground">{preview.slice(start, end)}</mark>
            {preview.slice(end)}
        </>
    )
}

/** Folder part of a workspace-relative path ('' for a file at the top of the folder). */
function folderOf(relativePath: string): string {
    const cut = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
    return cut > 0 ? relativePath.slice(0, cut) : ''
}

function DocumentIcon({ kind }: { kind: 'markdown' | 'mermaid' }) {
    if (kind === 'mermaid') return <NetworkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    return <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function PaletteItemRow({ item, onSelect }: { item: PaletteItem; onSelect: (item: PaletteItem) => void }) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect])

    if (item.kind === 'action') {
        return (
            <CommandItem disabled={item.disabled} onClick={handleClick} value={item.value}>
                {item.detail ? (
                    <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.detail}</span>
                    </span>
                ) : (
                    <span className="flex-1 truncate">{item.label}</span>
                )}
                {/* Shown in the row (not a tooltip) so keyboard and screen-reader users get it too. */}
                {item.disabled && item.disabledReason ? (
                    <span className="ms-2 shrink-0 text-xs text-muted-foreground">{item.disabledReason}</span>
                ) : null}
                {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
            </CommandItem>
        )
    }

    if (item.kind === 'tab') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <DocumentIcon kind={item.documentKind} />
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.relativePath}</span>
                </span>
                {item.isDirty ? (
                    <>
                        {/* Same dot as the tab bar; an accent dot would vanish on the highlighted row. */}
                        <span aria-hidden className="size-2 shrink-0 rounded-full bg-foreground" />
                        <span className="sr-only">Unsaved changes</span>
                    </>
                ) : null}
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

    const folder = folderOf(item.relativePath)
    // Disabled while a newer search runs: the hit stays in place, but Enter and clicks can't open it.
    return (
        <CommandItem disabled={item.disabled} onClick={handleClick} value={item.value}>
            <DocumentIcon kind={item.documentKind} />
            <span className="min-w-0 flex-1">
                <span className="block truncate">
                    {item.name}
                    {/* The folder tells apart files with the same name, e.g. docs/README.md and api/README.md. */}
                    {folder ? <span className="text-xs text-muted-foreground"> {folder}</span> : null} · {item.line}:{item.column}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                    {highlightPreview(item.preview, item.previewMatchStart, item.length)}
                </span>
            </span>
        </CommandItem>
    )
}

const MODE_PLACEHOLDERS: Record<PaletteMode, string> = {
    all: 'Search files, text, and commands…',
    files: 'Go to file…',
    text: 'Find in workspace…',
}

/** Accessible name of the search box, so it isn't named only by its placeholder. */
const MODE_INPUT_LABELS: Record<PaletteMode, string> = {
    all: 'Search files, text, and commands',
    files: 'Go to file',
    text: 'Find in workspace',
}

/** What the screen-reader status announces: the search progress, then how many results there are. */
function statusMessageFor(groups: PaletteGroup[], isSearchingText: boolean): string {
    const count = groups.reduce((total, group) => total + group.items.length, 0)
    if (count === 0) return '' // The empty message announces itself, searching included.
    if (isSearchingText) return 'Searching file contents…'
    return count === 1 ? '1 result' : `${count} results`
}

/** Label of the filter chip shown while the palette is narrowed to one kind of result. */
const MODE_FILTER_LABELS: Record<PaletteMode, string | null> = {
    all: null,
    files: 'Files',
    text: 'Text',
}

function emptyMessageFor(hasWorkspace: boolean, mode: PaletteMode, query: string, isSearchingText: boolean): string {
    const parsed = parsePaletteQuery(query)
    if (parsed.actionsOnly) return 'No matching commands.'
    if (!hasWorkspace) return 'No results. Open a folder to search files, or type > for commands.'
    // Not "no results" yet: file contents are still being searched.
    if (isSearchingText) return 'Searching file contents…'
    if (mode === 'files') return 'No file names match. Remove the Files filter to search file contents too.'
    if (mode === 'text') {
        if (!meetsTextQueryMinimum(parsed.query, mode)) return 'Type to search file contents.'
        return 'No text matches. Remove the Text filter to search file names too.'
    }
    // Matching commands already show here, so '>' wouldn't find more.
    return 'No results found. Try a shorter query.'
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
    onOpenChangeComplete,
    mode,
    onModeChange,
    query,
    onQueryChange,
    groups,
    isSearchingText,
    textCapped,
    textTruncatedFiles,
    textUnreadableFiles,
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

    const inputRef = useRef<HTMLInputElement>(null)
    const selectOnFocusRef = useRef(true)
    const filterLabel = MODE_FILTER_LABELS[mode]

    useEffect(() => {
        if (!open) selectOnFocusRef.current = true
    }, [open])

    // Select a pre-filled query when the palette opens, so typing replaces it instead of appending.
    const handleInputFocus = useCallback((event: FocusEvent<HTMLInputElement>) => {
        if (!selectOnFocusRef.current) return
        selectOnFocusRef.current = false
        event.currentTarget.select()
    }, [])

    const showAllResults = useCallback(() => {
        onModeChange('all')
        inputRef.current?.focus()
    }, [onModeChange])

    const handleInputKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            // Backspace in an empty box removes the Files/Text filter (held-down repeats don't, so clearing a query can't overshoot).
            if (event.key === 'Backspace' && !event.repeat && mode !== 'all' && event.currentTarget.value === '') {
                event.preventDefault()
                onModeChange('all')
            }
        },
        [mode, onModeChange]
    )

    const emptyMessage = emptyMessageFor(hasWorkspace, mode, query, isSearchingText)
    // Point to the '>' prefix until the user is already in commands.
    const showCommandsHint = !parsePaletteQuery(query).actionsOnly
    const statusMessage = statusMessageFor(groups, isSearchingText)

    const endAddon =
        isSearchingText || filterLabel ? (
            <span className="flex items-center gap-2">
                {/* The status region below announces searching, so the spinner stays silent. */}
                {isSearchingText ? <Spinner aria-hidden className="size-4 text-muted-foreground" /> : null}
                {filterLabel ? (
                    <Badge
                        aria-label={`${filterLabel} only. Show all results`}
                        className="pointer-events-auto px-1.5"
                        onClick={showAllResults}
                        onMouseDown={(event) => event.preventDefault()}
                        render={<button type="button" />}
                        title="Show all results (Backspace)"
                        variant="outline"
                    >
                        {filterLabel}
                        <XIcon aria-hidden className="size-3" />
                    </Badge>
                ) : null}
            </span>
        ) : undefined

    return (
        <CommandDialog onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete} open={open}>
            <CommandDialogPopup>
                <CommandDialogPrimitive.Title className="sr-only">Command palette</CommandDialogPrimitive.Title>
                <div aria-live="polite" className="sr-only" role="status">
                    {statusMessage}
                </div>
                <Command itemToStringValue={paletteItemToStringValue} items={groups} mode="none" onValueChange={onQueryChange} value={query}>
                    <CommandInput
                        aria-label={MODE_INPUT_LABELS[mode]}
                        // Make room for the filter chip so typed text doesn't run under it.
                        className={filterLabel ? '*:data-[slot=autocomplete-input]:pe-24 sm:*:data-[slot=autocomplete-input]:pe-24' : undefined}
                        endAddon={endAddon}
                        onFocus={handleInputFocus}
                        onKeyDown={handleInputKeyDown}
                        placeholder={MODE_PLACEHOLDERS[mode]}
                        ref={inputRef}
                    />
                    <CommandPanel>
                        <CommandEmpty>{emptyMessage}</CommandEmpty>
                        <CommandList>
                            {(group: PaletteGroup, index: number) => (
                                <Fragment key={group.id}>
                                    <CommandGroup items={group.items}>
                                        <CommandGroupLabel>{group.label}</CommandGroupLabel>
                                        <CommandCollection>
                                            {(item: PaletteItem) => <PaletteItemRow key={item.value} item={item} onSelect={handleSelect} />}
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
                            {showCommandsHint ? (
                                <div className="flex items-center gap-2">
                                    <Kbd>&gt;</Kbd>
                                    <span>Commands</span>
                                </div>
                            ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                            {textUnreadableFiles > 0 ? (
                                <span className="text-muted-foreground/80">
                                    {textUnreadableFiles === 1 ? "1 file couldn't be read" : `${textUnreadableFiles} files couldn't be read`}
                                </span>
                            ) : null}
                            {textCapped ? (
                                <span className="text-muted-foreground/80">Showing first {MAX_HITS} matches — refine query</span>
                            ) : textTruncatedFiles > 0 ? (
                                <span className="text-muted-foreground/80">Showing up to {MAX_HITS_PER_FILE} matches per file</span>
                            ) : null}
                            <Kbd>Esc</Kbd>
                            <span>Close</span>
                        </div>
                    </CommandFooter>
                </Command>
            </CommandDialogPopup>
        </CommandDialog>
    )
}
