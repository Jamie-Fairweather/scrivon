'use client'

import {
    ArrowDownIcon,
    ArrowUpIcon,
    CaseSensitiveIcon,
    ClockIcon,
    CornerDownLeftIcon,
    FileTextIcon,
    FolderIcon,
    HashIcon,
    NetworkIcon,
    RegexIcon,
    ReplaceAllIcon,
    ReplaceIcon,
    WholeWordIcon,
    XIcon,
    type LucideIcon,
} from 'lucide-react'
import { Fragment, useCallback, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { parsePaletteQuery } from '@/components/studio/command-palette/parse-palette-query'
import { ReplaceAllDialog } from '@/components/studio/command-palette/replace-all-dialog'
import type { ReplaceNotice } from '@/components/studio/command-palette/replace-content'
import type { ReplaceAllState } from '@/components/studio/command-palette/use-palette-replace'
import { DEBOUNCE_MS, MAX_HITS, MAX_HITS_PER_FILE, meetsTextQueryMinimum } from '@/components/studio/command-palette/search-content'
import { folderOf } from '@/components/studio/command-palette/search-files'
import { PLAIN_SEARCH_OPTIONS, type WorkspaceSearchOptions } from '@/components/studio/command-palette/text-matcher'
import type { PaletteGroup, PaletteGroupFile, PaletteItem, PaletteMode, TextPaletteItem } from '@/components/studio/command-palette/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconTooltip } from '@/components/ui/icon-tooltip'
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
import { notifyError } from '@/lib/notify'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import {
    formatWorkspaceSearchOptionKey,
    SEARCH_OPTION_KEYS_ATTRIBUTE,
    WORKSPACE_SEARCH_OPTIONS,
    workspaceSearchOptionAriaKeys,
    workspaceSearchOptionForKey,
    type WorkspaceSearchOption,
} from '@/lib/settings/workspace-search-keys'
import {
    formatWorkspaceReplaceKey,
    REPLACE_KEYS_ATTRIBUTE,
    workspaceReplaceAriaKeys,
    workspaceReplaceKeyForEvent,
} from '@/lib/settings/workspace-replace-keys'
import { cn } from '@/lib/utils'
import { displayPath } from '@/lib/workspace/display-path'

/** Replace in Workspace's box and actions, while the box shows. */
export type PaletteReplaceProps = {
    value: string
    onChange: (value: string) => void
    /** Whether the replacement fills in groups ($1, $<name>, $&), for its hint. */
    useRegex: boolean
    /** A replace is running: the buttons wait. */
    busy: boolean
    /** What the last replace did. */
    notice: ReplaceNotice | null
    dismissNotice: () => void
    replaceMatch: (item: TextPaletteItem) => void | Promise<void>
    replaceFile: (path: string) => void | Promise<void>
    replaceAll: ReplaceAllState
    startReplaceAll: () => void | Promise<void>
    confirmReplaceAll: () => void | Promise<void>
    cancelReplaceAll: () => void
}

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
    /** Shown instead of results when ':', '@' or '?' lists nothing, e.g. 'Type a line number…'. */
    emptyHint?: string | null
    onSelectItem: (item: PaletteItem) => void | Promise<void>
    /** Find in Workspace's saved options. */
    searchOptions?: WorkspaceSearchOptions
    onSearchOptionsChange?: (options: WorkspaceSearchOptions) => void
    /** Whether the options apply now (a Text-mode search): the toggles and their keys only work then. */
    searchOptionsApply?: boolean
    /** Why the query can't be searched (an invalid regular expression). */
    queryError?: string | null
    /** Lines a regex search skipped for being too long. */
    textLongLinesSkipped?: number
    /** Why a regex search stopped early. */
    textStopMessage?: string | null
    /** Set while Replace in Workspace's box shows. */
    replace?: PaletteReplaceProps | null
}

const SEARCH_OPTION_LABELS: Record<WorkspaceSearchOption, string> = {
    matchCase: 'Match Case',
    wholeWord: 'Match Whole Word',
    useRegex: 'Use Regular Expression',
}

const SEARCH_OPTION_ICONS: Record<WorkspaceSearchOption, LucideIcon> = {
    matchCase: CaseSensitiveIcon,
    wholeWord: WholeWordIcon,
    useRegex: RegexIcon,
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

/**
 * The match struck through with what replaces it beside it. Not by colour alone: the old text is struck
 * through and the new underlined, and a screen reader hears 'replaced with' between them.
 */
function replacementPreview(preview: string, matchStart: number, matchLength: number, newText: string) {
    const start = Math.max(0, Math.min(matchStart, preview.length))
    const end = Math.min(preview.length, start + matchLength)
    return (
        <>
            {preview.slice(0, start)}
            <del
                className="rounded-sm bg-destructive/10 px-0.5 text-destructive-foreground line-through decoration-2
                    in-data-highlighted:bg-transparent"
            >
                {preview.slice(start, end)}
            </del>
            <span className="sr-only"> replaced with </span>
            {newText ? (
                <ins
                    className="rounded-sm bg-success/10 px-0.5 font-semibold text-success-foreground underline decoration-1 underline-offset-2
                        in-data-highlighted:bg-transparent"
                >
                    {newText}
                </ins>
            ) : (
                <span className="sr-only">nothing</span>
            )}
            {preview.slice(end)}
        </>
    )
}

/** Keeps a click on a button inside a row from also opening the row, and the keyboard in the search box. */
function stopRowPress(event: MouseEvent) {
    event.stopPropagation()
}

function DocumentIcon({ kind }: { kind: 'markdown' | 'mermaid' }) {
    if (kind === 'mermaid') return <NetworkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    return <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function PaletteItemRow({
    item,
    onSelect,
    onReplace,
    replaceBusy = false,
}: {
    item: PaletteItem
    onSelect: (item: PaletteItem) => void
    /** Set in Replace in Workspace: replaces this match. */
    onReplace?: (item: TextPaletteItem) => void
    replaceBusy?: boolean
}) {
    const handleClick = useCallback(() => onSelect(item), [item, onSelect])

    if (item.kind === 'action') {
        return (
            <CommandItem disabled={item.disabled} onClick={handleClick} value={item.value}>
                {item.detail ? (
                    <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">{item.detail}</span>
                    </span>
                ) : (
                    <span className="flex-1 truncate">{item.label}</span>
                )}
                {/* Shown in the row (not a tooltip) so keyboard and screen-reader users get it too. */}
                {item.disabled && item.disabledReason ? (
                    <span className="ms-2 shrink-0 text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                        {item.disabledReason}
                    </span>
                ) : null}
                {/* An on/off setting, ticked in the menus: picking it switches it. */}
                {item.checked !== undefined ? (
                    <span className="ms-2 shrink-0 text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                        {item.checked ? 'On' : 'Off'}
                    </span>
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
                    <span dir="auto" className="block truncate text-left">
                        {item.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                        {displayPath(item.relativePath)}
                    </span>
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
                    <span dir="auto" className="block truncate text-left">
                        {item.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                        {displayPath(item.relativePath)}
                    </span>
                </span>
            </CommandItem>
        )
    }

    if (item.kind === 'workspace') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate text-left">
                        {item.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                        {displayPath(item.path)}
                    </span>
                </span>
            </CommandItem>
        )
    }

    if (item.kind === 'line') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    <span className="block truncate text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">{item.detail}</span>
                </span>
            </CommandItem>
        )
    }

    if (item.kind === 'heading') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <span className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingInlineStart: item.depth * 12 }}>
                    <HashIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span dir="auto" className="truncate">
                        {item.text}
                    </span>
                    {/* The indent shows the level only to the eye. */}
                    <span className="sr-only">, level {item.level}</span>
                </span>
                <span className="ms-2 shrink-0 text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">Line {item.line}</span>
            </CommandItem>
        )
    }

    if (item.kind === 'diagram-part') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <NetworkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span dir="auto" className="truncate">
                        {item.type}: {item.name}
                    </span>
                </span>
                <span className="ms-2 shrink-0 text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">Line {item.line}</span>
            </CommandItem>
        )
    }

    if (item.kind === 'prefix') {
        return (
            <CommandItem onClick={handleClick} value={item.value}>
                <Kbd>{item.prefix}</Kbd>
                <span className="flex-1 truncate">{item.label}</span>
            </CommandItem>
        )
    }

    // Disabled while a newer search runs: the hit stays in place, but Enter and clicks can't open it.
    if (item.newText !== undefined && onReplace) {
        const isMac = isMacPlatform()
        return (
            <CommandItem disabled={item.disabled} onClick={handleClick} value={item.value}>
                {/* The file is named by the group's heading, so the row leads with the line. */}
                <span className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums in-data-highlighted:text-accent-foreground">
                    {item.line}:{item.column}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">
                    {replacementPreview(item.preview, item.previewMatchStart, item.previewMatchLength, item.newText)}
                </span>
                <IconTooltip label={`Replace (${formatWorkspaceReplaceKey('replaceOne', isMac)})`}>
                    <Button
                        aria-keyshortcuts={workspaceReplaceAriaKeys('replaceOne', isMac)}
                        aria-label={`Replace line ${item.line}, column ${item.column} in ${item.name}`}
                        className="text-muted-foreground in-data-highlighted:text-accent-foreground"
                        disabled={item.disabled || replaceBusy}
                        onClick={(event) => {
                            stopRowPress(event)
                            onReplace(item)
                        }}
                        onMouseUp={stopRowPress}
                        size="icon-xs"
                        tabIndex={-1}
                        type="button"
                        variant="ghost"
                    >
                        <ReplaceIcon aria-hidden />
                    </Button>
                </IconTooltip>
            </CommandItem>
        )
    }

    const folder = folderOf(item.relativePath)
    return (
        <CommandItem disabled={item.disabled} onClick={handleClick} value={item.value}>
            <DocumentIcon kind={item.documentKind} />
            <span className="min-w-0 flex-1">
                <span className="block truncate">
                    {/* Set apart, so a right-to-left name can't pull the folder or the line number out of order. */}
                    <span dir="auto">{item.name}</span>
                    {/* The folder tells apart files with the same name, e.g. docs/README.md and api/README.md. */}
                    {folder ? (
                        <span className="text-xs text-muted-foreground in-data-highlighted:text-accent-foreground"> {displayPath(folder)}</span>
                    ) : null}{' '}
                    · {item.line}:{item.column}
                </span>
                <span className="block truncate text-xs text-muted-foreground in-data-highlighted:text-accent-foreground">
                    {highlightPreview(item.preview, item.previewMatchStart, item.previewMatchLength)}
                </span>
            </span>
        </CommandItem>
    )
}

/**
 * A file's heading in Replace in Workspace: its name, folder and match count (which also name its group, so a
 * screen reader hears them on reaching its first match), and a button to replace in it. The button sits beside
 * the label, not in it: the label is hidden from screen readers, as it only names the group.
 */
function ReplaceFileHeading({ file, busy, onReplaceFile }: { file: PaletteGroupFile; busy: boolean; onReplaceFile: (path: string) => void }) {
    const count = file.capped ? `${file.matchCount}+` : String(file.matchCount)
    return (
        <div className="flex min-w-0 items-center gap-2 pe-2">
            <CommandGroupLabel className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                    <span className="text-foreground" dir="auto">
                        {file.name}
                    </span>
                    {file.folder ? <span className="font-normal"> {displayPath(file.folder)}</span> : null}
                </span>
                <Badge
                    aria-label={
                        file.capped ? `, ${count} matches, more than are listed` : `, ${count} ${file.matchCount === 1 ? 'match' : 'matches'}`
                    }
                    className="shrink-0 tabular-nums"
                    variant="outline"
                >
                    {count}
                </Badge>
            </CommandGroupLabel>
            <IconTooltip label={`Replace in ${file.name}`}>
                <Button
                    aria-label={`Replace in ${file.name}`}
                    className="text-muted-foreground"
                    disabled={file.disabled || busy}
                    onClick={() => onReplaceFile(file.path)}
                    // Keeps the keyboard in the search box, so typing and Enter still work.
                    onMouseDown={(event) => event.preventDefault()}
                    size="icon-xs"
                    tabIndex={-1}
                    type="button"
                    variant="ghost"
                >
                    <ReplaceAllIcon aria-hidden />
                </Button>
            </IconTooltip>
        </div>
    )
}

const MODE_PLACEHOLDERS: Record<PaletteMode, string> = {
    all: 'Search files and text · > commands · : line · @ heading · ? help',
    files: 'Go to file…',
    text: 'Find in workspace…',
}

/** Accessible name of the search box, so it isn't named only by its placeholder. */
const MODE_INPUT_LABELS: Record<PaletteMode, string> = {
    all: 'Search files, text, and commands',
    files: 'Go to file',
    text: 'Find in workspace',
}

type StatusNotes = {
    /** An invalid pattern's message, once typing has paused. */
    queryError: string | null
    /** Why a regex search stopped early. */
    stopMessage: string | null
    /** An option switched by its key, such as 'Match Case on'. */
    optionChange: string | null
    /** What the last replace did, in Replace in Workspace. */
    replaceNotice?: string | null
    /** Replace in Workspace's results are matches grouped by file, counted as such. */
    replacing?: boolean
}

/**
 * What the screen-reader status announces: the search progress, then how many results there are,
 * after an option switched by key or a stopped search. An invalid pattern's message replaces it all.
 */
function statusMessageFor(groups: PaletteGroup[], isSearchingText: boolean, notes: StatusNotes): string {
    if (notes.queryError) return notes.queryError
    const count = groups.reduce((total, group) => total + group.items.length, 0)
    // With no results, the empty message announces itself, searching included.
    let results = ''
    if (count > 0 && isSearchingText) results = 'Searching file contents…'
    else if (count > 0 && notes.replacing) {
        const files = groups.length
        const capped = groups.some((group) => group.file?.capped)
        results = `${count}${capped ? '+' : ''} ${count === 1 ? 'match' : 'matches'} in ${files === 1 ? '1 file' : `${files} files`}`
    } else if (count > 0) results = count === 1 ? '1 result' : `${count} results`
    else if (notes.optionChange && !isSearchingText) results = 'No results'
    const lead = [notes.replaceNotice, notes.optionChange && `${notes.optionChange}.`, notes.stopMessage].filter(Boolean).join(' ')
    return [lead, results].filter(Boolean).join(' ')
}

/** Label of the filter chip shown while the palette is narrowed to one kind of result. */
const MODE_FILTER_LABELS: Record<PaletteMode, string | null> = {
    all: null,
    files: 'Files',
    text: 'Text',
}

function emptyMessageFor(hasWorkspace: boolean, mode: PaletteMode, query: string, isSearchingText: boolean): string {
    const parsed = parsePaletteQuery(query, mode)
    if (parsed.kind === 'commands') return 'No matching commands.'
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

/**
 * Whether a key was pressed in the palette itself. The Replace All dialog is drawn in its own layer (a portal) but
 * is the palette's child, so its keys pass through the palette's handlers too; they must not act behind it.
 */
function isInPopup(event: KeyboardEvent<HTMLElement>): boolean {
    return event.target instanceof Node && event.currentTarget.contains(event.target)
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
    emptyHint,
    onSelectItem,
    searchOptions = PLAIN_SEARCH_OPTIONS,
    onSearchOptionsChange,
    searchOptionsApply = false,
    queryError = null,
    textLongLinesSkipped = 0,
    textStopMessage = null,
    replace = null,
}: CommandPaletteDialogProps) {
    // Set once an item is picked, until the palette opens again: a second Enter or click while it closes is ignored.
    const busyRef = useRef(false)
    useEffect(() => {
        if (open) busyRef.current = false
    }, [open])

    // The palette closes first, so a slow item (a big folder, the large-file question) doesn't leave it
    // sitting open. What the item does next (opening a file, a dialog) takes focus as it needs to.
    const handleSelect = useCallback(
        (item: PaletteItem) => {
            if (busyRef.current) return
            // A prefix from the '?' list is typed into the box, and the palette stays open for what follows it.
            if (item.kind === 'prefix') {
                onQueryChange(item.prefix)
                inputRef.current?.focus()
                return
            }
            busyRef.current = true
            onOpenChange(false)
            void Promise.resolve()
                .then(() => onSelectItem(item))
                .catch((err: unknown) => notifyError("Couldn't run that", err))
        },
        [onSelectItem, onOpenChange, onQueryChange]
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

    const isMac = isMacPlatform()
    // An option switched by its key is announced, with the results it brings, until the query changes.
    const [optionChange, setOptionChange] = useState<{ message: string; query: string } | null>(null)

    const toggleSearchOption = useCallback(
        (option: WorkspaceSearchOption, byKey: boolean) => {
            const on = !searchOptions[option]
            onSearchOptionsChange?.({ ...searchOptions, [option]: on })
            setOptionChange(byKey ? { message: `${SEARCH_OPTION_LABELS[option]} ${on ? 'on' : 'off'}`, query } : null)
        },
        [onSearchOptionsChange, searchOptions, query]
    )

    // On the popup, so the keys work from the search box and from a toggle alike.
    const handlePopupKeyDown = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            // Not from the Replace All dialog, which is drawn elsewhere but whose keys still pass through here.
            if (!searchOptionsApply || !isInPopup(event)) return
            const option = workspaceSearchOptionForKey(event.nativeEvent, isMac)
            if (!option) return
            event.preventDefault()
            toggleSearchOption(option, true)
        },
        [searchOptionsApply, isMac, toggleSearchOption]
    )

    // The result the arrow keys are on, for Ctrl+Shift+1.
    const highlightedRef = useRef<PaletteItem | undefined>(undefined)
    const handleItemHighlighted = useCallback((item: unknown) => {
        highlightedRef.current = item as PaletteItem | undefined
    }, [])

    // Before the search box sees the key: Ctrl+Alt+Enter must not also open the highlighted match, as Enter does.
    // Stopped here, so no app shortcut on the same keys runs either.
    const handlePopupKeyDownCapture = useCallback(
        (event: KeyboardEvent<HTMLDivElement>) => {
            if (!replace) return
            const action = workspaceReplaceKeyForEvent(event.nativeEvent, isMac)
            if (!action) return
            event.preventDefault()
            event.stopPropagation()
            // Pressed in the Replace All dialog: nothing is replaced behind it, and it already runs Replace All.
            if (!isInPopup(event)) return
            if (action === 'replaceAll') {
                void replace.startReplaceAll()
                return
            }
            const item = highlightedRef.current
            if (item?.kind === 'text' && !item.disabled && !replace.busy) void replace.replaceMatch(item)
        },
        [replace, isMac]
    )

    // The Replace box passes the arrow keys and Enter on to the search box, which moves through the results (and
    // opens one) as it always does. Its highlighted row is mirrored here, for screen readers.
    const [replaceActiveDescendant, setReplaceActiveDescendant] = useState<string | undefined>(undefined)
    const handleReplaceKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
        if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Enter'].includes(event.key)) return
        const search = inputRef.current
        if (!search || event.nativeEvent.isComposing) return
        event.preventDefault()
        const { key, code, shiftKey, ctrlKey, altKey, metaKey } = event
        search.dispatchEvent(
            new globalThis.KeyboardEvent('keydown', { key, code, shiftKey, ctrlKey, altKey, metaKey, bubbles: true, cancelable: true })
        )
    }, [])
    // While the Replace box has the keyboard, it follows the search box's highlighted row.
    const activeDescendantObserver = useRef<MutationObserver | null>(null)
    const handleReplaceFocus = useCallback(() => {
        const search = inputRef.current
        if (!search) return
        const sync = () => setReplaceActiveDescendant(search.getAttribute('aria-activedescendant') ?? undefined)
        sync()
        activeDescendantObserver.current?.disconnect()
        if (typeof MutationObserver === 'undefined') return
        activeDescendantObserver.current = new MutationObserver(sync)
        activeDescendantObserver.current.observe(search, { attributes: true, attributeFilter: ['aria-activedescendant'] })
    }, [])
    const handleReplaceBlur = useCallback(() => {
        activeDescendantObserver.current?.disconnect()
        activeDescendantObserver.current = null
    }, [])
    useEffect(() => () => activeDescendantObserver.current?.disconnect(), [])

    // An invalid pattern is announced once typing pauses, not on every key.
    const [announcedError, setAnnouncedError] = useState<string | null>(null)
    // Forgotten once the pattern is valid again, so the same error coming back also waits for the pause.
    if (!queryError && announcedError !== null) setAnnouncedError(null)
    useEffect(() => {
        if (!queryError) return
        const timer = window.setTimeout(() => setAnnouncedError(queryError), DEBOUNCE_MS)
        return () => window.clearTimeout(timer)
    }, [queryError])
    const queryErrorId = useId()

    const emptyMessage = emptyHint ?? emptyMessageFor(hasWorkspace, mode, query, isSearchingText)
    // Point to the '>' prefix while the user is searching, not once a prefix is typed. Replace's keys take its place.
    const showCommandsHint = parsePaletteQuery(query, mode).kind === 'search' && !replace
    const statusMessage = statusMessageFor(groups, isSearchingText, {
        queryError: queryError && announcedError === queryError ? queryError : null,
        stopMessage: textStopMessage,
        optionChange: optionChange && optionChange.query === query && searchOptionsApply ? optionChange.message : null,
        replaceNotice: replace?.notice?.message ?? null,
        replacing: replace !== null,
    })
    const hasReplaceableResults = replace !== null && groups.some((group) => group.file && !group.file.disabled)
    const replaceId = useId()

    // One note about the search at a time, the most important first.
    let searchNote: string | null = null
    if (textStopMessage) searchNote = textStopMessage
    else if (textCapped) searchNote = `Showing first ${MAX_HITS} matches — refine query`
    else if (textLongLinesSkipped > 0) searchNote = textLongLinesSkipped === 1 ? '1 long line skipped' : `${textLongLinesSkipped} long lines skipped`
    else if (textTruncatedFiles > 0) searchNote = `Showing up to ${MAX_HITS_PER_FILE} matches per file`

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
                        // With the Replace box, Tab goes straight to it; Backspace in the empty search box still does this.
                        tabIndex={replace ? -1 : undefined}
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
            <CommandDialogPopup
                onKeyDown={handlePopupKeyDown}
                onKeyDownCapture={handlePopupKeyDownCapture}
                {...(searchOptionsApply ? { [SEARCH_OPTION_KEYS_ATTRIBUTE]: '' } : {})}
                {...(replace ? { [REPLACE_KEYS_ATTRIBUTE]: '' } : {})}
            >
                <CommandDialogPrimitive.Title className="sr-only">
                    {replace ? 'Replace in workspace' : 'Command palette'}
                </CommandDialogPrimitive.Title>
                <div aria-live="polite" className="sr-only" role="status">
                    {statusMessage}
                </div>
                <Command
                    itemToStringValue={paletteItemToStringValue}
                    items={groups}
                    mode="none"
                    onItemHighlighted={handleItemHighlighted}
                    onValueChange={onQueryChange}
                    value={query}
                >
                    <CommandInput
                        aria-describedby={queryError ? queryErrorId : undefined}
                        aria-invalid={queryError ? true : undefined}
                        aria-label={MODE_INPUT_LABELS[mode]}
                        // Make room for the filter chip so typed text doesn't run under it.
                        className={cn(
                            filterLabel && '*:data-[slot=autocomplete-input]:pe-24 sm:*:data-[slot=autocomplete-input]:pe-24',
                            // A Hebrew or Arabic query turns the box right to left, which swaps its start and end padding, but the
                            // search icon stays on the left and the chip on the right. Keep the padding beside each of them.
                            `*:data-[slot=autocomplete-input]:rtl:pe-[calc(--spacing(8.5)-1px)]
                            sm:*:data-[slot=autocomplete-input]:rtl:pe-[calc(--spacing(8)-1px)]`,
                            filterLabel && '*:data-[slot=autocomplete-input]:rtl:ps-24 sm:*:data-[slot=autocomplete-input]:rtl:ps-24'
                        )}
                        dir="auto"
                        endAddon={endAddon}
                        onFocus={handleInputFocus}
                        onKeyDown={handleInputKeyDown}
                        placeholder={MODE_PLACEHOLDERS[mode]}
                        ref={inputRef}
                    />
                    {replace ? (
                        <div className="-mt-1 px-2.5 pb-1.5">
                            <label
                                className="flex items-center gap-2 rounded-lg px-[calc(--spacing(3)-1px)] has-focus-visible:ring-0"
                                htmlFor={replaceId}
                            >
                                <ReplaceIcon aria-hidden className="size-4 shrink-0 opacity-80" />
                                <span className="sr-only">Replace with</span>
                                <input
                                    aria-activedescendant={replaceActiveDescendant}
                                    aria-describedby={`${replaceId}-hint`}
                                    autoComplete="off"
                                    className="h-8.5 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:h-8
                                        sm:text-sm"
                                    dir="auto"
                                    id={replaceId}
                                    onBlur={handleReplaceBlur}
                                    onFocus={handleReplaceFocus}
                                    onChange={(event) => replace.onChange(event.currentTarget.value)}
                                    onKeyDown={handleReplaceKeyDown}
                                    placeholder="Replace with…"
                                    spellCheck={false}
                                    type="text"
                                    value={replace.value}
                                />
                            </label>
                            <span className="sr-only" id={`${replaceId}-hint`}>
                                {replace.useRegex ? 'Use $1 or $<name> for a group and $& for the whole match.' : 'Replaced as typed.'}{' '}
                                {`${formatWorkspaceReplaceKey('replaceOne', isMac)} replaces the selected match, ${formatWorkspaceReplaceKey('replaceAll', isMac)} replaces all.`}
                            </span>
                        </div>
                    ) : null}
                    {searchOptionsApply ? (
                        <div aria-label="Search options" className="-mt-1 flex items-center gap-1 px-4 pb-1.5" role="group">
                            {WORKSPACE_SEARCH_OPTIONS.map((option) => {
                                const Icon = SEARCH_OPTION_ICONS[option]
                                const label = SEARCH_OPTION_LABELS[option]
                                return (
                                    <IconTooltip key={option} label={`${label} (${formatWorkspaceSearchOptionKey(option, isMac)})`}>
                                        <Button
                                            aria-keyshortcuts={workspaceSearchOptionAriaKeys(option, isMac)}
                                            aria-label={label}
                                            aria-pressed={searchOptions[option]}
                                            // On: filled and outlined, so it shows without relying on colour.
                                            className="text-muted-foreground aria-pressed:border-ring aria-pressed:bg-ring/20
                                                aria-pressed:text-foreground"
                                            onClick={() => toggleSearchOption(option, false)}
                                            // Keeps the keyboard in the search box, so typing and Enter still work.
                                            onMouseDown={(event) => event.preventDefault()}
                                            size="icon-xs"
                                            type="button"
                                            variant="ghost"
                                        >
                                            <Icon aria-hidden />
                                        </Button>
                                    </IconTooltip>
                                )
                            })}
                            {replace ? (
                                <IconTooltip label={`Replace All (${formatWorkspaceReplaceKey('replaceAll', isMac)})`}>
                                    <Button
                                        aria-keyshortcuts={workspaceReplaceAriaKeys('replaceAll', isMac)}
                                        className="ms-auto"
                                        disabled={!hasReplaceableResults || replace.busy || replace.replaceAll.phase !== 'idle'}
                                        onClick={() => void replace.startReplaceAll()}
                                        onMouseDown={(event) => event.preventDefault()}
                                        size="xs"
                                        type="button"
                                        variant="outline"
                                    >
                                        <ReplaceAllIcon aria-hidden />
                                        Replace All
                                    </Button>
                                </IconTooltip>
                            ) : null}
                        </div>
                    ) : null}
                    {replace?.notice ? (
                        // Announced through the status above; shown here until the next replace or query.
                        <div className="mx-4 mb-1.5 flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-xs" data-slot="replace-notice">
                            <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground">{replace.notice.message}</p>
                                {replace.notice.details.map((detail) => (
                                    <p className="mt-0.5 text-muted-foreground" key={detail}>
                                        {detail}
                                    </p>
                                ))}
                            </div>
                            <Button
                                aria-label="Dismiss"
                                className="-me-1 -mt-0.5 text-muted-foreground"
                                onClick={replace.dismissNotice}
                                onMouseDown={(event) => event.preventDefault()}
                                size="icon-xs"
                                type="button"
                                variant="ghost"
                            >
                                <XIcon aria-hidden />
                            </Button>
                        </div>
                    ) : null}
                    <CommandPanel>
                        {queryError ? (
                            <p className="px-4 py-6 text-center text-base text-destructive-foreground sm:text-sm" id={queryErrorId}>
                                {queryError}
                            </p>
                        ) : null}
                        {/* The empty message announces itself, so an invalid pattern's goes through the status, after a pause. */}
                        <CommandEmpty>{queryError ? null : emptyMessage}</CommandEmpty>
                        <CommandList>
                            {(group: PaletteGroup, index: number) => (
                                <Fragment key={group.id}>
                                    <CommandGroup items={group.items}>
                                        {group.file && replace ? (
                                            <ReplaceFileHeading
                                                busy={replace.busy}
                                                file={group.file}
                                                onReplaceFile={(path) => void replace.replaceFile(path)}
                                            />
                                        ) : (
                                            <CommandGroupLabel>{group.label}</CommandGroupLabel>
                                        )}
                                        <CommandCollection>
                                            {(item: PaletteItem) => (
                                                <PaletteItemRow
                                                    item={item}
                                                    key={item.value}
                                                    onReplace={replace ? (match) => void replace.replaceMatch(match) : undefined}
                                                    onSelect={handleSelect}
                                                    replaceBusy={replace?.busy}
                                                />
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
                            {showCommandsHint ? (
                                <div className="flex items-center gap-2">
                                    <Kbd>&gt;</Kbd>
                                    <span>Commands</span>
                                </div>
                            ) : null}
                            {replace ? (
                                <div className="flex items-center gap-2">
                                    <Kbd>{formatWorkspaceReplaceKey('replaceOne', isMac)}</Kbd>
                                    <span>Replace</span>
                                </div>
                            ) : null}
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                            {textUnreadableFiles > 0 ? (
                                <span className="text-muted-foreground">
                                    {textUnreadableFiles === 1 ? "1 file couldn't be read" : `${textUnreadableFiles} files couldn't be read`}
                                </span>
                            ) : null}
                            {searchNote ? (
                                <span className="min-w-0 text-right text-muted-foreground" data-slot="search-note">
                                    {searchNote}
                                </span>
                            ) : null}
                            <Kbd>Esc</Kbd>
                            <span>Close</span>
                        </div>
                    </CommandFooter>
                </Command>
                {replace ? (
                    <ReplaceAllDialog
                        onCancel={replace.cancelReplaceAll}
                        onConfirm={() => void replace.confirmReplaceAll()}
                        replacement={replace.value}
                        state={replace.replaceAll}
                    />
                ) : null}
            </CommandDialogPopup>
        </CommandDialog>
    )
}
