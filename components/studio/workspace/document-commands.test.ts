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
        openExample: vi.fn(),
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

    it('turns the tab commands off when a hidden tab is left over with no folder open', () => {
        const ctx = context({ hasWorkspace: false, activeTabId: 'example:flowchart' })
        for (const id of ['close-tab', 'close-other-tabs', 'close-all-tabs']) {
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

    it('says why examples are off with no folder open', () => {
        expect(
            examples(context({ hasWorkspace: false, activeTabId: null })).every((c) => c.disabled && c.disabledReason === 'Open a folder first')
        ).toBe(true)
    })
})
