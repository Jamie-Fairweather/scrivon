'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useSaveExampleCopy } from '@/components/studio/workspace/use-save-example-copy'
import { useDocumentSave, useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { exampleIdFromTabId, isExampleTabId } from '@/lib/examples/example-tab'
import { anySavedTabs, anyTabsToRight } from '@/lib/workspace/document-tab'

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
    /** True when the open tab isn't the last one. */
    hasTabsToRight: boolean
    closeTabsToRight: (id: string) => Promise<void>
    /** True when a tab has no unsaved changes. */
    hasSavedTabs: boolean
    closeSavedTabs: () => Promise<void>
    switchTab: (step: 1 | -1) => Promise<void>
    canReopenClosedTab: boolean
    reopenClosedTab: () => Promise<void>
    revertTab: (id: string) => Promise<void>
    openExample: (exampleId: string) => void
    saveExampleCopy: (exampleId: string) => Promise<void>
}

/** Saving, autosave, switching and closing tabs, and opening the examples. */
export function buildDocumentCommands(ctx: DocumentCommandsContext): AppCommand[] {
    const { hasWorkspace, activeTabId } = ctx
    // Tabs are only on screen while a folder is open, so tab commands need both.
    const hasActiveTab = activeTabId !== null && hasWorkspace
    const hasWorkspaceTab = hasActiveTab && !isExampleTabId(activeTabId)
    const activeExampleId = hasActiveTab ? exampleIdFromTabId(activeTabId) : null
    const canSwitchTabs = hasWorkspace && ctx.tabCount > 1
    const switchOffReason = hasWorkspace && ctx.tabCount === 1 ? 'Only one tab open' : 'No tabs open'

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
            id: 'revert-file',
            label: 'Revert File',
            keywords: 'revert reload saved version discard undo changes',
            disabled: !hasWorkspaceTab,
            disabledReason: 'No workspace file open',
            run: () => {
                if (activeTabId) void ctx.revertTab(activeTabId)
            },
        },
        {
            id: 'save-example-copy',
            label: 'Save Copy to Workspace',
            keywords: 'save copy example workspace folder',
            disabled: activeExampleId === null,
            disabledReason: hasWorkspace ? 'No example open' : 'Open a folder first',
            run: () => {
                if (activeExampleId) void ctx.saveExampleCopy(activeExampleId)
            },
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
            keybind: 'tabs.close',
            disabled: !hasActiveTab,
            disabledReason: 'No tab open',
            run: () => {
                if (activeTabId) void ctx.closeTab(activeTabId)
            },
        },
        {
            id: 'reopen-closed-tab',
            label: 'Reopen Closed Tab',
            keywords: 'reopen undo close tab file',
            keybind: 'tabs.reopenClosed',
            disabled: !hasWorkspace || !ctx.canReopenClosedTab,
            disabledReason: 'No closed tabs',
            run: () => void ctx.reopenClosedTab(),
        },
        {
            id: 'next-tab',
            label: 'Next Tab',
            keywords: 'switch tab',
            keybind: 'tabs.next',
            disabled: !canSwitchTabs,
            disabledReason: switchOffReason,
            run: () => void ctx.switchTab(1),
        },
        {
            id: 'previous-tab',
            label: 'Previous Tab',
            keywords: 'switch tab',
            keybind: 'tabs.previous',
            disabled: !canSwitchTabs,
            disabledReason: switchOffReason,
            run: () => void ctx.switchTab(-1),
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
            id: 'close-tabs-to-right',
            label: 'Close Tabs to the Right',
            keywords: 'close tabs right',
            disabled: !hasActiveTab || !ctx.hasTabsToRight,
            disabledReason: hasActiveTab ? 'No tabs to the right' : 'No tab open',
            run: () => {
                if (activeTabId) void ctx.closeTabsToRight(activeTabId)
            },
        },
        {
            id: 'close-saved-tabs',
            label: 'Close Saved Tabs',
            keywords: 'close saved tabs unchanged',
            disabled: !hasActiveTab || !ctx.hasSavedTabs,
            disabledReason: hasActiveTab ? 'Every tab has unsaved changes' : 'No tabs open',
            run: () => void ctx.closeSavedTabs(),
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
    const {
        tabs,
        activeTabId,
        canReopenClosedTab,
        openExample,
        closeTab,
        closeOtherTabs,
        closeAllTabs,
        closeTabsToRight,
        closeSavedTabs,
        switchTab,
        reopenClosedTab,
        revertTab,
    } = useDocumentTabs()
    const { autosaveEnabled, setAutosaveEnabled, flushSave, flushAllSaves } = useDocumentSave()
    const saveExampleCopy = useSaveExampleCopy()

    // Only what the commands show, so typing in a tab doesn't rebuild them.
    const hasWorkspace = Boolean(workspaceRoot)
    const tabCount = tabs.length
    const hasDirtyTabs = tabs.some((t) => t.isDirty && !isExampleTabId(t.id))
    const hasSavedTabs = anySavedTabs(tabs)
    const hasTabsToRight = anyTabsToRight(tabs, activeTabId)

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
                hasTabsToRight,
                closeTabsToRight,
                hasSavedTabs,
                closeSavedTabs,
                switchTab,
                canReopenClosedTab,
                reopenClosedTab,
                revertTab,
                openExample,
                saveExampleCopy,
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
            hasTabsToRight,
            closeTabsToRight,
            hasSavedTabs,
            closeSavedTabs,
            switchTab,
            canReopenClosedTab,
            reopenClosedTab,
            revertTab,
            openExample,
            saveExampleCopy,
        ]
    )
    useRegisterCommands(commands)
}
