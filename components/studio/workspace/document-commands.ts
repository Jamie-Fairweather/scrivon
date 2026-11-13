'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useDocumentSave, useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { isExampleTabId } from '@/lib/examples/example-tab'

export type DocumentCommandsContext = {
    hasWorkspace: boolean
    activeTabId: string | null
    /** How many tabs are open, examples included. */
    tabCount: number
    hasDirtyTabs: boolean
    autosaveEnabled: boolean
    flushSave: (id: string) => Promise<boolean>
    flushAllSaves: () => Promise<boolean>
    setAutosaveEnabled: (enabled: boolean) => void
    closeTab: (id: string) => Promise<void>
    closeOtherTabs: (keepId: string) => Promise<void>
    closeAllTabs: () => Promise<void>
    openExample: (exampleId: string) => void
}

/** Saving, autosave, closing tabs and opening the examples. */
export function buildDocumentCommands(ctx: DocumentCommandsContext): AppCommand[] {
    const { hasWorkspace, activeTabId } = ctx
    // Tabs are only on screen while a folder is open, so tab commands need both.
    const hasActiveTab = activeTabId !== null && hasWorkspace
    const hasWorkspaceTab = hasActiveTab && !isExampleTabId(activeTabId)

    const commands: AppCommand[] = [
        {
            id: 'save',
            label: 'Save',
            keywords: 'save file',
            keybind: 'document.save',
            disabled: !hasWorkspaceTab,
            disabledReason: 'No workspace file open',
            run: () => {
                if (activeTabId) void ctx.flushSave(activeTabId)
            },
        },
        {
            id: 'save-all',
            label: 'Save All',
            keywords: 'save all files',
            keybind: 'workspace.saveAll',
            disabled: !hasWorkspace || !ctx.hasDirtyTabs,
            disabledReason: 'Nothing to save',
            run: () => void ctx.flushAllSaves(),
        },
        {
            id: 'toggle-autosave',
            label: 'Autosave',
            keywords: 'save automatically',
            checked: ctx.autosaveEnabled,
            run: () => ctx.setAutosaveEnabled(!ctx.autosaveEnabled),
        },
        {
            id: 'close-tab',
            label: 'Close Tab',
            keywords: 'close tab file',
            disabled: !hasActiveTab,
            disabledReason: 'No tab open',
            run: () => {
                if (activeTabId) void ctx.closeTab(activeTabId)
            },
        },
        {
            id: 'close-other-tabs',
            label: 'Close Other Tabs',
            keywords: 'close other tabs',
            disabled: !hasActiveTab || ctx.tabCount < 2,
            disabledReason: hasActiveTab ? 'Only one tab open' : 'No tab open',
            run: () => {
                if (activeTabId) void ctx.closeOtherTabs(activeTabId)
            },
        },
        {
            id: 'close-all-tabs',
            label: 'Close All Tabs',
            keywords: 'close all tabs',
            disabled: !hasActiveTab,
            disabledReason: 'No tabs open',
            run: () => void ctx.closeAllTabs(),
        },
    ]

    for (const example of APP_EXAMPLES) {
        commands.push({
            id: `example:${example.id}`,
            label: `Open Example: ${example.title}`,
            keywords: `example ${example.title} ${example.category}`,
            // With no folder open only the welcome screen shows, so the example tab would stay hidden.
            disabled: !hasWorkspace,
            disabledReason: 'Open a folder first',
            run: () => ctx.openExample(example.id),
        })
    }

    return commands
}

export function useDocumentCommands(): void {
    const { workspaceRoot } = useWorkspaceSession()
    const { tabs, activeTabId, openExample, closeTab, closeOtherTabs, closeAllTabs } = useDocumentTabs()
    const { autosaveEnabled, setAutosaveEnabled, flushSave, flushAllSaves } = useDocumentSave()

    // Only what the commands show, so typing in a tab doesn't rebuild them.
    const hasWorkspace = Boolean(workspaceRoot)
    const tabCount = tabs.length
    const hasDirtyTabs = tabs.some((t) => t.isDirty && !isExampleTabId(t.id))

    const commands = useMemo(
        () =>
            buildDocumentCommands({
                hasWorkspace,
                activeTabId,
                tabCount,
                hasDirtyTabs,
                autosaveEnabled,
                flushSave,
                flushAllSaves,
                setAutosaveEnabled,
                closeTab,
                closeOtherTabs,
                closeAllTabs,
                openExample,
            }),
        [
            hasWorkspace,
            activeTabId,
            tabCount,
            hasDirtyTabs,
            autosaveEnabled,
            flushSave,
            flushAllSaves,
            setAutosaveEnabled,
            closeTab,
            closeOtherTabs,
            closeAllTabs,
            openExample,
        ]
    )
    useRegisterCommands(commands)
}
