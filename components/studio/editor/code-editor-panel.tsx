'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { MONACO_DIAGRAM_THEME_ID, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { editorAriaLabel } from '@/lib/monaco/editor-aria'
import { unbindEditorF1Command } from '@/lib/monaco/editor-keybindings'
import { readEditorSelectedText } from '@/lib/monaco/editor-selection'
import { EMPTY_MODEL_KEYS, isModelKey, normalizeEditorText, samePaths, syncModelKeys } from '@/lib/monaco/model-keys'
import { useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import { MIN_EDITOR_WIDTH, clampEditorWidth, maxEditorWidth } from '@/components/studio/editor/editor-width'
import { documentKind } from '@/lib/tauri/fs'
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

const BASE_EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    overviewRulerLanes: 0,
    overviewRulerBorder: false,
    hideCursorInOverviewRuler: true,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    wordWrap: 'on',
    automaticLayout: true,
    padding: { top: 12 },
    scrollBeyondLastLine: false,
    fontSize: 13,
    lineNumbers: 'on',
    renderLineHighlight: 'all',
    tabSize: 2,
    // Monaco's defaults are for source code: they box ordinary Cyrillic, Greek and CJK
    // letters and punctuation, curly quotes and en dashes. Off, as in VS Code for Markdown.
    unicodeHighlight: {
        ambiguousCharacters: false,
        invisibleCharacters: false,
        nonBasicASCII: false,
    },
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
    const resizeDragRef = useRef<{ pointerId: number; startX: number; startWidth: number; available: number; width: number } | null>(null)
    const rootRef = useRef<HTMLDivElement>(null)
    const [rowWidth, setRowWidth] = useState(0)
    const monacoRef = useRef<Monaco | null>(null)
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
    const activeTabIdRef = useRef<string | null>(null)
    const activeTabRef = useRef<DocumentTab | null>(null)
    const suppressChangeRef = useRef(false)
    const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null)

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

    const revealPosition = useCallback((path: string, line: number, column: number) => {
        const editor = editorRef.current
        const activePath = activeTabIdRef.current

        if (!editor || activePath !== path) {
            pendingRevealRef.current = { path, line, column }
            return
        }

        const position = { lineNumber: line, column }
        editor.revealPositionInCenter(position)
        editor.setSelection({
            startLineNumber: line,
            startColumn: column,
            endLineNumber: line,
            endColumn: column,
        })
        editor.focus()
        pendingRevealRef.current = null
    }, [])

    const getEditorSelectedText = useCallback(() => readEditorSelectedText(editorRef.current), [])

    useEffect(() => {
        registerCoordinatorRefs(coordinator, { revealInEditor: revealPosition, getEditorSelectedText })
    }, [coordinator, revealPosition, getEditorSelectedText])

    useEffect(() => {
        const pending = pendingRevealRef.current
        if (!pending || activeTab?.path !== pending.path || !editorRef.current) return
        revealPosition(pending.path, pending.line, pending.column)
    }, [activeTab?.path, revealPosition])

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
            else if (e.key === 'Home') next = MIN_EDITOR_WIDTH
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
            updateTabContent(id, value ?? '')
        },
        [updateTabContent]
    )

    const editorPath = activeTab ? modelKeys.keys.get(activeTab.path) : undefined
    const isReadOnly = activeTab?.readOnly ?? false
    const editorLanguage = useMemo(() => (activeTab ? languageForTab(activeTab) : 'plaintext'), [activeTab])
    const editorDefaultValue = activeTab?.content
    const activeName = activeTab?.name
    // Zero-width characters silently break Mermaid parsing, so show them in diagram files.
    const isMermaid = activeName !== undefined && documentKind(activeName) === 'mermaid'
    const ariaLabel = useMemo(
        () => editorAriaLabel(activeName !== undefined ? { name: activeName, readOnly: isReadOnly } : null, isMacPlatform()),
        [activeName, isReadOnly]
    )
    const editorOptions = useMemo(
        () => ({
            ...BASE_EDITOR_OPTIONS,
            fontSize: settings.editor.fontSize,
            tabSize: settings.editor.tabSize,
            wordWrap: settings.editor.wordWrap,
            lineNumbers: settings.editor.lineNumbers,
            minimap: { enabled: settings.editor.minimap },
            readOnly: isReadOnly,
            domReadOnly: isReadOnly,
            ariaLabel,
            unicodeHighlight: { ...BASE_EDITOR_OPTIONS.unicodeHighlight, invisibleCharacters: isMermaid },
        }),
        [settings.editor, isReadOnly, ariaLabel, isMermaid]
    )

    useEffect(() => {
        editorRef.current?.updateOptions({
            fontSize: settings.editor.fontSize,
            tabSize: settings.editor.tabSize,
            wordWrap: settings.editor.wordWrap,
            lineNumbers: settings.editor.lineNumbers,
            minimap: { enabled: settings.editor.minimap },
        })
    }, [settings.editor])

    const onMonacoBeforeMount = useCallback(
        (monaco: Monaco) => {
            monacoRef.current = monaco
            defineMonacoDiagramTheme(monaco, tokens, isLight)
        },
        [tokens, isLight]
    )

    /** Safety net: if the editor's buffer disagrees with the tab's text, the tab wins. */
    const syncEditorWithActiveTab = useCallback(() => {
        const model = editorRef.current?.getModel()
        const tab = activeTabRef.current
        const monaco = monacoRef.current
        if (!model || !tab || !monaco) return
        if (model.getValue(monaco.editor.EndOfLinePreference.LF) === normalizeEditorText(tab.content)) return
        suppressChangeRef.current = true
        try {
            model.setValue(tab.content)
        } finally {
            suppressChangeRef.current = false
        }
    }, [])

    useEffect(() => {
        syncEditorWithActiveTab()
    }, [editorPath, syncEditorWithActiveTab])

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
            unbindEditorF1Command(editor, monaco)
            syncEditorWithActiveTab()
            const pending = pendingRevealRef.current
            if (pending && activeTabIdRef.current === pending.path) {
                const position = { lineNumber: pending.line, column: pending.column }
                editor.revealPositionInCenter(position)
                editor.setSelection({
                    startLineNumber: pending.line,
                    startColumn: pending.column,
                    endLineNumber: pending.line,
                    endColumn: pending.column,
                })
                editor.focus()
                pendingRevealRef.current = null
            }
        },
        [syncEditorWithActiveTab]
    )

    useEffect(() => {
        const monaco = monacoRef.current
        if (!monaco) return
        defineMonacoDiagramTheme(monaco, tokens, isLight)
        monaco.editor.setTheme(MONACO_DIAGRAM_THEME_ID)
    }, [tokens, isLight])

    return (
        <div
            ref={rootRef}
            data-slot="code-editor"
            className={cn('relative flex h-full shrink-0 flex-col border-r border-border bg-code', !open && 'hidden')}
            style={{ width: shownWidth }}
        >
            <div className="min-h-0 flex-1 overflow-hidden bg-code">
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
            </div>

            {/* Straddles the border and sits above Monaco's scrollbar (z-index 11), so it can be
                grabbed from the text side too. */}
            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor"
                aria-valuenow={shownWidth}
                aria-valuemin={MIN_EDITOR_WIDTH}
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
