'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DiffBeforeMount, Monaco } from '@monaco-editor/react'
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
            options={options}
        />
    )
}
