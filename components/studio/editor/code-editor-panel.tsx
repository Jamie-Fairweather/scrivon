'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { IDisposable, editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { MONACO_DIAGRAM_THEME_ID, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { editorAriaLabel, tabFocusToggleKeyLabel } from '@/lib/monaco/editor-aria'
import { MERMAID_LANGUAGE_ID } from '@/lib/monaco/mermaid-language'
import { leaveF1ToAppKeybinds } from '@/lib/monaco/editor-keybindings'
import { bindMarkdownListEnter } from '@/lib/monaco/markdown-editing'
import { bindWikiLinkSuggest } from '@/lib/monaco/wiki-link-completion'
import { WORD_SEGMENTER_LOCALES } from '@/lib/markdown/inline-format'
import { readEditorSelectedText } from '@/lib/monaco/editor-selection'
import { takeOverEditorPaste } from '@/lib/monaco/paste-command'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { useEditorGroup } from '@/components/studio/workspace/editor-group-context'
import { applyIndentation, useEditorModels } from '@/components/studio/editor/editor-models'
import { useEditorCommands } from '@/components/studio/editor/editor-commands'
import { claimEditorCursor, trackEditorCursor } from '@/components/studio/editor/editor-cursor'
import { trackCaretInTable } from '@/components/studio/editor/editor-table-caret'
import { useTableSizePrompt } from '@/components/studio/dialogs/insert-table-dialog'
import { useDiagramStarters } from '@/components/studio/dialogs/diagram-starters-provider'
import { editorFocusTaken, registerEditorFocus, registerEditorFocusNow } from '@/components/studio/editor/editor-focus'
import { attachEditorImages, imageDocumentFor, pasteClipboardPicture } from '@/components/studio/editor/editor-images'
import { ReadOnlyReasonBar } from '@/components/studio/editor/read-only-reason-bar'
import { clampEditorWidth, maxEditorWidth, minEditorWidth } from '@/components/studio/editor/editor-width'
import { useEditorLinkCheck } from '@/components/studio/editor/use-editor-link-check'
import { useWikiLinkSource } from '@/components/studio/editor/use-wiki-link-source'
import { useEditorSpellcheck } from '@/components/studio/editor/use-editor-spellcheck'
import { EditorContextMenu } from '@/components/studio/editor/editor-context-menu'
import { bindEditorScrollSync } from '@/components/studio/editor/editor-scroll-sync'
import { bindParagraphDimming, type ParagraphDimming } from '@/components/studio/editor/editor-paragraph-dimming'
import { documentKind, samePath } from '@/lib/tauri/fs'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import { formatKeybindForAction } from '@/lib/settings/format-keybind'
import { editorEmptyMessage } from '@/components/studio/editor/editor-empty-message'
import type { DocumentTab } from '@/lib/workspace/types'
import { cn } from '@/lib/utils'

function EditorLoading() {
    return <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">Loading editor…</div>
}

// Monaco is bundled with the app (see lib/monaco/setup-monaco.ts) and only loaded in the browser.
const MonacoEditor = dynamic(
    async () => {
        await import('@/lib/monaco/setup-monaco')
        return (await import('@monaco-editor/react')).default
    },
    { ssr: false, loading: () => <EditorLoading /> }
)

/** Monaco's shared "Tab moves focus" switch (lib/monaco/tab-focus.ts), loaded with the editor's code. */
const loadTabFocus = () => import('@/lib/monaco/tab-focus').then((module) => module.TabFocus)

/** Used after the app's own monospace font (while it loads, or if it fails), and instead of it if it can't be read. */
const FALLBACK_MONO_FONTS = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/**
 * The app's monospace font (Geist Mono, from next/font as --font-mono), so code looks the same in
 * the editor and the preview. Monaco sets its font inline and measures it on a canvas, so it needs
 * the real font names rather than var(--font-mono).
 */
function editorFontFamily(): string {
    if (typeof document === 'undefined') return FALLBACK_MONO_FONTS
    const appMono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
    // Only the font itself: the 'Geist Mono Fallback' next/font lists after it is a resized
    // Arial, which is not monospaced and would put the cursor between letters.
    const font = appMono.split(',')[0]?.trim()
    return font && !font.includes('var(') ? `${font}, ${FALLBACK_MONO_FONTS}` : FALLBACK_MONO_FONTS
}

const BASE_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    fontFamily: FALLBACK_MONO_FONTS,
    wordWrap: 'on',
    automaticLayout: true,
    padding: { top: 12 },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineNumbers: 'on',
    renderLineHighlight: 'all',
    tabSize: 2,
    // Monaco would otherwise guess the indent size from each file and ignore the Tab size
    // setting for any file that is already indented. Tabs or spaces: see applyIndentation.
    detectIndentation: false,
    // Monaco's defaults are for source code: they box ordinary Cyrillic, Greek and CJK
    // letters and punctuation, curly quotes and en dashes. Off, as in VS Code for Markdown.
    unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
    },
    // Monaco would otherwise delete U+2028/U+2029 (common in text from PDFs, Word or the web) from
    // the user's file without asking: its prompt goes through window.confirm, which the Tauri dialog
    // plugin replaces with an async function, and Monaco reads the Promise it gets back as a yes.
    unusualLineTerminators: 'off',
    // Word suggestions off, as in VS Code for Markdown: prose isn't code, and Enter must always
    // start a new line rather than swap the word just typed for one from another file.
    quickSuggestions: false,
    wordBasedSuggestions: 'off',
    suggestOnTriggerCharacters: false,
    acceptSuggestionOnEnter: 'off',
    snippetSuggestions: 'none',
    // Monaco 0.56 made a double-click next to a bracket or quote select what's inside it. In Markdown
    // that catches links, (asides) and "quotes", so double-click keeps selecting the word, as it always did.
    doubleClickSelectsBlock: false,
    // The app draws the right-click menu itself (editor-context-menu.tsx), like its other menus, with the
    // spelling suggestions in it.
    contextmenu: false,
    // These languages don't put spaces between words, so without this double-click and Ctrl+Left/Right
    // take a whole sentence at a time.
    wordSegmenterLocales: WORD_SEGMENTER_LOCALES,
    scrollbar: {
        vertical: 'auto',
        // Only appears when a line is wider than the pane (word wrap off or at a column).
        horizontal: 'auto',
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
    },
}

type CodeEditorPanelProps = {
    /** When false the panel is hidden but stays mounted, so undo history and scroll survive. */
    open?: boolean
    /** True while the preview is hidden: the editor takes the whole row and can't be resized. */
    fill?: boolean
    /**
     * In focus mode the editor is all there is: with no file open it says how to leave, and it can take focus
     * itself, so focus has somewhere to go inside the window.
     */
    focusMode?: boolean
    width: number
    onWidthChange: (width: number) => void
    /** Puts the editor back to its default width (double-click or Enter on the resize handle). */
    onResetWidth?: () => void
}

/** How far one arrow key press moves the resize handle (with Shift: the larger step). */
const KEYBOARD_RESIZE_STEP = 16
const KEYBOARD_RESIZE_BIG_STEP = 64
/** How long the "Ctrl+M: Tab moves focus" hint stays up after the editor gains focus or the mode switches. */
const TAB_FOCUS_HINT_MS = 5000

/** Selects a search hit (a bare caret when it has no length), scrolls it into view and focuses the editor. */
function revealMatch(editor: editor.IStandaloneCodeEditor, line: number, column: number, length = 0) {
    const range = { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + Math.max(0, length) }
    editor.setSelection(range)
    editor.revealRangeInCenter(range)
    editor.focus()
}

/** True when the tab is the one for `path`, however the path is written (separators, or letter case on Windows). */
function isTab(tabId: string | null, path: string): boolean {
    return tabId !== null && samePath(tabId, path)
}

function isMarkdownTab(tab: DocumentTab | null): boolean {
    return tab !== null && documentKind(tab.name) === 'markdown'
}

function languageForTab(tab: DocumentTab) {
    const kind = documentKind(tab.name)
    if (kind === 'mermaid') return MERMAID_LANGUAGE_ID
    return kind === 'markdown' || tab.readOnly ? 'markdown' : 'plaintext'
}

export function CodeEditorPanel({ open = true, fill = false, focusMode = false, width, onWidthChange, onResetWidth }: CodeEditorPanelProps) {
    const { isLight, tokens } = useAppTheme()
    const { settings } = useAppSettings()
    // The panel's own group: its tab, and whether it has the keyboard. Both groups' panels share the buffers.
    const group = useEditorGroup()
    const activeTab = group.tab
    const focused = group.focused
    const groupId = group.id
    const models = useEditorModels()
    const { workspaceRoot } = useWorkspaceSession()
    const resizeDragRef = useRef<{ pointerId: number; startX: number; startWidth: number; available: number; width: number } | null>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const [rowWidth, setRowWidth] = useState(0)
    const { getMonaco, setMonaco } = models
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
    // The same editor as editorRef, kept as state so the Edit menu and the palette follow it.
    const [mountedEditor, setMountedEditor] = useState<editor.IStandaloneCodeEditor | null>(null)
    const activeTabIdRef = useRef<string | null>(null)
    const activeTabRef = useRef<DocumentTab | null>(null)
    // Whether this panel's group has the keyboard, for the editor's own handlers.
    const focusedRef = useRef(focused)
    const pendingRevealRef = useRef<{ path: string; line: number; column: number; length?: number } | null>(null)
    const [editorFocused, setEditorFocused] = useState(false)
    // The Tab key hint sits over the text, so it shows only for a while each time the editor gains focus or
    // Ctrl+M switches the mode, not the whole time the user types. Each of those starts a new showing.
    const [hintShowing, setHintShowing] = useState(0)
    const [hintShowingDone, setHintShowingDone] = useState(0)
    const showHintAgain = useCallback(() => setHintShowing((n) => n + 1), [])
    useEffect(() => {
        if (!editorFocused) return
        const timer = setTimeout(() => setHintShowingDone(hintShowing), TAB_FOCUS_HINT_MS)
        return () => clearTimeout(timer)
    }, [editorFocused, hintShowing])

    // The setting picks what Tab does when the editor starts. Ctrl+M (Monaco's own toggle) can still
    // switch it while typing, so the hint and the editor's name follow Monaco's mode, not the setting.
    // Not the tabFocusMode editor option: while that is on, Ctrl+M can't turn it off.
    const tabMovesFocusSetting = settings.editor.tabMovesFocus
    const [tabMovesFocus, setTabMovesFocus] = useState(tabMovesFocusSetting)
    useEffect(() => {
        let cancelled = false
        let subscription: IDisposable | undefined
        loadTabFocus()
            .then((tabFocus) => {
                if (cancelled) return
                tabFocus.setTabFocusMode(tabMovesFocusSetting)
                setTabMovesFocus(tabFocus.getTabFocusMode())
                subscription = tabFocus.onDidChangeTabFocus((mode) => {
                    setTabMovesFocus(mode)
                    showHintAgain()
                })
            })
            // Monaco failed to load, so there is no editor to set it on.
            .catch(() => {})
        return () => {
            cancelled = true
            subscription?.dispose()
        }
    }, [tabMovesFocusSetting, showHintAgain])

    // Each open tab has its own Monaco model, the same in every group (EditorModelsProvider).
    const modelKeys = models.keys

    useEffect(() => {
        activeTabIdRef.current = activeTab?.id ?? null
        activeTabRef.current = activeTab
    }, [activeTab])

    // The focused group's editor is the one the status bar and the Outline follow.
    useEffect(() => {
        focusedRef.current = focused
        if (focused && mountedEditor) claimEditorCursor(mountedEditor)
    }, [focused, mountedEditor])

    // Read when an image is pasted or dropped, so the editor's handlers never hold an old one.
    const workspaceRootRef = useRef(workspaceRoot)
    useEffect(() => {
        workspaceRootRef.current = workspaceRoot
    }, [workspaceRoot])

    // A hidden editor keeps its buffer, but can't take focus and has no visible selection.
    const openRef = useRef(open)

    // The palette jumps once the hit's file has opened. Like the focus request below, the render this
    // starts already has the open's change of tab, so the effect further down sees which file shows.
    const [revealRequest, setRevealRequest] = useState(0)
    const revealPosition = useCallback((path: string, line: number, column: number, length?: number) => {
        pendingRevealRef.current = { path, line, column, length }
        setRevealRequest((n) => n + 1)
    }, [])

    // Fills the palette's search box, so it must be text the user can see.
    const getEditorSelectedText = useCallback(() => (openRef.current ? readEditorSelectedText(editorRef.current) : null), [])

    // A file just opened or created (from the palette or the explorer's New menu) gets the keyboard once
    // the editor is ready, so typing goes straight into it.
    const pendingFocusRef = useRef<string | null>(null)
    const focusPendingTab = useCallback(() => {
        const path = pendingFocusRef.current
        if (!path || !openRef.current || !editorRef.current || !isTab(activeTabIdRef.current, path)) return
        pendingFocusRef.current = null
        editorFocusTaken(path)
        // A frame later, so a dialog that is closing (the palette, the name prompt) has let go of focus.
        requestAnimationFrame(() => {
            if (openRef.current && isTab(activeTabIdRef.current, path)) editorRef.current?.focus()
        })
    }, [])

    // Callers ask once the open has finished. React applies updates in the order they were made, so the
    // render this request starts already has the open's change of tab, and the check below sees the result.
    const [focusRequest, setFocusRequest] = useState(0)
    useEffect(
        () =>
            registerEditorFocus((path) => {
                // A hidden editor can't take focus; the user is working in the explorer or the preview.
                if (!openRef.current) return
                pendingFocusRef.current = path
                setFocusRequest((n) => n + 1)
            }),
        []
    )

    // Focus Editor and F6 (pane-focus.ts) put the keyboard here at once, while the editor shows a file. F6
    // finds this group's editor by its pane.
    useEffect(
        () =>
            registerEditorFocusNow(
                () => {
                    const editor = editorRef.current
                    if (!openRef.current || !editor?.getModel()) return false
                    editor.focus()
                    return true
                },
                groupId,
                () => rootRef.current
            ),
        [groupId]
    )

    // Kept only while its file is the tab showing, which may still be waiting for the editor to load. If
    // the file didn't open (the user said no to a large file, it couldn't be read or made) or another tab
    // shows later, the request is dropped, so opening that file by hand later doesn't move the keyboard.
    // With the editor split, only the focused group's editor takes it: the file opened (or was shown) there.
    const shownTabId = activeTab?.id ?? null
    useEffect(() => {
        const path = pendingFocusRef.current
        if (path === null) return
        if (focused && isTab(shownTabId, path)) focusPendingTab()
        else pendingFocusRef.current = null
    }, [shownTabId, focused, focusRequest, focusPendingTab])

    // A search hit is kept the same way: only while its file is the tab showing, waiting for the editor
    // to load or be shown (a hidden one can't take focus). If the file didn't open or another tab shows,
    // the hit is dropped, so opening that file later doesn't jump to an old line and take the keyboard.
    useEffect(() => {
        openRef.current = open
        const pending = pendingRevealRef.current
        if (!pending) return
        if (!isTab(shownTabId, pending.path)) {
            pendingRevealRef.current = null
            return
        }
        const editor = editorRef.current
        if (!open || !editor) return
        pendingRevealRef.current = null
        revealMatch(editor, pending.line, pending.column, pending.length)
    }, [open, shownTabId, revealRequest])

    // Measure the row shared with the preview, so a saved width that no longer fits (smaller
    // window or monitor) is shown narrower instead of pushing the preview off-screen. The
    // saved width is left alone and comes back when there is room again.
    useEffect(() => {
        const row = rootRef.current?.parentElement
        if (!row || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setRowWidth(entry.contentRect.width)
        })
        observer.observe(row)
        return () => observer.disconnect()
    }, [])

    const effectiveWidth = rowWidth > 0 ? clampEditorWidth(width, rowWidth) : width
    // While dragging, the width lives here and is saved once when the drag ends.
    const [dragWidth, setDragWidth] = useState<number | null>(null)
    const shownWidth = dragWidth ?? effectiveWidth
    const availableWidth = rowWidth > 0 ? rowWidth : typeof window !== 'undefined' ? window.innerWidth : 0

    const onResizePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            // Only the main button resizes; right and middle clicks do nothing here.
            if (e.button !== 0) return
            e.preventDefault()
            e.currentTarget.setPointerCapture(e.pointerId)
            resizeDragRef.current = {
                pointerId: e.pointerId,
                startX: e.clientX,
                startWidth: effectiveWidth,
                available: availableWidth,
                width: effectiveWidth,
            }
            setDragWidth(effectiveWidth)
        },
        [effectiveWidth, availableWidth]
    )

    const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const drag = resizeDragRef.current
        if (!drag || e.pointerId !== drag.pointerId) return
        drag.width = clampEditorWidth(drag.startWidth + e.clientX - drag.startX, drag.available)
        setDragWidth(drag.width)
    }, [])

    /** Ends a drag however it ends (release, cancel or lost capture) and saves the width once. */
    const endResize = useCallback(() => {
        const drag = resizeDragRef.current
        if (!drag) return
        resizeDragRef.current = null
        setDragWidth(null)
        if (drag.width !== drag.startWidth) onWidthChange(drag.width)
    }, [onWidthChange])

    /** Arrow keys resize (Shift for bigger steps), Home and End go to the narrowest and widest, Enter resets. */
    const onResizeKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            const step = e.shiftKey ? KEYBOARD_RESIZE_BIG_STEP : KEYBOARD_RESIZE_STEP
            let next: number
            if (e.key === 'ArrowLeft') next = effectiveWidth - step
            else if (e.key === 'ArrowRight') next = effectiveWidth + step
            else if (e.key === 'Home') next = minEditorWidth(availableWidth)
            else if (e.key === 'End') next = maxEditorWidth(availableWidth)
            else if (e.key === 'Enter' && onResetWidth) {
                e.preventDefault()
                onResetWidth()
                return
            } else return
            e.preventDefault()
            const clamped = clampEditorWidth(next, availableWidth)
            if (clamped !== effectiveWidth) onWidthChange(clamped)
        },
        [effectiveWidth, availableWidth, onWidthChange, onResetWidth]
    )

    // Every editor showing the buffer hears a change to it (both groups, with one file in each); the shared models
    // pass it on to the tab once.
    const { isSilent, editorChanged, syncModel, registerPanel } = models
    const onEditorChange = useCallback(
        (value: string | undefined, event?: { versionId?: number }) => {
            if (isSilent()) return
            const id = activeTabIdRef.current
            if (!id) return
            editorChanged(id, value ?? '', editorRef.current?.getModel() ?? null, event?.versionId)
        },
        [isSilent, editorChanged]
    )

    const editorPath = activeTab ? modelKeys.keys.get(activeTab.path) : undefined
    const { attach: attachEditorSpellcheck, misspeltWordAt } = useEditorSpellcheck(activeTab, editorPath)
    const attachEditorLinkCheck = useEditorLinkCheck(activeTab, editorPath)
    // The notes [[ offers in a Markdown file: this editor's own, as the other group may show another file.
    useWikiLinkSource(activeTab, editorPath)
    const isReadOnly = activeTab?.readOnly ?? false
    // Monaco sets up Ctrl+. (the quick fix list) for a file when the file is put in the editor, and only if the
    // editor can be edited at that moment. @monaco-editor/react puts the new file in first and passes on the new
    // options after, so without this, after a read-only tab (an example, say) Ctrl+. would do nothing in the next
    // file. A layout effect runs before those, so the editor is already editable, or not, when the file goes in.
    // Turning read-only off with the same file still showing (Edit as UTF-8, Edit Anyway, a reload) doesn't make
    // Monaco set it up again either; the spell check and the link check do that when they turn on (setConfig in
    // lib/monaco/spellcheck.ts and lib/monaco/link-check.ts).
    useLayoutEffect(() => {
        editorRef.current?.updateOptions({ readOnly: isReadOnly, domReadOnly: isReadOnly })
    }, [isReadOnly])
    // Whether the caret is in a Markdown table, for the table commands (set by trackCaretInTable).
    const [caretInTable, setCaretInTable] = useState(false)
    const tableCaretRef = useRef<ReturnType<typeof trackCaretInTable> | null>(null)
    const activeIsMarkdown = isMarkdownTab(activeTab)
    // The editor swaps in a tab's buffer before activeTabRef follows the tab, so look again once it has.
    useEffect(() => {
        tableCaretRef.current?.update()
    }, [activeTab?.id, activeIsMarkdown])
    const { askTableSize, dialog: insertTableDialog } = useTableSizePrompt()
    const { openStarterGallery } = useDiagramStarters()
    const activeKind = activeTab ? documentKind(activeTab.name) : null
    // The Edit menu and the palette's editor commands act on this editor while it shows a file and its group has the
    // keyboard; the other group's editor leaves them to it.
    useEditorCommands(editorPath ? mountedEditor : null, {
        register: focused,
        shown: open,
        readOnly: isReadOnly,
        markdown: activeIsMarkdown,
        inTable: caretInTable,
        askTableSize,
        fileKind: activeKind ?? 'other',
        openStarterGallery,
    })
    const editorLanguage = useMemo(() => (activeTab ? languageForTab(activeTab) : 'plaintext'), [activeTab])
    const editorDefaultValue = activeTab?.content
    const activeName = activeTab?.name
    // Zero-width characters silently break Mermaid parsing, so show them in diagram files.
    const isMermaid = activeName !== undefined && documentKind(activeName) === 'mermaid'
    const ariaLabel = useMemo(
        () => editorAriaLabel(activeName !== undefined ? { name: activeName, readOnly: isReadOnly } : null, isMacPlatform(), tabMovesFocus),
        [activeName, isReadOnly, tabMovesFocus]
    )
    const [fontFamily] = useState(editorFontFamily)
    const tabFocusKey = tabFocusToggleKeyLabel(isMacPlatform())
    const editorOptions = useMemo(
        () => ({
            ...BASE_EDITOR_OPTIONS,
            fontFamily,
            fontSize: settings.editor.fontSize,
            tabSize: settings.editor.tabSize,
            wordWrap: settings.editor.wordWrap,
            wordWrapColumn: settings.editor.wordWrapColumn,
            lineNumbers: settings.editor.lineNumbers,
            minimap: { enabled: settings.editor.minimap },
            readOnly: isReadOnly,
            domReadOnly: isReadOnly,
            ariaLabel,
            unicodeHighlight: { ...BASE_EDITOR_OPTIONS.unicodeHighlight, invisibleCharacters: isMermaid },
            // Diagram files offer a starter for each diagram type on Ctrl+Space (lib/monaco/mermaid-snippets.ts).
            // Nothing pops up while typing, so Enter can pick from the list the user asked for.
            ...(isMermaid ? { snippetSuggestions: 'inline' as const, acceptSuggestionOnEnter: 'on' as const } : {}),
        }),
        [fontFamily, settings.editor, isReadOnly, ariaLabel, isMermaid]
    )

    // The group's link to its preview, which stays the same while the group is open.
    const previewSyncRef = useRef(group.previewSync)
    // Read through a ref, so the link to the preview always sees the current settings.
    const previewLinkRef = useRef({ scroll: settings.editor.scrollSync, jump: settings.editor.jumpFromPreview })
    useEffect(() => {
        previewLinkRef.current = { scroll: settings.editor.scrollSync, jump: settings.editor.jumpFromPreview }
    }, [settings.editor.scrollSync, settings.editor.jumpFromPreview])

    // Dim Other Paragraphs, read through a ref by the editor's dimming (bindParagraphDimming).
    const dimOtherParagraphs = settings.editor.dimOtherParagraphs
    const dimOtherParagraphsRef = useRef(dimOtherParagraphs)
    const dimmingRef = useRef<ParagraphDimming | null>(null)
    useEffect(() => {
        dimOtherParagraphsRef.current = dimOtherParagraphs
        dimmingRef.current?.refresh()
    }, [dimOtherParagraphs])

    const tabSizeRef = useRef(settings.editor.tabSize)
    useEffect(() => {
        tabSizeRef.current = settings.editor.tabSize
        const editor = editorRef.current
        editor?.updateOptions({
            fontSize: settings.editor.fontSize,
            tabSize: settings.editor.tabSize,
            wordWrap: settings.editor.wordWrap,
            wordWrapColumn: settings.editor.wordWrapColumn,
            lineNumbers: settings.editor.lineNumbers,
            minimap: { enabled: settings.editor.minimap },
        })
        // Changing Tab size resets every buffer to spaces, so look at the file again.
        const model = editor?.getModel()
        if (model) applyIndentation(model, settings.editor.tabSize)
    }, [settings.editor])

    // @monaco-editor/react keeps the beforeMount and onMount it was first given, so they read the
    // theme from here. If the theme changes while Monaco is still loading, the editor still
    // starts in the current one.
    const themeRef = useRef({ tokens, isLight })
    useEffect(() => {
        themeRef.current = { tokens, isLight }
    }, [tokens, isLight])

    const applyCurrentTheme = useCallback((monaco: Monaco) => {
        defineMonacoDiagramTheme(monaco, themeRef.current.tokens, themeRef.current.isLight)
        monaco.editor.setTheme(MONACO_DIAGRAM_THEME_ID)
    }, [])

    const onMonacoBeforeMount = useCallback(
        (monaco: Monaco) => {
            setMonaco(monaco)
            defineMonacoDiagramTheme(monaco, themeRef.current.tokens, themeRef.current.isLight)
        },
        [setMonaco]
    )

    /**
     * Safety net: if the editor's buffer disagrees with the tab's text, the tab wins. `given` is text the tab
     * on screen has just been given from outside the editor, before React draws it (see replaceEditorText in
     * EditorModelsProvider, which also puts in text that isn't one of the editors' own edits coming back).
     */
    const syncEditorWithActiveTab = useCallback(
        (given?: { content: string }) => {
            const model = editorRef.current?.getModel()
            const tab = given ?? activeTabRef.current
            if (!model || !tab) return
            syncModel(model, tab.content)
        },
        [syncModel]
    )

    useEffect(() => {
        syncEditorWithActiveTab()
    }, [editorPath, syncEditorWithActiveTab])

    // The shared models reach this group's editor through this: to put text in it, and to jump to a place in it
    // while the group has the keyboard (revealInEditor).
    useEffect(
        () =>
            registerPanel({
                groupId,
                editor: () => editorRef.current,
                tabId: () => activeTabIdRef.current,
                sync: syncEditorWithActiveTab,
                reveal: revealPosition,
                selectedText: getEditorSelectedText,
            }),
        [registerPanel, groupId, syncEditorWithActiveTab, revealPosition, getEditorSelectedText]
    )

    const onMonacoMount = useCallback(
        (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
            editorRef.current = editor
            setMonaco(monaco)
            setMountedEditor(editor)
            // Closing the last tab throws the editor away. Forget it, so a search hit picked
            // before the next one is ready waits for it instead of going to the old one.
            editor.onDidDispose(() => {
                if (editorRef.current === editor) editorRef.current = null
                setMountedEditor((current) => (current === editor ? null : current))
                setEditorFocused(false)
            })
            editor.onDidFocusEditorText(() => {
                setEditorFocused(true)
                showHintAgain()
            })
            editor.onDidBlurEditorText(() => setEditorFocused(false))
            // For the status bar and the Outline panel; it stops by itself when the editor is thrown away. With the
            // editor split, they follow the focused group's editor.
            trackEditorCursor(editor, { claim: focusedRef.current })
            applyCurrentTheme(monaco)
            // Monaco measures character widths once; measure again when the app font has loaded,
            // or the cursor and selection drift away from the text.
            document.fonts
                ?.load(`16px ${fontFamily}`)
                .then(() => monaco.editor.remeasureFonts())
                .catch(() => {})
            leaveF1ToAppKeybinds(editor, monaco)
            // A picture pasted or dropped into a Markdown file is saved next to it, with a link at the cursor.
            const imageDocument = () => imageDocumentFor(activeTabRef.current, workspaceRootRef.current)
            const images = attachEditorImages(editor, imageDocument)
            editor.onDidDispose(() => images.dispose())
            // Edit > Paste, the palette's Paste and the right-click Paste read the clipboard through Tauri, so
            // WebView2 never asks for access (#208). They paste its text, or else its picture, as Ctrl+V does.
            const paste = takeOverEditorPaste(editor, () => pasteClipboardPicture(editor, imageDocument))
            editor.onDidDispose(() => paste.dispose())
            const spelling = attachEditorSpellcheck(editor, monaco)
            editor.onDidDispose(() => spelling.dispose())
            // Links, images and #anchors that lead nowhere are underlined too, with their own Ctrl+. fixes.
            const links = attachEditorLinkCheck(editor, monaco)
            editor.onDidDispose(() => links.dispose())
            // Enter continues (or ends) a list in Markdown files.
            bindMarkdownListEnter(editor, monaco, () => isMarkdownTab(activeTabRef.current))
            // Typing [[ in a Markdown file offers the folder's notes; [[# the file's headings.
            const wikiSuggest = bindWikiLinkSuggest(editor, () => isMarkdownTab(activeTabRef.current))
            editor.onDidDispose(() => wikiSuggest.dispose())
            // Turns the table commands on and off as the caret moves in and out of a table.
            const tableCaret = trackCaretInTable(editor, () => isMarkdownTab(activeTabRef.current), setCaretInTable)
            tableCaretRef.current = tableCaret
            editor.onDidDispose(() => {
                tableCaret.dispose()
                if (tableCaretRef.current === tableCaret) tableCaretRef.current = null
                setCaretInTable(false)
            })
            // Scrolls the Markdown preview with the editor, and the other way round: this group's preview.
            const scrollSync = bindEditorScrollSync(
                editor,
                {
                    tabId: () => activeTabIdRef.current,
                    scrollEnabled: () => previewLinkRef.current.scroll,
                    jumpEnabled: () => previewLinkRef.current.jump,
                    canFocus: () => openRef.current,
                },
                previewSyncRef.current
            )
            editor.onDidDispose(() => scrollSync.dispose())
            // Fades the paragraphs the cursor isn't in, while Dim Other Paragraphs is on.
            const dimming = bindParagraphDimming(editor, () => dimOtherParagraphsRef.current)
            dimmingRef.current = dimming
            editor.onDidDispose(() => {
                dimming.dispose()
                if (dimmingRef.current === dimming) dimmingRef.current = null
            })
            const applyToAttachedModel = () => {
                const model = editor.getModel()
                if (model) applyIndentation(model, tabSizeRef.current)
            }
            // Each file opened in the editor (a tab switch swaps its buffer).
            editor.onDidChangeModel(applyToAttachedModel)
            applyToAttachedModel()
            syncEditorWithActiveTab()
            const pending = pendingRevealRef.current
            if (pending && openRef.current && isTab(activeTabIdRef.current, pending.path)) {
                revealMatch(editor, pending.line, pending.column, pending.length)
                pendingRevealRef.current = null
            }
            focusPendingTab()
        },
        [
            syncEditorWithActiveTab,
            setMonaco,
            applyCurrentTheme,
            fontFamily,
            focusPendingTab,
            showHintAgain,
            attachEditorSpellcheck,
            attachEditorLinkCheck,
        ]
    )

    useEffect(() => {
        const monaco = getMonaco()
        if (monaco) applyCurrentTheme(monaco)
    }, [tokens, isLight, applyCurrentTheme, getMonaco])

    return (
        <div
            ref={rootRef}
            data-slot="code-editor"
            // A pane for F6 and Focus Editor (pane-focus.ts).
            data-pane="editor"
            className={cn(
                'flex h-full flex-col bg-code',
                fill ? 'min-w-0 flex-1' : 'shrink-0 border-r border-border',
                // Hidden at full size and out of the way of the preview. Shrunk to nothing, Monaco
                // would lay out and wrap the whole file one character per line on every hide,
                // show and tab switch.
                open ? 'relative' : 'invisible absolute inset-y-0 left-0',
                focusMode && 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
            )}
            style={fill ? undefined : { width: shownWidth }}
            inert={!open}
            tabIndex={focusMode ? -1 : undefined}
            // Named in focus mode, where focus can land on the panel itself, so a screen reader says where it is.
            role={focusMode ? 'region' : undefined}
            aria-label={focusMode ? 'Editor' : undefined}
        >
            <ReadOnlyReasonBar />
            <EditorContextMenu editor={editorPath ? mountedEditor : null} readOnly={isReadOnly} misspeltWordAt={misspeltWordAt} />
            {insertTableDialog}
            {/* data-find-overflow-host: lets the find box's tooltips past this clip (app/globals.css). */}
            <div className="relative min-h-0 flex-1 overflow-hidden bg-code" data-find-overflow-host>
                {editorPath ? (
                    <MonacoEditor
                        path={editorPath}
                        defaultValue={editorDefaultValue}
                        language={editorLanguage}
                        theme={MONACO_DIAGRAM_THEME_ID}
                        loading={<EditorLoading />}
                        beforeMount={onMonacoBeforeMount}
                        onMount={onMonacoMount}
                        options={editorOptions}
                        saveViewState
                        // The buffers belong to EditorModelsProvider: the other group may still show this one.
                        keepCurrentModel
                        onChange={isReadOnly ? undefined : onEditorChange}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                        {editorEmptyMessage(
                            focusMode,
                            focusMode ? formatKeybindForAction('palette.openFiles', settings.keybinds, isMacPlatform()) : undefined
                        )}
                    </div>
                )}
                {/* Tab indents here, so say on screen how to leave with the keyboard. Screen readers
                    hear it in the editor's name instead. Clear of the scrollbars. */}
                {editorPath && editorFocused && hintShowingDone !== hintShowing ? (
                    <div
                        aria-hidden
                        data-slot="editor-tab-focus-hint"
                        className="pointer-events-none absolute right-4 bottom-3 z-10 rounded-sm border border-border bg-code px-1.5 py-0.5 text-xs
                            text-muted-foreground"
                    >
                        {tabMovesFocus ? `Tab moves focus · ${tabFocusKey} to indent` : `${tabFocusKey}: Tab moves focus`}
                    </div>
                ) : null}
            </div>

            {/* Straddles the border and sits above Monaco's scrollbar (z-index 11), so it can be
                grabbed from the text side too. */}
            {!fill && (
                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize editor"
                    aria-valuenow={shownWidth}
                    aria-valuemin={minEditorWidth(availableWidth)}
                    aria-valuemax={maxEditorWidth(availableWidth)}
                    aria-valuetext={`${shownWidth} pixels wide`}
                    tabIndex={0}
                    className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none hover:bg-ring/30
                        focus-visible:bg-ring/60 active:bg-ring/50"
                    onKeyDown={onResizeKeyDown}
                    onDoubleClick={onResetWidth}
                    onPointerDown={onResizePointerDown}
                    onPointerMove={onResizePointerMove}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onLostPointerCapture={endResize}
                />
            )}
        </div>
    )
}
