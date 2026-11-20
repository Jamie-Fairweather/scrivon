'use client'

import { useEffect, useMemo } from 'react'
import { isPathInside } from '@/components/studio/markdown/markdown-links'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isExampleTabId } from '@/lib/examples/example-tab'
import { registerWikiLinkSource } from '@/lib/monaco/wiki-link-completion'
import { wikiIndexFor } from '@/lib/workspace/wiki-link-lookup'
import type { DocumentTab } from '@/lib/workspace/types'

/**
 * Tells the editor's wiki-link suggestions (lib/monaco/wiki-link-completion.ts) which notes the open folder has and
 * which file is being edited, as the preview and the explorer see them. No notes for a file outside the folder.
 */
export function useWikiLinkSource(activeTab: DocumentTab | null): void {
    const { workspaceRoot, tree } = useWorkspaceSession()
    const documentPath = activeTab && !isExampleTabId(activeTab.id) ? activeTab.path : null
    const inFolder = documentPath !== null && workspaceRoot !== null && isPathInside(documentPath, workspaceRoot)
    const index = useMemo(() => (inFolder && workspaceRoot ? wikiIndexFor(workspaceRoot, tree ?? []) : null), [inFolder, workspaceRoot, tree])
    useEffect(() => registerWikiLinkSource({ index, documentPath }), [index, documentPath])
}
