'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { MONACO_DIAGRAM_THEME_ID, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { unbindEditorF1Command } from '@/lib/monaco/editor-keybindings'
import { readEditorSelectedText } from '@/lib/monaco/editor-selection'
import { useDocumentTabs, useWorkspaceCoordinator } from '@/components/studio/workspace/workspace-provider'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import { documentKind } from '@/lib/tauri/fs'
import type { DocumentTab } from '@/lib/workspace/types'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

const MIN_WIDTH = 280
const MAX_WIDTH_RATIO = 0.6

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
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
    scrollbar: {
        vertical: 'auto',
        horizontal: 'hidden',
        useShadows: false,
        verticalScrollbarSize: 10,
    },
}

type CodeEditorPanelProps = {
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

export function CodeEditorPanel({ width, onWidthChange }: CodeEditorPanelProps) {
    const { isLight, tokens } = useAppTheme()
    const { activeTab, updateTabContent } = useDocumentTabs()
    const coordinator = useWorkspaceCoordinator()
    const resizeStart = useRef({ x: 0, width: 0 })
    const monacoRef = useRef<Monaco | null>(null)
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
    const activeTabIdRef = useRef<string | null>(null)
    const pendingRevealRef = useRef<{ path: string; line: number; column: number } | null>(null)

    useEffect(() => {
        activeTabIdRef.current = activeTab?.id ?? null
    }, [activeTab?.id])

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
            const id = activeTabIdRef.current
            if (!id) return
            updateTabContent(id, value ?? '')
        },
        [updateTabContent]
    )

    const editorPath = activeTab?.path
    const isReadOnly = activeTab?.readOnly ?? false
    const editorLanguage = useMemo(() => (activeTab ? languageForTab(activeTab) : 'plaintext'), [activeTab])
    const editorDefaultValue = activeTab?.content
    const editorOptions = useMemo(() => ({ ...EDITOR_OPTIONS, readOnly: isReadOnly, domReadOnly: isReadOnly }), [isReadOnly])

    const onMonacoBeforeMount = useCallback(
        (monaco: Monaco) => {
            monacoRef.current = monaco
            defineMonacoDiagramTheme(monaco, tokens, isLight)
        },
        [tokens, isLight]
    )

    const onMonacoMount = useCallback((editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
        editorRef.current = editor
        unbindEditorF1Command(editor, monaco)
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
    }, [])

    useEffect(() => {
        const monaco = monacoRef.current
        if (!monaco) return
        defineMonacoDiagramTheme(monaco, tokens, isLight)
        monaco.editor.setTheme(MONACO_DIAGRAM_THEME_ID)
    }, [tokens, isLight])

    return (
        <div className="relative flex h-full shrink-0 flex-col border-r border-border bg-code" style={{ width }}>
            <div className="min-h-0 flex-1 overflow-hidden bg-code">
                {editorPath ? (
                    <MonacoEditor
                        path={editorPath}
                        defaultValue={editorDefaultValue}
                        language={editorLanguage}
                        theme={MONACO_DIAGRAM_THEME_ID}
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
