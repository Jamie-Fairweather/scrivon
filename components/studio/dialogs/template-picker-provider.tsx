'use client'

import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon, FileTextIcon, NetworkIcon } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
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
} from '@/components/ui/command'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { errorMessage } from '@/lib/notify'
import { BUILT_IN_TEMPLATES } from '@/lib/templates/built-in-templates'
import { listWorkspaceTemplates, readWorkspaceTemplate, TEMPLATES_FOLDER_LABEL, type WorkspaceTemplate } from '@/lib/templates/workspace-templates'
import { documentKind, type DocumentKind } from '@/lib/workspace/file-types'

/** The template the user picked, with its text, ready to fill in. */
export type ChosenTemplate = {
    title: string
    /** The name a new file from it starts with. Its extension says what it makes. */
    fileName: string
    kind: DocumentKind
    /** The template's text, placeholders and all. */
    text: string
}

type TemplatePickerContextValue = {
    /** Asks which template to start a new file from. Resolves to it, with its text, or null when the user cancels. */
    chooseTemplate: () => Promise<ChosenTemplate | null>
}

const TemplatePickerContext = createContext<TemplatePickerContextValue | null>(null)

export function useTemplatePicker(): TemplatePickerContextValue {
    const ctx = useContext(TemplatePickerContext)
    if (!ctx) throw new Error('useTemplatePicker must be used within TemplatePickerProvider')
    return ctx
}

/** One row in the picker. */
type TemplateOption = {
    value: string
    title: string
    /** The second line: what a built-in template holds, or a workspace template's file name. */
    detail: string
    kind: DocumentKind
} & ({ origin: 'built-in'; fileName: string; text: string } | { origin: 'workspace'; template: WorkspaceTemplate })

type TemplateGroup = { value: string; label: string; items: TemplateOption[] }

/** The open folder's templates, while they are being listed and once they are. */
type WorkspaceListing =
    { status: 'loading' } | { status: 'listed'; templates: WorkspaceTemplate[]; folderFound: boolean } | { status: 'failed'; message: string }

const KIND_LABEL: Record<DocumentKind, string> = { markdown: 'Document', mermaid: 'Diagram' }

const BUILT_IN_OPTIONS: TemplateOption[] = BUILT_IN_TEMPLATES.map((template) => ({
    value: `built-in:${template.id}`,
    origin: 'built-in',
    title: template.title,
    detail: template.description,
    kind: documentKind(template.fileName) ?? 'markdown',
    fileName: template.fileName,
    text: template.source,
}))

function workspaceOption(template: WorkspaceTemplate): TemplateOption {
    return {
        value: `workspace:${template.path}`,
        origin: 'workspace',
        title: template.title,
        detail: template.fileName,
        kind: template.kind,
        template,
    }
}

/** True when every word typed is in the template's title, second line or kind, ignoring letter case. */
function matchesQuery(option: TemplateOption, query: string): boolean {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const text = `${option.title} ${option.detail} ${KIND_LABEL[option.kind]}`.toLowerCase()
    return words.every((word) => text.includes(word))
}

const optionTitle = (option: unknown) => (option as TemplateOption | null)?.title ?? ''

/**
 * Menus, the menu bar and dialogs (the palette among them). A command chosen in one of them runs as it closes, so the
 * picker can't give focus back there: it goes back to where focus was before.
 */
const PASSING_FOCUS = '[data-slot="menu-popup"], [role="menubar"], [data-slot$="dialog-popup"]'

function isPassingFocus(el: Element): boolean {
    return el.closest(PASSING_FOCUS) !== null
}

/** True when `el` can take focus now: still on the page, drawn, and not in a hidden (inert) pane. */
function canTakeFocus(el: HTMLElement | null): el is HTMLElement {
    if (!el?.isConnected || el.closest('[inert]')) return false
    return typeof el.checkVisibility !== 'function' || el.checkVisibility({ visibilityProperty: true })
}

/** How many folder templates are waiting to be shown, as the picker says it. */
function heldBackMessage(count: number): string {
    return `${count === 1 ? '1 template' : `${count} templates`} from this folder will show when you next type.`
}

function KindIcon({ kind }: { kind: DocumentKind }) {
    const Icon = kind === 'mermaid' ? NetworkIcon : FileTextIcon
    return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground in-data-highlighted:text-accent-foreground" />
}

/**
 * New from Template's list: the open folder's own templates (in `.scrivon/templates`) above the built-in ones,
 * searched by typing, picked with Enter or a click. Built-in templates can be picked while the folder's are listed.
 * A folder template is read when picked; if it can't be used, the list says why and stays open.
 */
export function TemplatePickerProvider({ children }: { children: ReactNode }) {
    const { workspaceRoot } = useWorkspaceSession()
    const coordinator = useWorkspaceCoordinator()
    const pendingRef = useRef<((template: ChosenTemplate | null) => void) | null>(null)
    // Counts each opening and each pick, so a listing or read that finishes late is dropped.
    const openingRef = useRef(0)
    const pickRef = useRef(0)
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const [listing, setListing] = useState<WorkspaceListing>({ status: 'loading' })
    const [pickError, setPickError] = useState<string | null>(null)
    // Where the keyboard was when the picker opened, and whether a template was picked.
    const returnFocusRef = useRef<HTMLElement | null>(null)
    const pickedRef = useRef(false)
    // Where focus last rested outside a menu, the menu bar or a dialog, for when the picker is opened from one of them.
    const restingFocusRef = useRef<HTMLElement | null>(null)
    // The folder's templates come in above the built-ins, and Base UI keeps the highlight on the same row number. So once
    // the user has moved the highlight with the keys or typed, they are held back until the search next changes (which
    // moves the highlight to the first match anyway), rather than slipping a different template under the highlight.
    const [revealed, setRevealed] = useState(false)
    const highlightedRef = useRef<TemplateOption | undefined>(undefined)
    const movedHighlightRef = useRef(false)
    const queryRef = useRef('')

    useEffect(() => {
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target
            if (target instanceof HTMLElement && target !== document.body && !isPassingFocus(target)) restingFocusRef.current = target
        }
        document.addEventListener('focusin', onFocusIn)
        return () => document.removeEventListener('focusin', onFocusIn)
    }, [])

    const finish = useCallback((template: ChosenTemplate | null) => {
        openingRef.current += 1
        pickRef.current += 1
        pickedRef.current = template !== null
        pendingRef.current?.(template)
        pendingRef.current = null
        setOpen(false)
    }, [])

    // Cancelled, focus goes back where it was. Picked, the name prompt opens next and takes it, so it is left alone.
    const finalFocus = useCallback(() => {
        if (pickedRef.current) return false
        const previous = returnFocusRef.current
        return canTakeFocus(previous) ? previous : true
    }, [])

    const chooseTemplate = useCallback(() => {
        return new Promise<ChosenTemplate | null>((resolve) => {
            pendingRef.current?.(null)
            pendingRef.current = resolve
            const active = document.activeElement
            returnFocusRef.current =
                active instanceof HTMLElement && active !== document.body && !isPassingFocus(active) ? active : restingFocusRef.current
            pickedRef.current = false
            const opening = ++openingRef.current
            pickRef.current += 1
            highlightedRef.current = undefined
            movedHighlightRef.current = false
            queryRef.current = ''
            setQuery('')
            setPickError(null)
            setRevealed(false)
            setOpen(true)
            if (!workspaceRoot) {
                setListing({ status: 'listed', templates: [], folderFound: true })
                return
            }
            setListing({ status: 'loading' })
            // Listed afresh each time, so templates added or changed since show up.
            listWorkspaceTemplates(workspaceRoot).then(
                ({ templates, folderFound }) => {
                    if (openingRef.current !== opening) return
                    const userChoseHighlight = movedHighlightRef.current || queryRef.current !== ''
                    setRevealed(templates.length === 0 || !userChoseHighlight || highlightedRef.current === undefined)
                    setListing({ status: 'listed', templates, folderFound })
                },
                (err: unknown) => {
                    console.warn("Couldn't list the folder's templates", err)
                    if (openingRef.current === opening) {
                        setListing({ status: 'failed', message: `Couldn't list this folder's templates. ${errorMessage(err, '')}`.trim() })
                    }
                }
            )
        })
    }, [workspaceRoot])

    const pick = useCallback(
        async (option: TemplateOption) => {
            const attempt = ++pickRef.current
            setPickError(null)
            if (option.origin === 'built-in') {
                finish({ title: option.title, fileName: option.fileName, kind: option.kind, text: option.text })
                return
            }
            const { template } = option
            try {
                // A template open with edits that aren't saved yet is used as the user sees it, as Duplicate does.
                const text = await readWorkspaceTemplate(template, coordinator.getUnsavedContent.current(template.path)?.content)
                if (pickRef.current === attempt) finish({ title: template.title, fileName: template.fileName, kind: template.kind, text })
            } catch (err) {
                if (pickRef.current === attempt) setPickError(errorMessage(err))
            }
        },
        [coordinator, finish]
    )

    const groups = useMemo(() => {
        const workspaceItems = listing.status === 'listed' && revealed ? listing.templates.map(workspaceOption) : []
        const all: TemplateGroup[] = [
            { value: 'workspace', label: 'This folder', items: workspaceItems },
            { value: 'built-in', label: 'Built-in', items: BUILT_IN_OPTIONS },
        ]
        return all
            .map((group) => ({ ...group, items: group.items.filter((item) => matchesQuery(item, query)) }))
            .filter((group) => group.items.length > 0)
    }, [listing, query, revealed])

    const count = groups.reduce((total, group) => total + group.items.length, 0)
    const heldBack = listing.status === 'listed' && !revealed ? listing.templates.length : 0
    const countMessage = count === 0 ? '' : count === 1 ? '1 template' : `${count} templates`
    // The empty message announces itself.
    const statusMessage =
        listing.status === 'loading' ? 'Loading templates…' : heldBack > 0 ? `${countMessage}. ${heldBackMessage(heldBack)}` : countMessage

    const value = useMemo(() => ({ chooseTemplate }), [chooseTemplate])

    return (
        <TemplatePickerContext.Provider value={value}>
            {children}
            <CommandDialog
                open={open}
                onOpenChange={(next) => {
                    if (!next) finish(null)
                }}
            >
                <CommandDialogPopup finalFocus={finalFocus}>
                    <CommandDialogPrimitive.Title className="relative px-5 pt-4 text-sm font-medium">New from template</CommandDialogPrimitive.Title>
                    <div aria-live="polite" className="sr-only" role="status">
                        {statusMessage}
                    </div>
                    <Command
                        items={groups}
                        itemToStringValue={optionTitle}
                        mode="none"
                        onItemHighlighted={(option, details) => {
                            highlightedRef.current = option as TemplateOption | undefined
                            if (details.reason === 'keyboard') movedHighlightRef.current = true
                        }}
                        onValueChange={(next, details) => {
                            // Picking a row leaves what was typed, in case the template can't be used and the user picks again.
                            if (details.reason === 'item-press') return
                            queryRef.current = next
                            setQuery(next)
                            setRevealed(true)
                        }}
                        value={query}
                    >
                        <CommandInput aria-label="Template to start from" dir="auto" placeholder="Search templates…" />
                        <CommandPanel>
                            <div className="flex flex-col gap-1 px-4 not-empty:pt-3 empty:hidden">
                                {pickError ? (
                                    <p className="text-xs wrap-anywhere text-destructive-foreground" role="alert">
                                        {pickError}
                                    </p>
                                ) : null}
                                {/* The status line at the top announces it. */}
                                {listing.status === 'loading' ? (
                                    <p aria-hidden className="text-xs text-muted-foreground">
                                        Loading templates…
                                    </p>
                                ) : null}
                                {heldBack > 0 ? (
                                    <p aria-hidden className="text-xs text-muted-foreground">
                                        {heldBackMessage(heldBack)}
                                    </p>
                                ) : null}
                                {listing.status === 'failed' ? (
                                    <p className="text-xs wrap-anywhere text-muted-foreground">{listing.message}</p>
                                ) : null}
                                {listing.status === 'listed' && !listing.folderFound ? (
                                    <p className="text-xs text-muted-foreground">
                                        To add your own, put .md or .mmd files in <code className="font-mono">{TEMPLATES_FOLDER_LABEL}</code> at the
                                        top of this folder.
                                    </p>
                                ) : null}
                            </div>
                            <CommandEmpty>No templates match.</CommandEmpty>
                            <CommandList>
                                {(group: TemplateGroup) => (
                                    <CommandGroup key={group.value} items={group.items}>
                                        <CommandGroupLabel>{group.label}</CommandGroupLabel>
                                        <CommandCollection>
                                            {(option: TemplateOption) => (
                                                <CommandItem key={option.value} onClick={() => void pick(option)} value={option}>
                                                    <KindIcon kind={option.kind} />
                                                    <span className="min-w-0 flex-1">
                                                        <span dir="auto" className="block truncate text-left">
                                                            {option.title}
                                                        </span>
                                                        <span
                                                            dir="auto"
                                                            className="block truncate text-left text-xs text-muted-foreground
                                                                in-data-highlighted:text-accent-foreground"
                                                        >
                                                            {option.detail}
                                                        </span>
                                                    </span>
                                                    <span
                                                        className="ms-2 shrink-0 text-xs text-muted-foreground
                                                            in-data-highlighted:text-accent-foreground"
                                                    >
                                                        {KIND_LABEL[option.kind]}
                                                    </span>
                                                </CommandItem>
                                            )}
                                        </CommandCollection>
                                    </CommandGroup>
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
                                    <span>Use template</span>
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
        </TemplatePickerContext.Provider>
    )
}
