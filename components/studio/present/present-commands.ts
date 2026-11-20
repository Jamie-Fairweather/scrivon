'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { markdownPreviewBody } from '@/components/studio/markdown/markdown-preview-body'
import { usePresentMode } from '@/components/studio/present/present-mode-provider'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { documentKind } from '@/lib/workspace/file-types'

/** The tab Present would show: its id, its file name and its text. */
export type PresentableTab = { id: string; name: string; content: string }

/** Why the tab can't be presented, as the palette says it, or null when it can. */
export function presentUnavailableReason(hasWorkspace: boolean, tab: PresentableTab | null): string | null {
    if (!hasWorkspace) return 'No folder open'
    if (!tab) return 'No document open'
    if (documentKind(tab.name) !== 'markdown') return 'Only Markdown documents can be presented'
    // As the preview decides it: only spaces, or only front matter, which it leaves out.
    if (markdownPreviewBody(tab.content).trim() === '') return 'The document is empty'
    return null
}

export type PresentCommandContext = {
    activeTabId: string | null
    /** Why the active tab can't be presented, or null (see presentUnavailableReason). */
    unavailableReason: string | null
    present: (tabId: string) => void
}

/** Present: the active Markdown tab as full-screen slides. */
export function buildPresentCommand(ctx: PresentCommandContext): AppCommand {
    const { activeTabId, unavailableReason, present } = ctx
    return {
        id: 'present',
        label: 'Present',
        keywords: 'slides slideshow presentation full screen markdown',
        keybind: 'view.present',
        disabled: unavailableReason !== null || activeTabId === null,
        disabledReason: unavailableReason ?? 'No document open',
        run: () => {
            if (activeTabId && unavailableReason === null) present(activeTabId)
        },
    }
}

export function usePresentCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    const { activeTab } = useDocumentTabs()
    const { present } = usePresentMode()
    const hasWorkspace = Boolean(workspaceRoot)
    const activeTabId = activeTab?.id ?? null
    const name = activeTab?.name
    const content = activeTab?.content
    // Worked out again as the text changes, but the command only changes when the answer does.
    const unavailableReason = useMemo(
        () =>
            presentUnavailableReason(
                hasWorkspace,
                activeTabId !== null && name !== undefined ? { id: activeTabId, name, content: content ?? '' } : null
            ),
        [hasWorkspace, activeTabId, name, content]
    )
    const commands = useMemo(() => [buildPresentCommand({ activeTabId, unavailableReason, present })], [activeTabId, unavailableReason, present])
    useRegisterCommands(commands)
}
