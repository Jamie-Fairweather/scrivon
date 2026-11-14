import { describe, expect, it, vi } from 'vitest'
import { buildDocumentCommands, type DocumentCommandsContext } from '@/components/studio/workspace/document-commands'

function context(overrides: Partial<DocumentCommandsContext> = {}): DocumentCommandsContext {
    return {
        hasWorkspace: true,
        activeTabId: '/ws/a.md',
        tabCount: 2,
        hasDirtyTabs: true,
        autosaveEnabled: true,
        flushSave: vi.fn(async () => true),
        flushAllSaves: vi.fn(async () => true),
        setAutosaveEnabled: vi.fn(),
        closeTab: vi.fn(async () => {}),
        closeOtherTabs: vi.fn(async () => {}),
        closeAllTabs: vi.fn(async () => {}),
        hasTabsToRight: true,
        closeTabsToRight: vi.fn(async () => {}),
        hasSavedTabs: true,
        closeSavedTabs: vi.fn(async () => {}),
        switchTab: vi.fn(async () => {}),
        canReopenClosedTab: true,
        reopenClosedTab: vi.fn(async () => {}),
        revertTab: vi.fn(async () => {}),
        openExample: vi.fn(),
        saveExampleCopy: vi.fn(async () => {}),
        ...overrides,
    }
}

const find = (ctx: DocumentCommandsContext, id: string) => buildDocumentCommands(ctx).find((command) => command.id === id)

describe('buildDocumentCommands saving', () => {
    it('saves the open file and all files, on their app shortcuts', () => {
        const ctx = context()
        expect(find(ctx, 'save')).toMatchObject({ label: 'Save', keybind: 'document.save', disabled: false })
        expect(find(ctx, 'save-all')).toMatchObject({ label: 'Save All', keybind: 'workspace.saveAll', disabled: false })

        void find(ctx, 'save')!.run()
        void find(ctx, 'save-all')!.run()
        expect(ctx.flushSave).toHaveBeenCalledWith('/ws/a.md')
        expect(ctx.flushAllSaves).toHaveBeenCalledTimes(1)
    })

    it('turns Save off for an example or no tab, and Save All off with nothing to save', () => {
        expect(find(context({ activeTabId: 'example:flowchart' }), 'save')).toMatchObject({
            disabled: true,
            disabledReason: 'No workspace file open',
        })
        expect(find(context({ activeTabId: null }), 'save')?.disabled).toBe(true)
        expect(find(context({ hasDirtyTabs: false }), 'save-all')).toMatchObject({ disabled: true, disabledReason: 'Nothing to save' })
    })

    it('shows Autosave as an on/off setting and flips it', () => {
        const ctx = context({ autosaveEnabled: false })
        const autosave = find(ctx, 'toggle-autosave')
        expect(autosave).toMatchObject({ label: 'Autosave', checked: false })

        void autosave!.run()
        expect(ctx.setAutosaveEnabled).toHaveBeenCalledWith(true)
        expect(find(context({ autosaveEnabled: true }), 'toggle-autosave')?.checked).toBe(true)
    })
})

describe('buildDocumentCommands tabs', () => {
    it('closes the open tab, the others, or all of them', () => {
        const ctx = context()
        void find(ctx, 'close-tab')!.run()
        void find(ctx, 'close-other-tabs')!.run()
        void find(ctx, 'close-all-tabs')!.run()
        expect(ctx.closeTab).toHaveBeenCalledWith('/ws/a.md')
        expect(ctx.closeOtherTabs).toHaveBeenCalledWith('/ws/a.md')
        expect(ctx.closeAllTabs).toHaveBeenCalledTimes(1)
    })

    it('turns off Close Other Tabs with only one tab open, and says why', () => {
        expect(find(context({ tabCount: 1 }), 'close-other-tabs')).toMatchObject({ disabled: true, disabledReason: 'Only one tab open' })
        expect(find(context({ tabCount: 0, activeTabId: null }), 'close-other-tabs')).toMatchObject({ disabled: true, disabledReason: 'No tab open' })
    })

    it('closes the tab on its app shortcut', () => {
        expect(find(context(), 'close-tab')).toMatchObject({ label: 'Close Tab', keybind: 'tabs.close' })
    })

    it('moves to the next and previous tab on their app shortcuts', () => {
        const ctx = context()
        expect(find(ctx, 'next-tab')).toMatchObject({ label: 'Next Tab', keybind: 'tabs.next', disabled: false })
        expect(find(ctx, 'previous-tab')).toMatchObject({ label: 'Previous Tab', keybind: 'tabs.previous', disabled: false })

        void find(ctx, 'next-tab')!.run()
        void find(ctx, 'previous-tab')!.run()
        expect(ctx.switchTab).toHaveBeenNthCalledWith(1, 1)
        expect(ctx.switchTab).toHaveBeenNthCalledWith(2, -1)
    })

    it('turns Next and Previous Tab off with fewer than two tabs, and says why', () => {
        expect(find(context({ tabCount: 1 }), 'next-tab')).toMatchObject({ disabled: true, disabledReason: 'Only one tab open' })
        expect(find(context({ tabCount: 0, activeTabId: null }), 'previous-tab')).toMatchObject({ disabled: true, disabledReason: 'No tabs open' })
    })

    it('reopens the last closed tab on its app shortcut, when there is one', () => {
        const ctx = context()
        expect(find(ctx, 'reopen-closed-tab')).toMatchObject({ label: 'Reopen Closed Tab', keybind: 'tabs.reopenClosed', disabled: false })
        void find(ctx, 'reopen-closed-tab')!.run()
        expect(ctx.reopenClosedTab).toHaveBeenCalledTimes(1)

        expect(find(context({ canReopenClosedTab: false }), 'reopen-closed-tab')).toMatchObject({ disabled: true, disabledReason: 'No closed tabs' })
    })

    it('closes the tabs to the right of the open one, or the saved ones', () => {
        const ctx = context()
        void find(ctx, 'close-tabs-to-right')!.run()
        void find(ctx, 'close-saved-tabs')!.run()
        expect(ctx.closeTabsToRight).toHaveBeenCalledWith('/ws/a.md')
        expect(ctx.closeSavedTabs).toHaveBeenCalledTimes(1)

        expect(find(context({ hasTabsToRight: false }), 'close-tabs-to-right')).toMatchObject({
            disabled: true,
            disabledReason: 'No tabs to the right',
        })
        expect(find(context({ hasSavedTabs: false }), 'close-saved-tabs')).toMatchObject({
            disabled: true,
            disabledReason: 'Every tab has unsaved changes',
        })
    })

    it('reverts the open file, but not an example', () => {
        const ctx = context()
        expect(find(ctx, 'revert-file')).toMatchObject({ label: 'Revert File', disabled: false })
        void find(ctx, 'revert-file')!.run()
        expect(ctx.revertTab).toHaveBeenCalledWith('/ws/a.md')

        expect(find(context({ activeTabId: 'example:flowchart' }), 'revert-file')).toMatchObject({
            disabled: true,
            disabledReason: 'No workspace file open',
        })
    })

    it('turns the tab commands off when a hidden tab is left over with no folder open', () => {
        const ctx = context({ hasWorkspace: false, activeTabId: 'example:flowchart' })
        for (const id of [
            'close-tab',
            'close-other-tabs',
            'close-all-tabs',
            'close-tabs-to-right',
            'close-saved-tabs',
            'next-tab',
            'previous-tab',
            'reopen-closed-tab',
            'revert-file',
        ]) {
            expect(find(ctx, id)?.disabled).toBe(true)
        }
    })
})

describe('buildDocumentCommands examples', () => {
    const examples = (ctx: DocumentCommandsContext) => buildDocumentCommands(ctx).filter((command) => command.id.startsWith('example:'))

    it('opens an example when a folder is open', () => {
        const ctx = context()
        const list = examples(ctx)
        expect(list.length).toBeGreaterThan(0)
        expect(list.every((command) => !command.disabled && command.label.startsWith('Open Example: '))).toBe(true)

        list[0]!.run()
        expect(ctx.openExample).toHaveBeenCalledWith(list[0]!.id.slice('example:'.length))
    })

    it('saves a copy of the example in the active tab', () => {
        const ctx = context({ activeTabId: 'example:sample-1' })
        const saveCopy = find(ctx, 'save-example-copy')
        expect(saveCopy).toMatchObject({ label: 'Save Copy to Workspace', disabled: false })
        void saveCopy!.run()
        expect(ctx.saveExampleCopy).toHaveBeenCalledWith('sample-1')
    })

    it('turns off Save Copy to Workspace unless an example is open, and says why', () => {
        expect(find(context(), 'save-example-copy')).toMatchObject({ disabled: true, disabledReason: 'No example open' })
        expect(find(context({ hasWorkspace: false, activeTabId: 'example:sample-1' }), 'save-example-copy')).toMatchObject({
            disabled: true,
            disabledReason: 'Open a folder first',
        })
    })

    it('says why examples are off with no folder open', () => {
        expect(
            examples(context({ hasWorkspace: false, activeTabId: null })).every((c) => c.disabled && c.disabledReason === 'Open a folder first')
        ).toBe(true)
    })
})
