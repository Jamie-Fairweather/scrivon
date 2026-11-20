import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
import type { EditorGroups } from '@/lib/workspace/editor-groups'
import type { DocumentTab } from '@/lib/workspace/types'

const actions = vi.hoisted(() => ({
    closeTab: vi.fn(async () => {}),
    closeOtherTabs: vi.fn(async () => {}),
    closeAllTabs: vi.fn(async () => {}),
    closeTabsToRight: vi.fn(async () => {}),
    closeSavedTabs: vi.fn(async () => {}),
    switchTab: vi.fn(async () => {}),
    moveTab: vi.fn(),
    reopenClosedTab: vi.fn(async () => {}),
    revertTab: vi.fn(async () => {}),
    openExample: vi.fn(),
}))
const flushSave = vi.hoisted(() => vi.fn(async () => true))
const save = vi.hoisted(() => ({ autosaveEnabled: true, setAutosaveEnabled: () => {}, flushSave, flushAllSaves: async () => true }))
const state = vi.hoisted(() => ({ tabs: [] as DocumentTab[], groups: null as unknown as EditorGroups }))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ workspaceRoot: '/w' }),
    useDocumentTabs: () => ({
        tabs: state.tabs,
        groups: state.groups,
        activeTabId: state.groups.groups[state.groups.focused]!.activeTabId,
        canReopenClosedTab: false,
        ...actions,
    }),
    useDocumentSave: () => save,
}))
const stable = vi.hoisted(() => ({ history: { showFileHistory: vi.fn() }, saveCopy: vi.fn(), settings: { settings: { keybinds: {} } } }))
vi.mock('@/components/studio/dialogs/file-history-provider', () => ({ useFileHistory: () => stable.history }))
vi.mock('@/components/studio/workspace/use-save-example-copy', () => ({ useSaveExampleCopy: () => stable.saveCopy }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: () => stable.settings }))

const { useDocumentCommands } = await import('./document-commands')

function tab(path: string): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content: '', isDirty: false, isSaving: false }
}

let shown: readonly ShownCommand[] = []
function Commands() {
    useDocumentCommands()
    const commands = useCommands()
    useEffect(() => {
        shown = commands
    }, [commands])
    return null
}
const command = (id: string) => shown.find((c) => c.id === id)!

beforeEach(() => {
    vi.clearAllMocks()
    state.tabs = [tab('/w/a.md'), tab('/w/b.md'), tab('/w/c.md')]
    // The left group has a and b, the right group (focused) only c.
    state.groups = {
        groups: [
            { id: 'group-1', tabIds: ['/w/a.md', '/w/b.md'], activeTabId: '/w/a.md' },
            { id: 'group-2', tabIds: ['/w/c.md'], activeTabId: '/w/c.md' },
        ],
        focused: 1,
        ratio: 0.5,
    }
})

describe('the tab commands with the editor split', () => {
    it('save, close and revert the focused group’s tab, in that group', () => {
        render(
            <CommandRegistryProvider>
                <Commands />
            </CommandRegistryProvider>
        )

        act(() => void command('save').run())
        expect(flushSave).toHaveBeenCalledExactlyOnceWith('/w/c.md')
        act(() => void command('close-tab').run())
        expect(actions.closeTab).toHaveBeenCalledExactlyOnceWith('/w/c.md', 1)
        act(() => void command('revert-file').run())
        expect(actions.revertTab).toHaveBeenCalledExactlyOnceWith('/w/c.md')
    })

    it('count only the focused group’s tabs for Next Tab, Move Tab and Close Others', () => {
        const view = render(
            <CommandRegistryProvider>
                <Commands />
            </CommandRegistryProvider>
        )
        expect(command('next-tab')).toMatchObject({ disabled: true, disabledReason: 'Only one tab open' })
        expect(command('move-tab-left').disabled).toBe(true)
        expect(command('close-other-tabs').disabled).toBe(true)

        state.groups = { ...state.groups, focused: 0 }
        view.rerender(
            <CommandRegistryProvider>
                <Commands />
            </CommandRegistryProvider>
        )
        expect(command('next-tab').disabled).toBe(false)
        expect(command('move-tab-right').disabled).toBe(false)
        act(() => void command('move-tab-right').run())
        expect(actions.moveTab).toHaveBeenCalledExactlyOnceWith('/w/a.md', 1, 0)
        act(() => void command('close-other-tabs').run())
        expect(actions.closeOtherTabs).toHaveBeenCalledExactlyOnceWith('/w/a.md', 0)
    })
})
