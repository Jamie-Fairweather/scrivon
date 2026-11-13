'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDisposable, editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { MONACO_DIAGRAM_THEME_ID, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { editorAriaLabel, tabFocusToggleKeyLabel } from '@/lib/monaco/editor-aria'
import { bindEditorCommandPaletteToApp } from '@/lib/monaco/editor-keybindings'
import { readEditorSelectedText } from '@/lib/monaco/editor-selection'
import { EMPTY_MODEL_KEYS, isModelKey, normalizeEditorText, samePaths, syncModelKeys } from '@/lib/monaco/model-keys'
import { useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { useOptionalCommandPalette } from '@/components/studio/command-palette/command-palette-provider'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import { registerEditorFocus } from '@/components/studio/editor/editor-focus'
import { ReadOnlyReasonBar } from '@/components/studio/editor/read-only-reason-bar'
import { clampEditorWidth, maxEditorWidth, minEditorWidth } from '@/components/studio/editor/editor-width'
import { useEditorSpellcheck } from '@/components/studio/editor/use-editor-spellcheck'
import { documentKind, samePath } from '@/lib/tauri/fs'
import { isMacPlatform } from '@/lib/settings/chord-utils'
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
    width: number
    onWidthChange: (width: number) => void
    /** Puts the editor back to its default width (double-click or Enter on the resize handle). */
    onResetWidth?: () => void
}

/** How far one arrow key press moves the resize handle (with Shift: the larger step). */
const KEYBOARD_RESIZE_STEP = 16
const KEYBOARD_RESIZE_BIG_STEP = 64
/** How many of the editor's own edits are remembered while waiting for the tab to show them. */
const MAX_UNSEEN_EDITS = 20
/** How long the "Ctrl+M: Tab moves focus" hint stays up after the editor gains focus or the mode switches. */
const TAB_FOCUS_HINT_MS = 5000

/** Selects a search hit (a bare caret when it has no length), scrolls it into view and focuses the editor. */
function revealMatch(editor: editor.IStandaloneCodeEditor, line: number, column: number, length = 0) {
    const range = { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + Math.max(0, length) }
    editor.setSelection(range)
    editor.revealRangeInCenter(range)
    editor.focus()
}

/**
 * Uses the Tab size setting in every file, but keeps each file's own choice of tabs or spaces:
 * a file indented with tabs keeps getting tabs, so Tab and Enter don't mix the two.
 */
function applyIndentation(model: editor.ITextModel, tabSize: number) {
    model.detectIndentation(true, tabSize)
    model.updateOptions({ tabSize, indentSize: tabSize })
}

/**
 * The one line ending `text` uses, or null when it has no line break or mixes them. Monaco gives a buffer
 * one line ending, so a file that mixes them is evened out on purpose and is left that way.
 */
function lineEndingOf(text: string): '\r\n' | '\n' | null {
    if (!/[\r\n]/.test(text)) return null
    if (!/\r(?!\n)|(?<!\r)\n/.test(text)) return '\r\n'
    return text.includes('\r') ? null : '\n'
}

/** True when the tab is the one for `path`, however the path is written (separators, or letter case on Windows). */
function isTab(tabId: string | null, path: string): boolean {
    return tabId !== null && samePath(tabId, path)
}

function languageForTab(tab: DocumentTab) {
    if (tab.readOnly) return 'markdown'
    const kind = documentKind(tab.name)
    return kind === 'markdown' || kind === 'mermaid' ? 'markdown' : 'plaintext'
}

export function CodeEditorPanel({ open = true, width, onWidthChange, onResetWidth }: CodeEditorPanelProps) {
    const { isLight, tokens } = useAppTheme()
    const { settings } = useAppSettings()
    const { tabs, activeTab, updateTabContent } = useDocumentTabs()
    const coordinator = useWorkspaceCoordinator()
    // The panel also works on its own (without a palette above it, the right-click entry does nothing).
    const openPalette = useOptionalCommandPalette()?.open
    // Read through a ref, so the editor's right-click 'Command Palette' never holds an old one and onMonacoMount stays stable.
    const openPaletteRef = useRef(openPalette)
    useEffect(() => {
        openPaletteRef.current = openPalette
    }, [openPalette])
    const resizeDragRef = useRef<{ pointerId: number; startX: number; startWidth: number; available: number; width: number } | null>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const [rowWidth, setRowWidth] = useState(0)
    const monacoRef = useRef<Monaco | null>(null)
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
    const activeTabIdRef = useRef<string | null>(null)
    const activeTabRef = useRef<DocumentTab | null>(null)
    const suppressChangeRef = useRef(false)
    // Text the editor has sent to the active tab that the tab may not show yet.
    const unseenEditsRef = useRef<{ tabId: string | null; texts: string[] }>({ tabId: null, texts: [] })
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

    // Each open tab gets its own Monaco model; see lib/monaco/model-keys.ts.
    const tabPaths = useMemo(() => tabs.map((t) => t.path), [tabs])
    const [modelKeys, setModelKeys] = useState(() => syncModelKeys(EMPTY_MODEL_KEYS, tabPaths))
    if (!samePaths(modelKeys.paths, tabPaths)) {
        setModelKeys(syncModelKeys(modelKeys, tabPaths))
    }

    useEffect(() => {
        activeTabIdRef.current = activeTab?.id ?? null
        activeTabRef.current = activeTab
    }, [activeTab])

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

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { revealInEditor: revealPosition, getEditorSelectedText })
    }, [coordinator, revealPosition, getEditorSelectedText])

    // A file just opened or created (from the palette or the explorer's New menu) gets the keyboard once
    // the editor is ready, so typing goes straight into it.
    const pendingFocusRef = useRef<string | null>(null)
    const focusPendingTab = useCallback(() => {
        const path = pendingFocusRef.current
        if (!path || !openRef.current || !editorRef.current || !isTab(activeTabIdRef.current, path)) return
        pendingFocusRef.current = null
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

    // Kept only while its file is the tab showing, which may still be waiting for the editor to load. If
    // the file didn't open (the user said no to a large file, it couldn't be read or made) or another tab
    // shows later, the request is dropped, so opening that file by hand later doesn't move the keyboard.
    const shownTabId = activeTab?.id ?? null
    useEffect(() => {
        const path = pendingFocusRef.current
        if (path === null) return
        if (isTab(shownTabId, path)) focusPendingTab()
        else pendingFocusRef.current = null
    }, [shownTabId, focusRequest, focusPendingTab])

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

    const onEditorChange = useCallback(
        (value: string | undefined) => {
            if (suppressChangeRef.current) return
            const id = activeTabIdRef.current
            if (!id) return
            const text = value ?? ''
            const unseen = unseenEditsRef.current
            if (unseen.tabId !== id) unseenEditsRef.current = { tabId: id, texts: [text] }
            else if (unseen.texts.push(text) > MAX_UNSEEN_EDITS) unseen.texts.shift()
            updateTabContent(id, text)
        },
        [updateTabContent]
    )

    const editorPath = activeTab ? modelKeys.keys.get(activeTab.path) : undefined
    const attachEditorSpellcheck = useEditorSpellcheck(activeTab, editorPath)
    const isReadOnly = activeTab?.readOnly ?? false
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
        }),
        [fontFamily, settings.editor, isReadOnly, ariaLabel, isMermaid]
    )

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

    const onMonacoBeforeMount = useCallback((monaco: Monaco) => {
        monacoRef.current = monaco
        defineMonacoDiagramTheme(monaco, themeRef.current.tokens, themeRef.current.isLight)
    }, [])

    /**
     * Safety net: if the editor's buffer disagrees with the tab's text, the tab wins. `given` is text the tab
     * on screen has just been given from outside the editor, before React draws it (see replaceEditorText).
     */
    const syncEditorWithActiveTab = useCallback((given?: { content: string }) => {
        const model = editorRef.current?.getModel()
        const tab = given ?? activeTabRef.current
        const monaco = monacoRef.current
        if (!model || !tab || !monaco) return
        if (model.getValue(monaco.editor.EndOfLinePreference.LF) === normalizeEditorText(tab.content)) {
            // The same text, but another program may have changed only its line endings (the file was
            // reloaded). Take them on, or the next keystroke would save the old ones over every line.
            // The change goes on the undo stack as its own step, as VS Code does: Ctrl+Z first puts the
            // old line endings back, then undoes earlier edits. Don't use setEOL: it skips the undo
            // stack, so undoing an earlier edit would land in the wrong place and garble the text.
            const eol = lineEndingOf(tab.content)
            if (eol === null || model.getEOL() === eol) return
            suppressChangeRef.current = true
            try {
                model.pushStackElement()
                model.pushEOL(eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
                model.pushStackElement()
            } finally {
                suppressChangeRef.current = false
            }
            return
        }
        suppressChangeRef.current = true
        try {
            model.setValue(tab.content)
        } finally {
            suppressChangeRef.current = false
        }
        applyIndentation(model, tabSizeRef.current)
    }, [])

    useEffect(() => {
        syncEditorWithActiveTab()
    }, [editorPath, syncEditorWithActiveTab])

    // The tab's text can also change without the editor while the buffer stays the same: a
    // folder reopened in one go, or a tab list that looked like a rename but wasn't. Anything
    // other than the editor's own edits coming back puts the tab's text into the editor, so the
    // next keystroke can't save the old buffer over it. Edits the tab hasn't shown yet are kept.
    const activeTabId = activeTab?.id
    const activeContent = activeTab?.content
    useEffect(() => {
        if (activeTabId === undefined || activeContent === undefined) return
        const unseen = unseenEditsRef.current
        const seen = unseen.tabId === activeTabId ? unseen.texts.lastIndexOf(activeContent) : -1
        if (seen !== -1) {
            unseen.texts.splice(0, seen + 1)
            return
        }
        unseenEditsRef.current = { tabId: null, texts: [] }
        syncEditorWithActiveTab()
    }, [activeTabId, activeContent, syncEditorWithActiveTab])

    // Text a tab gets from disk (a reload) goes into the editor at once, not when the screen next draws: a
    // key pressed in between would otherwise edit the old text, and saving that would replace the file's
    // new version without asking. Only the tab on screen can be typed in; another one catches up when shown.
    const replaceEditorText = useCallback(
        (tabId: string, text: string) => {
            if (!editorRef.current?.getModel() || activeTabIdRef.current !== tabId) return
            // Whatever the editor sent before is based on the old text.
            unseenEditsRef.current = { tabId: null, texts: [] }
            // Put in exactly as the tab's text is when the screen draws, so the two ways can't differ.
            syncEditorWithActiveTab({ content: text })
        },
        [syncEditorWithActiveTab]
    )

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { replaceEditorText })
    }, [coordinator, replaceEditorText])

    // Free the buffers of tabs that are no longer open.
    useEffect(() => {
        const monaco = monacoRef.current
        if (!monaco) return
        const liveKeys = new Set(modelKeys.keys.values())
        const attached = editorRef.current?.getModel()
        for (const model of monaco.editor.getModels()) {
            const uri = model.uri.toString()
            if (model !== attached && isModelKey(uri) && !liveKeys.has(uri)) model.dispose()
        }
    }, [modelKeys])

    useEffect(() => {
        return () => {
            const monaco = monacoRef.current
            if (!monaco) return
            for (const model of monaco.editor.getModels()) {
                if (isModelKey(model.uri.toString())) model.dispose()
            }
        }
    }, [])

    const onMonacoMount = useCallback(
        (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
            editorRef.current = editor
            monacoRef.current = monaco
            // Closing the last tab throws the editor away. Forget it, so a search hit picked
            // before the next one is ready waits for it instead of going to the old one.
            editor.onDidDispose(() => {
                if (editorRef.current === editor) editorRef.current = null
                setEditorFocused(false)
            })
            editor.onDidFocusEditorText(() => {
                setEditorFocused(true)
                showHintAgain()
            })
            editor.onDidBlurEditorText(() => setEditorFocused(false))
            applyCurrentTheme(monaco)
            // Monaco measures character widths once; measure again when the app font has loaded,
            // or the cursor and selection drift away from the text.
            document.fonts
                ?.load(`16px ${fontFamily}`)
                .then(() => monaco.editor.remeasureFonts())
                .catch(() => {})
            const paletteBinding = bindEditorCommandPaletteToApp(editor, monaco, () => openPaletteRef.current?.())
            editor.onDidDispose(() => paletteBinding.dispose())
            const spelling = attachEditorSpellcheck(editor, monaco)
            editor.onDidDispose(() => spelling.dispose())
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
        [syncEditorWithActiveTab, applyCurrentTheme, fontFamily, focusPendingTab, showHintAgain, attachEditorSpellcheck]
    )

    useEffect(() => {
        const monaco = monacoRef.current
        if (monaco) applyCurrentTheme(monaco)
    }, [tokens, isLight, applyCurrentTheme])

    return (
        <div
            ref={rootRef}
            data-slot="code-editor"
            className={cn(
                'flex h-full shrink-0 flex-col border-r border-border bg-code',
                // Hidden at full size and out of the way of the preview. Shrunk to nothing, Monaco
                // would lay out and wrap the whole file one character per line on every hide,
                // show and tab switch.
                open ? 'relative' : 'invisible absolute inset-y-0 left-0'
            )}
            style={{ width: shownWidth }}
            inert={!open}
        >
            <ReadOnlyReasonBar />
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
                        onChange={isReadOnly ? undefined : onEditorChange}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                        Select a file from the explorer or create a new file.
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
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor"
                aria-valuenow={shownWidth}
                aria-valuemin={minEditorWidth(availableWidth)}
                aria-valuemax={maxEditorWidth(availableWidth)}
                aria-valuetext={`${shownWidth} pixels wide`}
                tabIndex={0}
                className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none hover:bg-ring/30 focus-visible:bg-ring/60
                    active:bg-ring/50"
                onKeyDown={onResizeKeyDown}
                onDoubleClick={onResetWidth}
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onLostPointerCapture={endResize}
            />
        </div>
    )
}
