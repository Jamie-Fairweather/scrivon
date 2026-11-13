'use client'

import type { Monaco } from '@monaco-editor/react'
import type { IDisposable, editor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { attachSpellcheck, type SpellcheckConfig, type SpellcheckSession } from '@/lib/monaco/spellcheck'
import { getSpellcheckClient } from '@/lib/spellcheck/spellcheck-client'
import { withDictionaryWord } from '@/lib/spellcheck/spellcheck-settings'
import { documentKind } from '@/lib/workspace/file-types'
import type { DocumentTab } from '@/lib/workspace/types'

/**
 * Spell checks the Markdown file the editor shows, when it can be edited and spelling is on in Settings.
 * Returns the function that hooks it up to the editor once Monaco has made it; dispose what it returns
 * with the editor.
 */
export function useEditorSpellcheck(activeTab: DocumentTab | null, modelUri: string | undefined) {
    const { settings, updateSettings } = useAppSettings()
    const { enabled, language, words } = settings.spellcheck
    const checkable = enabled && activeTab !== null && !activeTab.readOnly && documentKind(activeTab.name) === 'markdown'
    const config = useMemo<SpellcheckConfig | null>(
        () => (checkable && modelUri ? { modelUri, language, words } : null),
        [checkable, modelUri, language, words]
    )

    const configRef = useRef(config)
    const sessionRef = useRef<SpellcheckSession | null>(null)
    useEffect(() => {
        configRef.current = config
        sessionRef.current?.setConfig(config)
    }, [config])

    const addWord = useCallback(
        (word: string) =>
            updateSettings((current) => ({
                ...current,
                spellcheck: { ...current.spellcheck, words: withDictionaryWord(current.spellcheck.words, word) },
            })),
        [updateSettings]
    )
    const addWordRef = useRef(addWord)
    useEffect(() => {
        addWordRef.current = addWord
    }, [addWord])

    return useCallback((editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco): IDisposable => {
        const session = attachSpellcheck(
            editorInstance,
            monaco,
            { client: getSpellcheckClient(), addWord: (word) => addWordRef.current(word) },
            configRef.current
        )
        sessionRef.current = session
        return {
            dispose: () => {
                session.dispose()
                if (sessionRef.current === session) sessionRef.current = null
            },
        }
    }, [])
}
