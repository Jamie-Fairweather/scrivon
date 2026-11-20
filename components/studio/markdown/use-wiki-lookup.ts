'use client'

import { useCallback, useMemo } from 'react'
import { isPathInside } from '@/components/studio/markdown/markdown-links'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { resolveWikiTarget, wikiIndexFor, type WikiLookup } from '@/lib/workspace/wiki-link-lookup'

/** Which note a wiki link in the document at `documentPath` leads to, or why it leads nowhere. */
export type WikiLinkLookup = (target: string) => WikiLookup | { kind: 'no-folder' }

/**
 * Looks up the notes the wiki links in a document lead to, in the same file list the explorer shows. A document
 * outside the open folder (an example, a file opened on its own) has nowhere to look. Changes when the folder's files
 * do, so the links' looks can follow.
 */
export function useWikiLinkLookup(documentPath: string | null): WikiLinkLookup {
    const { workspaceRoot, tree } = useWorkspaceSession()
    const inFolder = documentPath !== null && workspaceRoot !== null && isPathInside(documentPath, workspaceRoot)
    const index = useMemo(() => (inFolder && workspaceRoot ? wikiIndexFor(workspaceRoot, tree ?? []) : null), [inFolder, workspaceRoot, tree])
    return useCallback((target) => (index ? resolveWikiTarget(index, target, documentPath) : { kind: 'no-folder' }), [index, documentPath])
}
