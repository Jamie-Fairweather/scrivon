'use client'

import { Loader2 } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useFocusReturn } from '@/components/studio/dialogs/focus-return'
import { useCreateNewItem } from '@/components/studio/explorer/use-file-tree-actions'
import { useActiveTabId, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { RENDER_TIMEOUT_MESSAGE, renderMermaidDiagramAsync, SupersededRenderError } from '@/lib/mermaid/render-client'
import { MERMAID_SNIPPETS, type MermaidSnippet } from '@/lib/monaco/mermaid-snippets'
import { snippetText } from '@/lib/monaco/snippet-text'
import type { AppThemeId } from '@/lib/theme/catalog'
import { cn } from '@/lib/utils'
import { newItemFolder } from '@/lib/workspace/new-item-folder'

/** What the Diagram Starters window is opened for. */
export type StarterGalleryRequest = {
    /** The main button, which Enter on a card runs: Insert puts the starter in the open file, New File makes a file from it. */
    primary: 'insert' | 'new-file'
    /** The folder New File makes the file in. Left out, the folder a new item would go in for the open file. */
    folder?: string | null
    /** Insert, offered when the window is opened from the editor. */
    insert?: {
        /** Why the starter can't go in now, or null when it can. Asked as the window opens and again when Insert is pressed. */
        problem: () => string | null
        /** Puts the starter in, once the window has closed. */
        run: (snippet: MermaidSnippet) => void
    }
}

type DiagramStartersContextValue = {
    /** Opens the Diagram Starters window. */
    openStarterGallery: (request: StarterGalleryRequest) => void
}

const DiagramStartersContext = createContext<DiagramStartersContextValue | null>(null)

export function useDiagramStarters(): DiagramStartersContextValue {
    const ctx = useContext(DiagramStartersContext)
    if (!ctx) throw new Error('useDiagramStarters must be used within DiagramStartersProvider')
    return ctx
}

/** Each starter's text, without the placeholder markers: what its preview draws and what a new file from it holds. */
const STARTER_TEXT = new Map(MERMAID_SNIPPETS.map((snippet) => [snippet.label, snippetText(snippet.body)]))

/**
 * The render queue's document key for a starter's preview: its own, so a preview never replaces or holds up a render
 * for the open file (whose key is its path), and the previews don't replace each other.
 */
export function starterPreviewKey(snippet: MermaidSnippet): string {
    return `scrivon:diagram-starter:${snippet.label}`
}

/** A short message for a preview that didn't draw, for its card. */
export function previewFailureMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    return message === RENDER_TIMEOUT_MESSAGE ? 'Preview took too long to draw' : "Preview couldn't be drawn"
}

type Preview = { status: 'drawn'; svg: string } | { status: 'failed'; message: string }

const previewKey = (themeId: AppThemeId, snippet: MermaidSnippet) => `${themeId}\0${snippet.label}`

/**
 * Draws each starter's preview in the theme on screen while the window is open, one at a time, so the open file's own
 * preview waits behind one small render at most. Closing the window, or changing the theme, stops the ones still to
 * draw. Previews drawn are kept for the next time the window opens; ones that failed are tried again then.
 */
function useStarterPreviews(open: boolean, themeId: AppThemeId): { previews: ReadonlyMap<string, Preview>; forgetFailures: () => void } {
    const [previews, setPreviews] = useState<ReadonlyMap<string, Preview>>(new Map())
    // The pictures drawn so far, read by the loop below without waiting for a render.
    const drawnRef = useRef(new Map<string, string>())

    useEffect(() => {
        if (!open) return
        const stillWanted = new AbortController()
        const store = (key: string, preview: Preview) => {
            if (stillWanted.signal.aborted) return
            if (preview.status === 'drawn') drawnRef.current.set(key, preview.svg)
            setPreviews((prev) => new Map(prev).set(key, preview))
        }
        const drawAll = async () => {
            for (const snippet of MERMAID_SNIPPETS) {
                if (stillWanted.signal.aborted) return
                const key = previewKey(themeId, snippet)
                if (drawnRef.current.has(key)) continue
                try {
                    const svg = await renderMermaidDiagramAsync(
                        STARTER_TEXT.get(snippet.label)!,
                        themeId,
                        starterPreviewKey(snippet),
                        stillWanted.signal
                    )
                    store(key, { status: 'drawn', svg })
                } catch (err) {
                    if (err instanceof SupersededRenderError) continue
                    store(key, { status: 'failed', message: previewFailureMessage(err) })
                }
            }
        }
        void drawAll()
        return () => stillWanted.abort()
    }, [open, themeId])

    // Called as the window opens, so previews that failed last time are tried again.
    const forgetFailures = useCallback(() => {
        setPreviews((prev) => {
            const drawn = [...prev].filter(([, preview]) => preview.status === 'drawn')
            return drawn.length === prev.size ? prev : new Map(drawn)
        })
    }, [])

    return { previews, forgetFailures }
}

const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

type StarterCardProps = {
    snippet: MermaidSnippet
    preview: Preview | undefined
    selected: boolean
    cardRef: (el: HTMLDivElement | null) => void
    onSelect: () => void
    onChoose: () => void
}

function StarterCard({ snippet, preview, selected, cardRef, onSelect, onChoose }: StarterCardProps) {
    const id = useId()
    const failed = preview?.status === 'failed' ? preview.message : null
    return (
        <div
            ref={cardRef}
            role="option"
            aria-selected={selected}
            aria-labelledby={`${id}-name`}
            aria-describedby={failed ? `${id}-summary ${id}-failed` : `${id}-summary`}
            tabIndex={selected ? 0 : -1}
            data-starter={snippet.label}
            onClick={onSelect}
            onDoubleClick={onChoose}
            onFocus={onSelect}
            className={cn(
                `flex cursor-pointer flex-col gap-2 rounded-xl border p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring
                focus-visible:ring-offset-1 focus-visible:ring-offset-background`,
                selected ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-accent/50'
            )}
        >
            {/* An image, so nothing in the diagram (its styles, its fonts) reaches the app or the network. */}
            <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg border bg-background p-2">
                {preview?.status === 'drawn' ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a picture drawn here, as a data: URL, in a static export
                    <img alt="" src={svgDataUrl(preview.svg)} className="max-h-full max-w-full object-contain" draggable={false} />
                ) : failed ? (
                    <p id={`${id}-failed`} className="text-center text-xs text-muted-foreground">
                        {failed}
                    </p>
                ) : (
                    <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
                )}
            </div>
            <div className="px-1 pb-1">
                <p id={`${id}-name`} className="text-sm font-medium">
                    {snippet.name}
                </p>
                <p id={`${id}-summary`} className="text-xs text-muted-foreground in-aria-selected:text-accent-foreground">
                    {snippet.summary}
                </p>
            </div>
        </div>
    )
}

/** The keys that move between the cards: the ones in reading order, as the grid wraps at any width. */
function cardAfterKey(key: string, index: number, count: number): number | null {
    if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(index + 1, count - 1)
    if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(index - 1, 0)
    if (key === 'Home') return 0
    if (key === 'End') return count - 1
    return null
}

/**
 * The Diagram Starters window: one card per starter in MERMAID_SNIPPETS, each with a preview in the theme on screen.
 * Opened by New Diagram from Starter (its main button makes a new file) or Insert Diagram Starter (its main button puts
 * the starter in the open file, and New File is there too). Mount it inside NamePromptProvider, which New File uses.
 */
export function DiagramStartersProvider({ children }: { children: ReactNode }) {
    const { themeId } = useAppTheme()
    const { workspaceRoot, tree } = useWorkspaceSession()
    const activeTabId = useActiveTabId()
    const createNewItem = useCreateNewItem()
    const { remember: rememberFocus, returnTarget } = useFocusReturn()
    const [open, setOpen] = useState(false)
    // Kept while the window fades out, so its buttons stay put.
    const [request, setRequest] = useState<StarterGalleryRequest | null>(null)
    const [folder, setFolder] = useState<string | null>(null)
    const [selected, setSelected] = useState(0)
    const [insertProblem, setInsertProblem] = useState<string | null>(null)
    // What to do once the window has closed: insert into the editor, or ask for the new file's name.
    const afterCloseRef = useRef<(() => void) | null>(null)
    const cardsRef = useRef<(HTMLDivElement | null)[]>([])
    const { previews, forgetFailures } = useStarterPreviews(open, themeId)
    const reasonId = useId()

    const openStarterGallery = useCallback(
        (next: StarterGalleryRequest) => {
            rememberFocus()
            forgetFailures()
            afterCloseRef.current = null
            setSelected(0)
            setRequest(next)
            setFolder(
                next.folder !== undefined
                    ? next.folder
                    : workspaceRoot
                      ? newItemFolder({ root: workspaceRoot, tree, selectedPath: null, activePath: activeTabId })
                      : null
            )
            setInsertProblem(next.insert?.problem() ?? null)
            setOpen(true)
        },
        [rememberFocus, forgetFailures, workspaceRoot, tree, activeTabId]
    )

    const closeThen = useCallback((afterClose: () => void) => {
        afterCloseRef.current = afterClose
        setOpen(false)
    }, [])

    const insert = useCallback(
        (snippet: MermaidSnippet) => {
            const target = request?.insert
            if (!target) return
            // The file may have changed since the window opened (autosave, a reload from disk).
            const problem = target.problem()
            setInsertProblem(problem)
            if (problem === null) closeThen(() => target.run(snippet))
        },
        [request, closeThen]
    )

    const newFile = useCallback(
        (snippet: MermaidSnippet) => {
            if (!folder) return
            closeThen(() => {
                void createNewItem('new-diagram', folder, { name: snippet.fileName, content: STARTER_TEXT.get(snippet.label)! })
            })
        },
        [folder, closeThen, createNewItem]
    )

    const insertOffered = request?.primary === 'insert' && request.insert !== undefined
    const newFileProblem = folder ? null : 'Open a folder first'
    const primaryProblem = insertOffered ? insertProblem : newFileProblem
    const snippet = MERMAID_SNIPPETS[selected] ?? MERMAID_SNIPPETS[0]
    const runPrimary = useCallback(
        (index: number) => {
            const chosen = MERMAID_SNIPPETS[index]
            if (!chosen) return
            if (insertOffered) insert(chosen)
            else newFile(chosen)
        },
        [insertOffered, insert, newFile]
    )

    const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault()
            runPrimary(selected)
            return
        }
        const next = cardAfterKey(event.key, selected, MERMAID_SNIPPETS.length)
        if (next === null) return
        event.preventDefault()
        setSelected(next)
        cardsRef.current[next]?.focus()
    }

    const value = useMemo(() => ({ openStarterGallery }), [openStarterGallery])

    return (
        <DiagramStartersContext.Provider value={value}>
            {children}
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!next) setOpen(false)
                }}
                onOpenChangeComplete={(isOpen) => {
                    if (isOpen) return
                    const afterClose = afterCloseRef.current
                    afterCloseRef.current = null
                    afterClose?.()
                }}
            >
                <DialogPopup className="max-w-3xl" initialFocus={() => cardsRef.current[selected] ?? true} finalFocus={returnTarget}>
                    <DialogHeader>
                        <DialogTitle>Diagram starters</DialogTitle>
                        <DialogDescription>
                            {insertOffered ? 'Pick a diagram to insert, or start a new file from it.' : 'Pick a diagram to start a new file from.'}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogPanel>
                        <div
                            role="listbox"
                            aria-label="Diagram starters"
                            className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3"
                            onKeyDown={onListKeyDown}
                        >
                            {MERMAID_SNIPPETS.map((item, index) => (
                                <StarterCard
                                    key={item.label}
                                    snippet={item}
                                    preview={previews.get(previewKey(themeId, item))}
                                    selected={index === selected}
                                    cardRef={(el) => {
                                        cardsRef.current[index] = el
                                    }}
                                    onSelect={() => setSelected(index)}
                                    onChoose={() => runPrimary(index)}
                                />
                            ))}
                        </div>
                    </DialogPanel>
                    <DialogFooter className="sm:items-center">
                        <p id={reasonId} role="status" className="text-sm text-muted-foreground empty:hidden sm:me-auto">
                            {primaryProblem}
                        </p>
                        <DialogClose render={<Button type="button" variant="ghost" />}>Cancel</DialogClose>
                        {insertOffered ? (
                            <Button
                                type="button"
                                variant="outline"
                                disabled={newFileProblem !== null}
                                title={newFileProblem ?? undefined}
                                onClick={() => newFile(snippet)}
                            >
                                New File
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            disabled={primaryProblem !== null}
                            aria-describedby={primaryProblem ? reasonId : undefined}
                            onClick={() => runPrimary(selected)}
                        >
                            {insertOffered ? 'Insert' : 'New File'}
                        </Button>
                    </DialogFooter>
                </DialogPopup>
            </Dialog>
        </DiagramStartersContext.Provider>
    )
}
