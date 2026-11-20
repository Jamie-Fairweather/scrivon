'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { createEditorPreviewSync, editorPreviewSync, type EditorPreviewSync } from '@/components/studio/markdown/editor-preview-sync'
import { useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import { FIRST_GROUP_ID } from '@/lib/workspace/editor-groups'
import type { DocumentTab } from '@/lib/workspace/types'

/** One editor group as its own tab strip, editor and preview see it. */
export type EditorGroupView = {
    /** Where the group is, left (0) or right (1). */
    index: number
    /** Stays the same while the group is open (see EditorGroup). */
    id: string
    /** How many groups there are. */
    count: number
    /** True for the group last clicked or typed in. */
    focused: boolean
    /** "left group" or "right group" while the editor is split, for screen readers; '' with one group. */
    label: string
    /** The group's tabs, in strip order. */
    tabs: readonly DocumentTab[]
    /** The tab the group shows. */
    tab: DocumentTab | null
    /** Links this group's editor and Markdown preview (each group scrolls on its own). */
    previewSync: EditorPreviewSync
}

const EditorGroupContext = createContext<EditorGroupView | null>(null)
const PreviewSyncContext = createContext<EditorPreviewSync | null>(null)

/** What screen readers hear for a group, while there are two. */
export function groupLabel(index: number, count: number): string {
    if (count < 2) return ''
    return index === 0 ? 'left group' : 'right group'
}

/** Gives the editor, tab strip and preview inside it the group at `index`. */
export function EditorGroupProvider({ index, children }: { index: number; children: ReactNode }) {
    const { tabs, groups } = useDocumentTabs()
    const group = groups.groups[index]
    // Each group's own link between its editor and preview, kept for as long as the group is open.
    const [previewSync] = useState(createEditorPreviewSync)
    const count = groups.groups.length
    const focused = groups.focused === index
    const tabIds = group?.tabIds
    const activeTabId = group?.activeTabId ?? null
    const groupTabs = useMemo(() => {
        const byId = new Map(tabs.map((t) => [t.id, t]))
        return (tabIds ?? []).flatMap((id) => byId.get(id) ?? [])
    }, [tabIds, tabs])
    const tab = useMemo(() => groupTabs.find((t) => t.id === activeTabId) ?? null, [groupTabs, activeTabId])
    const value = useMemo<EditorGroupView>(
        () => ({ index, id: group?.id ?? FIRST_GROUP_ID, count, focused, label: groupLabel(index, count), tabs: groupTabs, tab, previewSync }),
        [index, group?.id, count, focused, groupTabs, tab, previewSync]
    )
    return (
        <EditorGroupContext.Provider value={value}>
            <PreviewSyncContext.Provider value={previewSync}>{children}</PreviewSyncContext.Provider>
        </EditorGroupContext.Provider>
    )
}

/**
 * The editor group the caller is in. Outside one (a part of the screen shown once, or a test of one pane), the whole
 * editor area as one group: every tab, showing the current one.
 */
export function useEditorGroup(): EditorGroupView {
    const group = useContext(EditorGroupContext)
    const { tabs, activeTab } = useDocumentTabs()
    const fallback = useMemo<EditorGroupView>(
        () => ({ index: 0, id: FIRST_GROUP_ID, count: 1, focused: true, label: '', tabs, tab: activeTab, previewSync: editorPreviewSync }),
        [tabs, activeTab]
    )
    return group ?? fallback
}

/** The link between the editor and the Markdown preview of the caller's group; the only one outside a group. */
export function useGroupPreviewSync(): EditorPreviewSync {
    return useContext(PreviewSyncContext) ?? editorPreviewSync
}

/** The id of the caller's group, or the first group's outside one. Doesn't change while the user types. */
export function useEditorGroupId(): string {
    return useContext(EditorGroupContext)?.id ?? FIRST_GROUP_ID
}
