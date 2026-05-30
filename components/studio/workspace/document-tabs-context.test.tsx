import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { setWorkspaceTabSession, addRecentFile } from '@/lib/tauri/store'
import { showError } from '@/lib/tauri/dialog'
import { DocumentTabsProvider, useDocumentTabs, useDocumentTabsState } from './document-tabs-context'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from './workspace-coordinator'
import type { DocumentTab } from '@/lib/workspace/types'

vi.mock('@/lib/tauri/dialog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/tauri/dialog')>()
    return {
        ...actual,
        showError: vi.fn(actual.showError),
    }
})

type WrapperOptions = {
    initial?: { tabs: DocumentTab[]; activeTabId: string | null }
    coordinator?: WorkspaceCoordinatorRefs
    workspaceRoot?: string | null
}

function createTabsWrapper(options: WrapperOptions = {}) {
    return function Wrapper({ children }: { children: ReactNode }) {
        const optionsRef = useRef(options)
        const tabsState = useDocumentTabsState()
        const coordinator = useMemo(() => optionsRef.current.coordinator ?? createWorkspaceCoordinatorRefs(), [])
        const seeded = useRef(false)

        useLayoutEffect(() => {
            const initial = optionsRef.current.initial
            if (!initial || seeded.current) return
            seeded.current = true
            tabsState.tabsRef.current = initial.tabs
            tabsState.setTabs(initial.tabs)
            tabsState.setActiveTabId(initial.activeTabId)
        }, [tabsState])

        return (
            <DocumentTabsProvider coordinator={coordinator} workspaceRoot={optionsRef.current.workspaceRoot ?? null} tabsState={tabsState}>
                {children}
            </DocumentTabsProvider>
        )
    }
}

function tab(id: string, name = id, overrides: Partial<DocumentTab> = {}): DocumentTab {
    return {
        id,
        path: id,
        name,
        content: 'content',
        isDirty: false,
        isSaving: false,
        ...overrides,
    }
}

describe('DocumentTabsProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('opens an example tab as read-only', () => {
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        act(() => {
            result.current.openExample('sample-1')
        })

        expect(result.current.tabs).toHaveLength(1)
        expect(result.current.tabs[0]?.readOnly).toBe(true)
        expect(result.current.activeTabId).toBe('example:sample-1')
    })

    it('focuses an already-open example tab', async () => {
        const initial = {
            tabs: [tab('example:sample-1', 'Simple Flow.mmd', { readOnly: true }), tab('/ws/other.mmd', 'other.mmd')],
            activeTabId: '/ws/other.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        act(() => {
            result.current.openExample('sample-1')
        })

        expect(result.current.activeTabId).toBe('example:sample-1')
        expect(result.current.tabs).toHaveLength(2)
        expect(flushSaveOnTabLeave).toHaveBeenCalledWith('/ws/other.mmd')
    })

    it('shows an error for unknown examples', () => {
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        act(() => {
            result.current.openExample('missing-example')
        })

        expect(showError).toHaveBeenCalledWith('Example not found', 'No example with id "missing-example"')
        expect(result.current.tabs).toHaveLength(0)
    })

    it('marks tab content dirty and schedules save', async () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const scheduleSave = vi.fn()
        coordinator.scheduleSave.current = scheduleSave
        const initial = { tabs: [tab('/ws/diagram.mmd', 'diagram.mmd')], activeTabId: '/ws/diagram.mmd' }

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        act(() => {
            result.current.updateTabContent('/ws/diagram.mmd', 'graph TD\n  A --> B')
        })

        expect(result.current.tabs[0]?.isDirty).toBe(true)
        expect(scheduleSave).toHaveBeenCalledWith('/ws/diagram.mmd')
    })

    it('does not update read-only tabs', async () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const scheduleSave = vi.fn()
        coordinator.scheduleSave.current = scheduleSave
        const initial = {
            tabs: [tab('example:sample-1', 'Simple Flow.mmd', { readOnly: true, content: 'original' })],
            activeTabId: 'example:sample-1',
        }

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        act(() => {
            result.current.updateTabContent('example:sample-1', 'changed')
        })

        expect(result.current.tabs[0]?.content).toBe('original')
        expect(scheduleSave).not.toHaveBeenCalled()
    })

    it('closes the active tab and selects the next one', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(result.current.tabs).toHaveLength(1)
        expect(result.current.activeTabId).toBe('/ws/b.mmd')
    })

    it('closes other tabs and keeps the selected tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd'), tab('/ws/c.mmd', 'c.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(3)
        })

        await act(async () => {
            await result.current.closeOtherTabs('/ws/b.mmd')
        })

        expect(result.current.tabs).toEqual([expect.objectContaining({ id: '/ws/b.mmd' })])
        expect(result.current.activeTabId).toBe('/ws/b.mmd')
        expect(setWorkspaceTabSession).toHaveBeenCalled()
    })

    it('closes all tabs', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.closeAllTabs()
        })

        expect(result.current.tabs).toEqual([])
        expect(result.current.activeTabId).toBeNull()
    })

    it('opens a workspace file when supported', async () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const requestCanvasFit = vi.fn()
        coordinator.requestCanvasFit.current = requestCanvasFit

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ coordinator, workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })
        expect(result.current.tabs[0]?.name).toBe('new.mmd')
        expect(requestCanvasFit).toHaveBeenCalled()
        expect(addRecentFile).toHaveBeenCalledWith('/ws', '/ws/new.mmd')
    })

    it('reads file content when running inside Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockResolvedValueOnce('graph TD\n  A --> B')

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        await waitFor(() => {
            expect(result.current.tabs[0]?.content).toBe('graph TD\n  A --> B')
        })
    })

    it('focuses an already-open workspace file', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.openFile('/ws/b.mmd')
        })

        expect(result.current.activeTabId).toBe('/ws/b.mmd')
        expect(result.current.tabs).toHaveLength(2)
        expect(flushSaveOnTabLeave).toHaveBeenCalledWith('/ws/a.mmd')
        expect(addRecentFile).toHaveBeenCalledWith('/ws', '/ws/b.mmd')
    })

    it('rejects unsupported workspace files', async () => {
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        await act(async () => {
            await result.current.openFile('/ws/image.png')
        })

        expect(showError).toHaveBeenCalledWith('Unsupported file', 'Scrivon supports .md and .mmd files only.')
        expect(result.current.tabs).toHaveLength(0)
    })

    it('shows an error when opening a file fails', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockRejectedValueOnce(new Error('Permission denied'))

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        expect(showError).toHaveBeenCalledWith('Open failed', 'Permission denied')
    })

    it('switches active tabs and flushes save on leave', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.setActiveTab('/ws/b.mmd')
        })

        expect(result.current.activeTabId).toBe('/ws/b.mmd')
        expect(flushSaveOnTabLeave).toHaveBeenCalledWith('/ws/a.mmd')
        expect(addRecentFile).toHaveBeenCalledWith('/ws', '/ws/b.mmd')
    })

    it('does not track recent files without a workspace root', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial }),
        })

        await act(async () => {
            await result.current.openFile('/ws/b.mmd')
        })

        expect(addRecentFile).not.toHaveBeenCalled()
    })

    it('does not track recent files when opening a new file without a workspace root', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockResolvedValueOnce('content')

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        expect(addRecentFile).not.toHaveBeenCalled()
    })

    it('does not track recent files when switching tabs without a workspace root', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial }),
        })

        await act(async () => {
            await result.current.setActiveTab('/ws/b.mmd')
        })

        expect(addRecentFile).not.toHaveBeenCalled()
    })

    it('remaps tabs when coordinator rename handler runs', async () => {
        const initial = {
            tabs: [tab('/ws/old.mmd', 'old.mmd'), tab('/ws/docs/readme.md', 'readme.md')],
            activeTabId: '/ws/old.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        act(() => {
            coordinator.remapTabsAfterRename.current('/ws/old.mmd', '/ws/new.mmd', 'new.mmd')
        })

        expect(result.current.tabs[0]).toMatchObject({ id: '/ws/new.mmd', path: '/ws/new.mmd', name: 'new.mmd' })
        expect(result.current.activeTabId).toBe('/ws/new.mmd')
    })

    it('closes tabs when coordinator delete handler runs', async () => {
        const initial = {
            tabs: [tab('/ws/docs/readme.md', 'readme.md'), tab('/ws/other.mmd', 'other.mmd')],
            activeTabId: '/ws/docs/readme.md',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const cancelScheduledSave = vi.fn()
        coordinator.cancelScheduledSave.current = cancelScheduledSave
        coordinator.getAutosaveEnabled.current = () => false

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        act(() => {
            coordinator.closeTabsForDelete.current('/ws/docs', true)
        })

        expect(result.current.tabs).toEqual([expect.objectContaining({ id: '/ws/other.mmd' })])
        expect(cancelScheduledSave).toHaveBeenCalledWith('/ws/docs/readme.md')
    })

    it('cancels scheduled saves when autosave is disabled', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/b.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const cancelScheduledSave = vi.fn()
        const flushSave = vi.fn(async () => true)
        coordinator.cancelScheduledSave.current = cancelScheduledSave
        coordinator.flushSave.current = flushSave
        coordinator.getAutosaveEnabled.current = () => false

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.closeTab('/ws/b.mmd')
        })
        await act(async () => {
            await result.current.closeOtherTabs('/ws/a.mmd')
        })
        await act(async () => {
            await result.current.closeAllTabs()
        })

        expect(flushSave).not.toHaveBeenCalled()
        expect(cancelScheduledSave).toHaveBeenCalled()
    })

    it('restores tabs from the coordinator handler', async () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const nextTabs = [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')]

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ coordinator }),
        })

        act(() => {
            coordinator.setTabsFromWorkspace.current(nextTabs, '/ws/b.mmd')
        })

        expect(result.current.tabs).toHaveLength(2)
        expect(result.current.activeTabId).toBe('/ws/b.mmd')
    })

    it('cancels saves when closing other tabs with autosave disabled', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd'), tab('/ws/c.mmd', 'c.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const cancelScheduledSave = vi.fn()
        const flushSave = vi.fn(async () => true)
        coordinator.cancelScheduledSave.current = cancelScheduledSave
        coordinator.flushSave.current = flushSave
        coordinator.getAutosaveEnabled.current = () => false

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(3)
        })

        await act(async () => {
            await result.current.closeOtherTabs('/ws/b.mmd')
        })

        expect(result.current.tabs).toEqual([expect.objectContaining({ id: '/ws/b.mmd' })])
        expect(flushSave).not.toHaveBeenCalled()
        expect(cancelScheduledSave).toHaveBeenCalledWith('/ws/a.mmd')
        expect(cancelScheduledSave).toHaveBeenCalledWith('/ws/c.mmd')
    })

    it('clears tabs from the coordinator handler', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        act(() => {
            coordinator.clearTabs.current()
        })

        expect(result.current.tabs).toEqual([])
        expect(result.current.activeTabId).toBeNull()
    })

    it('throws when useDocumentTabs is used outside the provider', () => {
        expect(() => renderHook(() => useDocumentTabs())).toThrow('useDocumentTabs must be used within WorkspaceProvider')
    })

    it('persists session with first workspace tab when active tab is an example', async () => {
        const initial = {
            tabs: [tab('example:sample-1', 'Simple Flow.mmd', { readOnly: true }), tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: 'example:sample-1',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await coordinator.persistWorkspaceTabSession.current()
        })

        expect(setWorkspaceTabSession).toHaveBeenCalledWith('/ws', {
            tabIds: ['/ws/a.mmd'],
            activeTabId: '/ws/a.mmd',
        })
    })

    it('persists session with first workspace tab when active id is stale', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/missing.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await coordinator.persistWorkspaceTabSession.current()
        })

        expect(setWorkspaceTabSession).toHaveBeenCalledWith('/ws', {
            tabIds: ['/ws/a.mmd'],
            activeTabId: '/ws/a.mmd',
        })
    })

    it('persists null active id when only example tabs remain', async () => {
        const initial = {
            tabs: [tab('example:sample-1', 'Simple Flow.mmd', { readOnly: true })],
            activeTabId: 'example:sample-1',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await coordinator.persistWorkspaceTabSession.current()
        })

        expect(setWorkspaceTabSession).toHaveBeenCalledWith('/ws', {
            tabIds: [],
            activeTabId: null,
        })
    })

    it('persists tab session from coordinator without a snapshot', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/b.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await coordinator.persistWorkspaceTabSession.current()
        })

        expect(setWorkspaceTabSession).toHaveBeenCalledWith('/ws', {
            tabIds: ['/ws/a.mmd', '/ws/b.mmd'],
            activeTabId: '/ws/b.mmd',
        })
    })

    it('remaps a non-active tab without changing the active tab', async () => {
        const initial = {
            tabs: [tab('/ws/old.mmd', 'old.mmd'), tab('/ws/other.mmd', 'other.mmd')],
            activeTabId: '/ws/other.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        act(() => {
            coordinator.remapTabsAfterRename.current('/ws/old.mmd', '/ws/new.mmd', 'new.mmd')
        })

        expect(result.current.tabs[0]).toMatchObject({ id: '/ws/new.mmd', path: '/ws/new.mmd', name: 'new.mmd' })
        expect(result.current.activeTabId).toBe('/ws/other.mmd')
    })

    it('closes a single file tab via the delete handler', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const cancelScheduledSave = vi.fn()
        coordinator.cancelScheduledSave.current = cancelScheduledSave
        coordinator.getAutosaveEnabled.current = () => false

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        act(() => {
            coordinator.closeTabsForDelete.current('/ws/b.mmd', false)
        })

        expect(result.current.tabs).toEqual([expect.objectContaining({ id: '/ws/a.mmd' })])
        expect(result.current.activeTabId).toBe('/ws/a.mmd')
        expect(cancelScheduledSave).toHaveBeenCalledWith('/ws/b.mmd')
    })

    it('does not change active tab when deleting an inactive file', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        coordinator.cancelScheduledSave.current = vi.fn()
        coordinator.getAutosaveEnabled.current = () => false

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        const activeBefore = result.current.activeTabId

        act(() => {
            coordinator.closeTabsForDelete.current('/ws/b.mmd', false)
        })

        expect(result.current.activeTabId).toBe(activeBefore)
    })

    it('does not flush save when re-opening the already active file', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        await act(async () => {
            await result.current.openFile('/ws/a.mmd')
        })

        expect(flushSaveOnTabLeave).not.toHaveBeenCalled()
    })

    it('does not flush save when opening the first workspace file', async () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ coordinator, workspaceRoot: '/ws' }),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        expect(flushSaveOnTabLeave).not.toHaveBeenCalled()
    })

    it('shows a generic error when opening a file fails with a non-Error value', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockRejectedValueOnce('Permission denied')

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        expect(showError).toHaveBeenCalledWith('Open failed', 'Could not read file')
    })

    it('does not flush save when focusing an already active example', async () => {
        const initial = {
            tabs: [tab('example:sample-1', 'Simple Flow.mmd', { readOnly: true })],
            activeTabId: 'example:sample-1',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        act(() => {
            result.current.openExample('sample-1')
        })

        expect(flushSaveOnTabLeave).not.toHaveBeenCalled()
    })

    it('does not flush save when opening the first example tab', () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ coordinator }),
        })

        act(() => {
            result.current.openExample('sample-1')
        })

        expect(flushSaveOnTabLeave).not.toHaveBeenCalled()
    })

    it('returns early when switching to the same active tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        await act(async () => {
            await result.current.setActiveTab('/ws/a.mmd')
        })

        expect(flushSaveOnTabLeave).not.toHaveBeenCalled()
    })

    it('does not persist session when switching to an example tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('example:sample-1', 'Simple Flow.mmd', { readOnly: true })],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        vi.mocked(setWorkspaceTabSession).mockClear()

        await act(async () => {
            await result.current.setActiveTab('example:sample-1')
        })

        expect(result.current.activeTabId).toBe('example:sample-1')
        expect(setWorkspaceTabSession).not.toHaveBeenCalled()
    })

    it('does not flush save when switching tabs with no previous active tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: null,
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.setActiveTab('/ws/a.mmd')
        })

        expect(flushSaveOnTabLeave).not.toHaveBeenCalled()
    })

    it('still schedules save for content updates on unknown tab ids', async () => {
        const coordinator = createWorkspaceCoordinatorRefs()
        const scheduleSave = vi.fn()
        coordinator.scheduleSave.current = scheduleSave
        const initial = { tabs: [tab('/ws/a.mmd', 'a.mmd')], activeTabId: '/ws/a.mmd' }

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        act(() => {
            result.current.updateTabContent('/ws/nonexistent.mmd', 'changed')
        })

        expect(result.current.tabs[0]?.content).toBe('content')
        expect(scheduleSave).toHaveBeenCalledWith('/ws/nonexistent.mmd')
    })

    it('closes an inactive tab without changing the active tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/b.mmd',
        }
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(result.current.tabs).toHaveLength(1)
        expect(result.current.activeTabId).toBe('/ws/b.mmd')
    })

    it('flushes save when opening a new file from another tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        await act(async () => {
            await result.current.openFile('/ws/b.mmd')
        })

        expect(flushSaveOnTabLeave).toHaveBeenCalledWith('/ws/a.mmd')
    })

    it('flushes save when opening a new example from a workspace tab', () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSaveOnTabLeave = vi.fn()
        coordinator.flushSaveOnTabLeave.current = flushSaveOnTabLeave

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator }),
        })

        act(() => {
            result.current.openExample('sample-1')
        })

        expect(flushSaveOnTabLeave).toHaveBeenCalledWith('/ws/a.mmd')
    })

    it('clears active tab when closing the last tab', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(result.current.tabs).toEqual([])
        expect(result.current.activeTabId).toBeNull()
    })

    it('clears active tab when deleting the only open file', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        coordinator.cancelScheduledSave.current = vi.fn()
        coordinator.getAutosaveEnabled.current = () => false

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(1)
        })

        act(() => {
            coordinator.closeTabsForDelete.current('/ws/a.mmd', false)
        })

        expect(result.current.tabs).toEqual([])
        expect(result.current.activeTabId).toBeNull()
    })

    it('flushes saves when closing tabs with autosave enabled', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const flushSave = vi.fn(async () => true)
        coordinator.flushSave.current = flushSave
        coordinator.getAutosaveEnabled.current = () => true

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })

        await waitFor(() => {
            expect(result.current.tabs).toHaveLength(2)
        })

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })
        await act(async () => {
            await result.current.closeOtherTabs('/ws/b.mmd')
        })
        await act(async () => {
            await result.current.closeAllTabs()
        })

        expect(flushSave).toHaveBeenCalledWith('/ws/a.mmd')
        expect(flushSave).toHaveBeenCalledWith('/ws/b.mmd')
    })
})
