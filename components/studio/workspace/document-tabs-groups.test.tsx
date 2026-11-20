import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { setWorkspaceTabSession } from '@/lib/tauri/store'
import { confirmUnsavedChanges } from '@/lib/tauri/dialog'
import { DocumentTabsProvider, useDocumentTabs, useDocumentTabsState } from './document-tabs-context'
import { focusedEditorGroupId } from './focused-editor-group'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from './workspace-coordinator'
import type { EditorGroups } from '@/lib/workspace/editor-groups'
import type { DocumentTab } from '@/lib/workspace/types'

vi.mock('@/lib/tauri/dialog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/tauri/dialog')>()),
    showError: vi.fn(async () => {}),
    confirmUnsavedChanges: vi.fn(async () => 'cancel' as const),
    confirmOpenLargeFile: vi.fn(async () => false),
}))

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyWarning: vi.fn(() => 'toast'),
    notifyError: vi.fn(() => 'toast'),
    dismissNotification: vi.fn(),
}))

function tab(id: string, overrides: Partial<DocumentTab> = {}): DocumentTab {
    return { id, path: id, name: id.split('/').pop()!, content: `text of ${id}`, isDirty: false, isSaving: false, ...overrides }
}

function wrapperFor(initial: { tabs: DocumentTab[]; activeTabId: string | null }, coordinator: WorkspaceCoordinatorRefs) {
    return function Wrapper({ children }: { children: ReactNode }) {
        const tabsState = useDocumentTabsState()
        const seeded = useRef(false)
        const coordinatorRef = useMemo(() => coordinator, [])
        useLayoutEffect(() => {
            if (seeded.current) return
            seeded.current = true
            tabsState.tabsRef.current = initial.tabs
            tabsState.setTabs(initial.tabs)
            tabsState.setActiveTabId(initial.activeTabId)
        }, [tabsState])
        return (
            <DocumentTabsProvider coordinator={coordinatorRef} workspaceRoot="/ws" tabsState={tabsState}>
                {children}
            </DocumentTabsProvider>
        )
    }
}

/** Each group's tabs, with the one it shows in brackets, and a star on the focused group. */
function describeGroups(state: EditorGroups): string[] {
    return state.groups.map((g, i) => `${i === state.focused ? '*' : ''}${g.tabIds.map((id) => (id === g.activeTabId ? `[${id}]` : id)).join(' ')}`)
}

async function setup(tabs: DocumentTab[], activeTabId: string) {
    const coordinator = createWorkspaceCoordinatorRefs()
    const scheduleSave = vi.fn()
    const scheduleBackup = vi.fn()
    const flushSave = vi.fn(async () => true)
    coordinator.scheduleSave.current = scheduleSave
    coordinator.scheduleBackup.current = scheduleBackup
    coordinator.flushSave.current = flushSave
    coordinator.getAutosaveEnabled.current = () => false
    const view = renderHook(() => useDocumentTabs(), { wrapper: wrapperFor({ tabs, activeTabId }, coordinator) })
    await waitFor(() => expect(view.result.current.tabs).toHaveLength(tabs.length))
    vi.mocked(setWorkspaceTabSession).mockClear()
    return { ...view, coordinator, scheduleSave, scheduleBackup, flushSave }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
})

describe('splitting the editor', () => {
    it('opens the current tab in a new right-hand group, focuses it, and remembers the split', async () => {
        const { result } = await setup([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/b.md')

        act(() => result.current.splitEditor())

        expect(describeGroups(result.current.groups)).toEqual(['/ws/a.md [/ws/b.md]', '*[/ws/b.md]'])
        expect(result.current.activeTabId).toBe('/ws/b.md')
        // Still one tab per file.
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/a.md', '/ws/b.md'])
        expect(focusedEditorGroupId()).toBe(result.current.groups.groups[1]!.id)
        expect(setWorkspaceTabSession).toHaveBeenLastCalledWith('/ws', {
            tabIds: ['/ws/a.md', '/ws/b.md'],
            activeTabId: '/ws/b.md',
            groups: [
                { tabIds: ['/ws/a.md', '/ws/b.md'], activeTabId: '/ws/b.md' },
                { tabIds: ['/ws/b.md'], activeTabId: '/ws/b.md' },
            ],
            focusedGroup: 1,
            groupRatio: 0.5,
        })
    })

    it('never makes a third group: Split Editor again uses the other one', async () => {
        const { result } = await setup([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.splitEditor())
        act(() => result.current.splitEditor())
        expect(result.current.groups.groups).toHaveLength(2)
        expect(describeGroups(result.current.groups)).toEqual(['*[/ws/a.md] /ws/b.md', '[/ws/a.md]'])
    })

    it('switches to the group that has a file when it is opened again, else opens it in the focused group', async () => {
        const { result } = await setup([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.moveTabToOtherGroup('/ws/b.md'))
        act(() => result.current.focusGroup(0))
        expect(result.current.activeTabId).toBe('/ws/a.md')

        await act(async () => {
            await result.current.openFile('/ws/b.md')
        })
        expect(describeGroups(result.current.groups)).toEqual(['[/ws/a.md]', '*[/ws/b.md]'])
        expect(result.current.activeTabId).toBe('/ws/b.md')
    })

    it('moves the keyboard between groups and joins them, keeping every tab once', async () => {
        const { result } = await setup([tab('/ws/a.md'), tab('/ws/b.md'), tab('/ws/c.md')], '/ws/a.md')
        act(() => result.current.splitEditor())
        await act(async () => {
            await result.current.setActiveTab('/ws/c.md', 1)
        })
        act(() => result.current.focusOtherGroup())
        expect(result.current.groups.focused).toBe(0)

        act(() => result.current.joinGroups())
        expect(describeGroups(result.current.groups)).toEqual(['*[/ws/a.md] /ws/b.md /ws/c.md'])
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/a.md', '/ws/b.md', '/ws/c.md'])
        expect(setWorkspaceTabSession).toHaveBeenLastCalledWith('/ws', { tabIds: ['/ws/a.md', '/ws/b.md', '/ws/c.md'], activeTabId: '/ws/a.md' })
    })

    it('keeps Ctrl+Tab and the commands that act on the current tab inside the focused group', async () => {
        const { result } = await setup([tab('/ws/a.md'), tab('/ws/b.md'), tab('/ws/c.md')], '/ws/a.md')
        act(() => result.current.moveTabToOtherGroup('/ws/b.md'))
        await act(async () => {
            await result.current.setActiveTab('/ws/c.md', 1)
        })
        expect(describeGroups(result.current.groups)).toEqual(['[/ws/a.md] /ws/c.md', '*/ws/b.md [/ws/c.md]'])

        await act(async () => {
            await result.current.switchTab(1)
        })
        expect(result.current.activeTabId).toBe('/ws/b.md')
        await act(async () => {
            await result.current.switchTab(1)
        })
        expect(result.current.activeTabId).toBe('/ws/c.md')
    })
})

describe('one document in both groups', () => {
    it('updates the one tab, and schedules one save and one backup, for each keystroke', async () => {
        const { result, scheduleSave, scheduleBackup } = await setup([tab('/ws/a.md')], '/ws/a.md')
        act(() => result.current.splitEditor())

        act(() => result.current.updateTabContent('/ws/a.md', 'typed'))

        expect(result.current.tabs).toHaveLength(1)
        expect(result.current.tabs[0]).toMatchObject({ content: 'typed', isDirty: true })
        expect(scheduleSave).toHaveBeenCalledTimes(1)
        expect(scheduleBackup).toHaveBeenCalledTimes(1)
    })

    it('closes a view without asking while the other group still shows the tab, and keeps its edits', async () => {
        const { result, flushSave } = await setup([tab('/ws/a.md', { isDirty: true, content: 'edited' }), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.splitEditor())

        await act(async () => {
            await result.current.closeTab('/ws/a.md', 1)
        })

        expect(confirmUnsavedChanges).not.toHaveBeenCalled()
        expect(flushSave).not.toHaveBeenCalled()
        expect(describeGroups(result.current.groups)).toEqual(['*[/ws/a.md] /ws/b.md'])
        expect(result.current.tabs[0]).toMatchObject({ content: 'edited', isDirty: true })
        // Nothing to reopen: it never closed.
        expect(result.current.canReopenClosedTab).toBe(false)
    })

    it('asks about unsaved changes when its last view closes, as closing a tab always has, and can reopen it', async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('discard')
        const { result } = await setup([tab('/ws/a.md', { isDirty: true }), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.splitEditor())
        await act(async () => {
            await result.current.closeTab('/ws/a.md', 1)
        })

        await act(async () => {
            await result.current.closeTab('/ws/a.md', 0)
        })

        expect(confirmUnsavedChanges).toHaveBeenCalledExactlyOnceWith(['a.md'])
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/b.md'])
        expect(result.current.canReopenClosedTab).toBe(true)
    })

    it('closes the group whose last tab closes, and the keyboard goes to the group left', async () => {
        const { result } = await setup([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.moveTabToOtherGroup('/ws/b.md'))

        await act(async () => {
            await result.current.closeTab('/ws/b.md')
        })

        expect(describeGroups(result.current.groups)).toEqual(['*[/ws/a.md]'])
        expect(result.current.activeTabId).toBe('/ws/a.md')
    })
})

describe('renaming and deleting files with the editor split', () => {
    it('follows a renamed file in both groups', async () => {
        const { result, coordinator } = await setup([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.splitEditor())

        act(() => coordinator.remapTabsAfterRename.current('/ws/a.md', '/ws/z.md', 'z.md'))

        expect(describeGroups(result.current.groups)).toEqual(['[/ws/z.md] /ws/b.md', '*[/ws/z.md]'])
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/z.md', '/ws/b.md'])
    })

    it('closes a deleted file in both groups, and the group it leaves empty', async () => {
        const { result, coordinator } = await setup([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/a.md')
        act(() => result.current.splitEditor())

        act(() => coordinator.closeTabsForDelete.current('/ws/a.md', false))

        expect(describeGroups(result.current.groups)).toEqual(['*[/ws/b.md]'])
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/b.md'])
    })

    it('reloads a file changed outside Scrivon once, however many groups show it', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        const { result, coordinator } = await setup([tab('/ws/a.md', { content: 'mine', disk: { stamp: { mtimeMs: 1, size: 4 } } })], '/ws/a.md')
        act(() => result.current.splitEditor())
        const replaceEditorText = vi.fn()
        coordinator.replaceEditorText.current = replaceEditorText
        vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 6, mtime: new Date(2), nlink: null } as never)
        vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('theirs'))

        let looks = 0
        try {
            await act(async () => {
                await coordinator.reloadChangedTabs.current()
            })
            looks = vi.mocked(readFile).mock.calls.length
        } finally {
            vi.mocked(readFile).mockReset()
            vi.mocked(readFile).mockResolvedValue(new Uint8Array())
            vi.mocked(stat).mockReset()
            vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null, nlink: null } as never)
        }

        // One tab for the file, so it is read once and reloaded once, whatever the groups show.
        expect(looks).toBe(1)
        expect(replaceEditorText).toHaveBeenCalledExactlyOnceWith('/ws/a.md', 'theirs')
        expect(result.current.tabs).toHaveLength(1)
        expect(describeGroups(result.current.groups)).toEqual(['[/ws/a.md]', '*[/ws/a.md]'])
    })
})

describe('reopening a split folder', () => {
    it('puts each group back with its tabs, the tab it showed, the focused group and the divider', async () => {
        const { result, coordinator } = await setup([], '')
        act(() => {
            coordinator.setTabsFromWorkspace.current([tab('C:\\Docs\\A.md'), tab('C:\\Docs\\B.md')], 'C:\\Docs\\B.md', {
                groups: [
                    { tabIds: ['c:/docs/a.md', 'c:/docs/b.md'], activeTabId: 'c:/docs/a.md' },
                    { tabIds: ['C:/DOCS/B.MD', 'C:\\Docs\\gone.md'], activeTabId: 'C:/DOCS/B.MD' },
                ],
                focusedGroup: 1,
                groupRatio: 0.3,
            })
        })

        expect(describeGroups(result.current.groups)).toEqual(['[C:\\Docs\\A.md] C:\\Docs\\B.md', '*[C:\\Docs\\B.md]'])
        expect(result.current.groups.ratio).toBe(0.3)
        expect(result.current.activeTabId).toBe('C:\\Docs\\B.md')
    })

    it('opens one group when there was no split', async () => {
        const { result, coordinator } = await setup([], '')
        act(() => {
            coordinator.setTabsFromWorkspace.current([tab('/ws/a.md'), tab('/ws/b.md')], '/ws/b.md')
        })
        expect(describeGroups(result.current.groups)).toEqual(['*/ws/a.md [/ws/b.md]'])
    })
})
