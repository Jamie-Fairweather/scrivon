import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isTauri } from '@/lib/tauri/platform'
import { setWorkspaceTabSession } from '@/lib/tauri/store'
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
})
