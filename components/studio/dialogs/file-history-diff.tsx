'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DiffBeforeMount, DiffOnMount, Monaco, MonacoDiffEditor as DiffEditorInstance } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { MERMAID_LANGUAGE_ID } from '@/lib/monaco/mermaid-language'
import { MONACO_DIAGRAM_THEME_ID, defineMonacoDiagramTheme } from '@/lib/theme/monaco-theme'
import { documentKind } from '@/lib/tauri/fs'

function DiffLoading() {
    return <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">Loading the comparison…</div>
}

// Monaco is bundled with the app (lib/monaco/setup-monaco.ts) and only loaded in the browser, as for the editor.
const MonacoDiffEditor = dynamic(
    async () => {
        await import('@/lib/monaco/setup-monaco')
        return (await import('@monaco-editor/react')).DiffEditor
    },
    { ssr: false, loading: () => <DiffLoading /> }
)

/**
 * Takes the two texts out of the diff editor, then disposes them. In that order: Monaco reports a text disposed
 * while its diff editor still shows it as a bug ("TextModel got disposed before DiffEditorWidget model got
 * reset"), thrown from a timer, which the app's error reporter would show as "Something went wrong". So
 * @monaco-editor/react is told to keep its models (keepCurrent…Model) and they are let go here instead.
 * `models` are the texts it was given, for when the editor was already disposed and can no longer say.
 */
export function releaseDiffModels(diffEditor: DiffEditorInstance, models: editor.IDiffEditorModel | null): void {
    let current: editor.IDiffEditorModel | null = null
    try {
        current = diffEditor.getModel()
        diffEditor.setModel(null)
    } catch {
        // Already disposed, which let go of the texts as well.
    }
    for (const model of new Set([current?.original, current?.modified, models?.original, models?.modified])) {
        if (model && !model.isDisposed()) model.dispose()
    }
}

type FileHistoryDiffProps = {
    /** The file's name, for the language its text is coloured as. */
    fileName: string
    /** The kept version, on the left. */
    original: string
    /** The text in the editor now, on the right. */
    modified: string
    /** Screen reader names of the two sides. */
    originalLabel: string
    modifiedLabel: string
}

/**
 * A read-only comparison of a kept version with the editor's text, in Monaco's diff editor and the app's own
 * light or dark colours. Its accessible diff viewer (F7 and Shift+F7) reads each change out.
 */
export function FileHistoryDiff({ fileName, original, modified, originalLabel, modifiedLabel }: FileHistoryDiffProps) {
    const { isLight, tokens } = useAppTheme()
    const { settings } = useAppSettings()
    const language = documentKind(fileName) === 'mermaid' ? MERMAID_LANGUAGE_ID : 'markdown'

    // Read when Monaco loads, so a theme changed meanwhile is the one it starts in.
    const themeRef = useRef({ tokens, isLight })
    const monacoRef = useRef<Monaco | null>(null)
    useEffect(() => {
        themeRef.current = { tokens, isLight }
        const monaco = monacoRef.current
        if (!monaco) return
        defineMonacoDiagramTheme(monaco, tokens, isLight)
        monaco.editor.setTheme(MONACO_DIAGRAM_THEME_ID)
    }, [tokens, isLight])

    const beforeMount = useCallback<DiffBeforeMount>((monaco) => {
        monacoRef.current = monaco
        defineMonacoDiagramTheme(monaco, themeRef.current.tokens, themeRef.current.isLight)
    }, [])

    const mounted = useRef<{ diffEditor: DiffEditorInstance; models: editor.IDiffEditorModel | null } | null>(null)
    const onMount = useCallback<DiffOnMount>((diffEditor) => {
        mounted.current = { diffEditor, models: diffEditor.getModel() }
    }, [])
    // On unmount React cleans up a parent's effects before its children's, so this normally runs before
    // @monaco-editor/react disposes the editor. releaseDiffModels copes with the other order too.
    useEffect(
        () => () => {
            const current = mounted.current
            mounted.current = null
            if (current) releaseDiffModels(current.diffEditor, current.models)
        },
        []
    )

    const options = useMemo<editor.IDiffEditorConstructionOptions>(
        () => ({
            readOnly: true,
            domReadOnly: true,
            originalEditable: false,
            originalAriaLabel: originalLabel,
            modifiedAriaLabel: modifiedLabel,
            renderSideBySide: true,
            // Side by side needs room; a narrow window shows the changes one under the other.
            useInlineViewWhenSpaceIsLimited: true,
            automaticLayout: true,
            minimap: { enabled: false },
            renderOverviewRuler: false,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            diffWordWrap: 'on',
            fontSize: settings.editor.fontSize,
            lineNumbers: settings.editor.lineNumbers,
            contextmenu: false,
            unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
            unusualLineTerminators: 'off',
        }),
        [originalLabel, modifiedLabel, settings.editor.fontSize, settings.editor.lineNumbers]
    )

    return (
        <MonacoDiffEditor
            original={original}
            modified={modified}
            language={language}
            theme={MONACO_DIAGRAM_THEME_ID}
            loading={<DiffLoading />}
            beforeMount={beforeMount}
            onMount={onMount}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={options}
        />
    )
}
