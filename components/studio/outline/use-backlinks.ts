'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { OpenFileText } from '@/components/studio/command-palette/search-content'
import { isPathInside } from '@/components/studio/markdown/markdown-links'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { createLinksReader, type LinksReader } from '@/lib/markdown/links-reader'
import { comparablePath, readStamp, readWorkspaceFile } from '@/lib/tauri/fs'
import { createBacklinksMemo, createBacklinksScanner, scanBacklinks, type BacklinksResult, type BacklinksScanner } from '@/lib/workspace/backlinks'
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

type ScanInput = { target: string; index: WikiIndex; tabs: readonly OpenFileText[]; diskCheck: number }

/** The Markdown tabs' texts other than the target's own: the only tabs whose text can change its list. */
function otherNoteTexts(tabs: readonly DocumentTab[], target: string | null): OpenFileText[] {
    const own = target === null ? null : comparablePath(target)
    return tabs
        .filter((tab) => documentKind(tab.name) === 'markdown' && comparablePath(tab.path) !== own)
        .map((tab) => ({ path: tab.path, content: tab.content }))
}

function sameTexts(a: readonly OpenFileText[], b: readonly OpenFileText[]): boolean {
    return a.length === b.length && a.every((text, at) => text.path === b[at]!.path && text.content === b[at]!.content)
}

/**
 * The wiki links in the open folder's other notes that lead to the Markdown file showing (scanBacklinks). Worked out
 * again, once changes pause, when another file shows, the folder's files change, another note's tab text changes
 * (saved or not) or a file changes on disk. Typing in the file itself, or in a diagram, never starts a scan. Only a
 * change to the folder or on disk asks the disk about every note again; otherwise the notes that aren't in tabs come
 * from what earlier scans learnt. A change stops the scan in progress, and only the newest list shows. The notes are
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

    // Kept the same while those texts are, so a keystroke anywhere else doesn't ask for a scan.
    const latestTexts = otherNoteTexts(tabs, target)
    const [otherTexts, setOtherTexts] = useState(latestTexts)
    if (!sameTexts(otherTexts, latestTexts)) setOtherTexts(latestTexts)

    useEffect(() => subscribeWorkspaceDiskChanges(() => setDiskVersion((version) => version + 1)), [])

    // A new disk check each time the folder's files, or a file on disk, may have changed (see scanBacklinks).
    const diskCheckRef = useRef(0)
    useEffect(() => {
        diskCheckRef.current += 1
    }, [index, diskVersion])

    const scannerRef = useRef<BacklinksScanner<ScanInput> | null>(null)
    useEffect(() => {
        let reader: LinksReader | null = null
        const memo = createBacklinksMemo()
        const scanner = createBacklinksScanner<ScanInput>(
            (input, signal) =>
                scanBacklinks({
                    target: input.target,
                    index: input.index,
                    diskCheck: input.diskCheck,
                    openTexts: input.tabs,
                    readLinks: async (text, path) => {
                        reader ??= createLinksReader()
                        return (await reader.read(text, path)).wikiLinks
                    },
                    readFile: readWorkspaceFile,
                    getFileStamp: readStamp,
                    memo,
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
        scanner.request({ target, index, tabs: otherTexts, diskCheck: diskCheckRef.current })
    }, [target, index, otherTexts, diskVersion])

    if (!isMarkdown) return { kind: 'none' }
    if (!inFolder || target === null) return { kind: 'no-folder' }
    // Another file's list never shows for this one.
    return result && result.target === target ? { kind: 'ready', result } : { kind: 'loading' }
}
