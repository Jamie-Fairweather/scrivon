'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createContentCache, type OpenFileText } from '@/components/studio/command-palette/search-content'
import { isPathInside } from '@/components/studio/markdown/markdown-links'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { createLinksReader, type LinksReader } from '@/lib/markdown/links-reader'
import { readStamp, readWorkspaceFile } from '@/lib/tauri/fs'
import { createBacklinksScanner, scanBacklinks, type BacklinksResult, type BacklinksScanner, type ParsedLinksCache } from '@/lib/workspace/backlinks'
import { subscribeWorkspaceDiskChanges } from '@/lib/workspace/disk-changes'
import { documentKind } from '@/lib/workspace/file-types'
import type { DocumentTab } from '@/lib/workspace/types'
import { wikiIndexFor, type WikiIndex } from '@/lib/workspace/wiki-link-lookup'

/**
 * - `none`: no Markdown file is showing.
 * - `no-folder`: it isn't in an open folder (an example, or a file opened on its own), so there's nowhere to look.
 * - `loading`: the first list for this file is still being worked out.
 * - `ready`: the list.
 */
export type BacklinksState = { kind: 'none' } | { kind: 'no-folder' } | { kind: 'loading' } | { kind: 'ready'; result: BacklinksResult }

type ScanInput = { target: string; index: WikiIndex; tabs: readonly OpenFileText[] }

/**
 * The wiki links in the open folder's other notes that lead to the Markdown file showing (scanBacklinks). Worked out
 * again, once changes pause, when another file shows, the folder's files change, a tab's text changes (saved or not)
 * or a file changes on disk. A change stops the scan in progress, and only the newest list shows. The notes are
 * parsed in a worker of their own, so the link check's never waits for them.
 */
export function useBacklinks(activeTab: DocumentTab | null): BacklinksState {
    const { workspaceRoot, tree } = useWorkspaceSession()
    const { tabs } = useDocumentTabs()
    const isMarkdown = activeTab !== null && documentKind(activeTab.name) === 'markdown'
    const target = isMarkdown && !isExampleTabId(activeTab.id) ? activeTab.path : null
    const inFolder = target !== null && workspaceRoot !== null && isPathInside(target, workspaceRoot)
    const index = useMemo(() => (inFolder && workspaceRoot ? wikiIndexFor(workspaceRoot, tree ?? []) : null), [inFolder, workspaceRoot, tree])
    const [result, setResult] = useState<BacklinksResult | null>(null)
    const [diskVersion, setDiskVersion] = useState(0)

    useEffect(() => subscribeWorkspaceDiskChanges(() => setDiskVersion((version) => version + 1)), [])

    const scannerRef = useRef<BacklinksScanner<ScanInput> | null>(null)
    useEffect(() => {
        let reader: LinksReader | null = null
        const cache = createContentCache()
        const parsed: ParsedLinksCache = new Map()
        const scanner = createBacklinksScanner<ScanInput>(
            (input, signal) =>
                scanBacklinks({
                    ...input,
                    openTexts: input.tabs,
                    readLinks: async (text, path) => {
                        reader ??= createLinksReader()
                        return (await reader.read(text, path)).wikiLinks
                    },
                    readFile: readWorkspaceFile,
                    getFileStamp: readStamp,
                    cache,
                    parsed,
                    signal,
                }),
            setResult
        )
        scannerRef.current = scanner
        return () => {
            scanner.cancel()
            reader?.dispose()
            scannerRef.current = null
        }
    }, [])

    useEffect(() => {
        const scanner = scannerRef.current
        if (!scanner) return
        if (target === null || index === null) {
            scanner.cancel()
            return
        }
        scanner.request({ target, index, tabs })
    }, [target, index, tabs, diskVersion])

    if (!isMarkdown) return { kind: 'none' }
    if (!inFolder || target === null) return { kind: 'no-folder' }
    // Another file's list never shows for this one.
    return result && result.target === target ? { kind: 'ready', result } : { kind: 'loading' }
}
