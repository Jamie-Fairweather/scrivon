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

const MIN_WIDTH = 280
const MAX_WIDTH_RATIO = 0.6

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
        horizontal: 'hidden',
        useShadows: false,
        verticalScrollbarSize: 10,
    },
}

type CodeEditorPanelProps = {
    /** When false the panel is hidden but stays mounted, so undo history and scroll survive. */
    open?: boolean
    width: number
    onWidthChange: (width: number) => void
}

function clampWidth(width: number) {
    const maxWidth = typeof window !== 'undefined' ? window.innerWidth * MAX_WIDTH_RATIO : 800
    return Math.min(maxWidth, Math.max(MIN_WIDTH, width))
}

function languageForTab(tab: DocumentTab) {
    if (tab.readOnly) return 'markdown'
    const kind = documentKind(tab.name)
    return kind === 'markdown' || kind === 'mermaid' ? 'markdown' : 'plaintext'
}

export function CodeEditorPanel({ open = true, width, onWidthChange }: CodeEditorPanelProps) {
    const { isLight, tokens } = useAppTheme()
    const { settings } = useAppSettings()
    const { tabs, activeTab, updateTabContent } = useDocumentTabs()
    const coordinator = useWorkspaceCoordinator()
    const resizeStart = useRef({ x: 0, width: 0 })
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

    const onResizePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault()
            resizeStart.current = { x: e.clientX, width }
            e.currentTarget.setPointerCapture(e.pointerId)

            const onMove = (moveEvent: PointerEvent) => {
                const delta = moveEvent.clientX - resizeStart.current.x
                onWidthChange(clampWidth(resizeStart.current.width + delta))
            }

            const onUp = () => {
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
            }

            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
        },
        [width, onWidthChange]
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
        <div className={cn('relative flex h-full shrink-0 flex-col border-r border-border bg-code', !open && 'hidden')} style={{ width }}>
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

            <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize editor"
                className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-ring/30 active:bg-ring/50"
                onPointerDown={onResizePointerDown}
            />
        </div>
    )
}
