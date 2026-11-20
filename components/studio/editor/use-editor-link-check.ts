'use client'

import type { Monaco } from '@monaco-editor/react'
import type { IDisposable, editor } from 'monaco-editor'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { openTabText } from '@/components/studio/command-palette/search-content'
import { isPathInside } from '@/components/studio/markdown/markdown-links'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { getLinksReader } from '@/lib/markdown/links-reader'
import { attachLinkCheck, type LinkCheckConfig, type LinkCheckSession } from '@/lib/monaco/link-check'
import { documentKind } from '@/lib/workspace/file-types'
import { buildLinkIndex } from '@/lib/workspace/link-index'
import { wikiIndexFor } from '@/lib/workspace/wiki-link-lookup'
import type { DocumentTab } from '@/lib/workspace/types'

/**
 * Checks the links of the Markdown file the editor shows, when it can be edited and Check links is on in Settings
 * (never in a read-only or example tab, as with spell check). `attach` hooks it up to the editor once Monaco has made
 * it; dispose what it returns with the editor.
 */
export function useEditorLinkCheck(activeTab: DocumentTab | null, modelUri: string | undefined) {
    const { settings } = useAppSettings()
    const enabled = settings.editor.checkLinks
    const { tree, workspaceRoot } = useWorkspaceSession()
    const { tabs } = useDocumentTabs()

    // The tabs' text changes with every key, so it is read when a check needs it rather than starting a check.
    const tabsRef = useRef(tabs)
    useEffect(() => {
        tabsRef.current = tabs
    }, [tabs])
    const openText = useCallback((path: string) => openTabText(tabsRef.current, path), [])

    const checkable =
        enabled && activeTab !== null && !activeTab.readOnly && !isExampleTabId(activeTab.id) && documentKind(activeTab.name) === 'markdown'
    const documentPath = activeTab?.path ?? null
    // Built once each time the tree changes while links are checked, so checking a link is a lookup, never a walk
    // of the tree; and not at all while nothing is checked (a diagram showing, or the setting off).
    const index = useMemo(() => (checkable && workspaceRoot ? buildLinkIndex(workspaceRoot, tree ?? []) : null), [checkable, workspaceRoot, tree])
    // Wiki links are found in the open folder, as the preview finds them: only for a file inside it.
    const inFolder = documentPath !== null && workspaceRoot !== null && isPathInside(documentPath, workspaceRoot)
    const wikiIndex = useMemo(
        () => (checkable && inFolder && workspaceRoot ? wikiIndexFor(workspaceRoot, tree ?? []) : null),
        [checkable, inFolder, workspaceRoot, tree]
    )
    const config = useMemo<LinkCheckConfig | null>(
        () => (checkable && modelUri ? { modelUri, documentPath, workspaceRoot, index, wikiIndex, openText } : null),
        [checkable, modelUri, documentPath, workspaceRoot, index, wikiIndex, openText]
    )

    const configRef = useRef(config)
    const sessionRef = useRef<LinkCheckSession | null>(null)
    useEffect(() => {
        configRef.current = config
        // From an effect, after the editor has been told it can be edited, so Monaco sets Ctrl+. up (see setConfig).
        sessionRef.current?.setConfig(config)
    }, [config])

    const attach = useCallback((editorInstance: editor.IStandaloneCodeEditor, monaco: Monaco): IDisposable => {
        const session = attachLinkCheck(editorInstance, monaco, { reader: getLinksReader() }, configRef.current)
        sessionRef.current = session
        return {
            dispose: () => {
                session.dispose()
                if (sessionRef.current === session) sessionRef.current = null
            },
        }
    }, [])

    return attach
}
