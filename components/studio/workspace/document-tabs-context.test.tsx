import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile, stat } from '@tauri-apps/plugin-fs'
import { dismissNotification, notifyWarning, type NotifyOptions } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { setWorkspaceTabSession, addRecentFile, removeRecentFiles } from '@/lib/tauri/store'
import { confirmCloseAfterSaveFailure, confirmOpenLargeFile, confirmUnsavedChanges, showError } from '@/lib/tauri/dialog'
import {
    DocumentTabsProvider,
    useActiveTabId,
    useDocumentTabActions,
    useDocumentTabs,
    useDocumentTabsState,
    type DocumentTabsState,
} from './document-tabs-context'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from './workspace-coordinator'
import type { DocumentTab } from '@/lib/workspace/types'

vi.mock('@/lib/tauri/dialog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/tauri/dialog')>()
    return {
        ...actual,
        showError: vi.fn(actual.showError),
        confirmUnsavedChanges: vi.fn(async () => 'cancel' as const),
        confirmCloseAfterSaveFailure: vi.fn(async () => 'cancel' as const),
        confirmOpenLargeFile: vi.fn(async () => false),
    }
})

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyWarning: vi.fn(() => 'toast'),
    dismissNotification: vi.fn(),
}))

type WrapperOptions = {
    initial?: { tabs: DocumentTab[]; activeTabId: string | null }
    coordinator?: WorkspaceCoordinatorRefs
    workspaceRoot?: string | null
    /** Filled with the tabs' state, for a test standing in for the save provider. */
    stateOut?: { current?: DocumentTabsState }
}

function createTabsWrapper(options: WrapperOptions = {}) {
    return function Wrapper({ children }: { children: ReactNode }) {
        const optionsRef = useRef(options)
        const tabsState = useDocumentTabsState()
        if (optionsRef.current.stateOut) optionsRef.current.stateOut.current = tabsState
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
        vi.mocked(readFile).mockResolvedValueOnce(new TextEncoder().encode('graph TD\n  A --> B'))

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

    it('opens a file that is not UTF-8 read-only, says why, and lets the user edit it as UTF-8', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        // "Café" saved by old Notepad as ANSI (Windows-1252): not valid UTF-8.
        vi.mocked(readFile).mockResolvedValueOnce(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ workspaceRoot: '/ws' }) })

        await act(async () => {
            await result.current.openFile('/ws/old.md')
        })

        expect(result.current.tabs[0]).toMatchObject({ content: 'Café', readOnly: true, encodingIssue: 'legacy-encoding' })
        expect(notifyWarning).toHaveBeenCalledWith('old.md is read-only', {
            id: 'read-only:/ws/old.md',
            description: "It isn't saved as UTF-8, so it's shown as Windows-1252 and left as it is. If you edit it, it will be saved as UTF-8.",
            timeout: 0,
            action: { label: 'Edit as UTF-8', onClick: expect.any(Function) },
        })

        // Typing is ignored while it is read-only, so nothing can be saved over the original bytes.
        act(() => result.current.updateTabContent('/ws/old.md', 'changed'))
        expect(result.current.tabs[0]?.content).toBe('Café')

        const options = vi.mocked(notifyWarning).mock.calls[0]![1] as NotifyOptions
        act(() => options.action!.onClick())
        expect(dismissNotification).toHaveBeenCalledWith('read-only:/ws/old.md')
        expect(result.current.tabs[0]).toMatchObject({ readOnly: false, encodingIssue: undefined, format: { encoding: 'utf-8', bom: false } })

        act(() => result.current.updateTabContent('/ws/old.md', 'Café!'))
        expect(result.current.tabs[0]).toMatchObject({ content: 'Café!', isDirty: true })
    })

    it('still lets the user edit a read-only file after its notice was closed', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        const big = { isFile: true, isDirectory: false, isSymlink: false, size: 6 * 1024 * 1024, mtime: null, nlink: null }
        vi.mocked(stat).mockResolvedValue(big as never)
        vi.mocked(confirmOpenLargeFile).mockResolvedValue(true)
        vi.mocked(readFile)
            .mockResolvedValueOnce(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))
            .mockResolvedValueOnce(new TextEncoder().encode('# log'))
            .mockResolvedValueOnce(new TextEncoder().encode('PK\0\0data'))
        const { result } = renderHook(() => ({ tabs: useDocumentTabs(), actions: useDocumentTabActions() }), {
            wrapper: createTabsWrapper({ workspaceRoot: '/ws' }),
        })
        for (const path of ['/ws/old.md', '/ws/big.md', '/ws/data.md']) {
            await act(async () => {
                await result.current.tabs.openFile(path)
            })
        }
        expect(result.current.tabs.tabs.map((t) => t.readOnly)).toEqual([true, true, true])
        vi.mocked(stat).mockReset()

        act(() => result.current.actions.makeTabEditable('/ws/old.md'))
        // Typing works straight away, before React draws again.
        act(() => {
            result.current.actions.makeTabEditable('/ws/big.md')
            result.current.actions.updateTabContent('/ws/big.md', '# log!')
        })
        act(() => result.current.actions.makeTabEditable('/ws/data.md'))

        const [old, large, binary] = result.current.tabs.tabs
        expect(old).toMatchObject({ readOnly: false, encodingIssue: undefined, format: { encoding: 'utf-8', bom: false } })
        expect(large).toMatchObject({ readOnly: false, largeFile: undefined, content: '# log!', isDirty: true })
        // Editing a file that looks binary could damage it, so it stays read-only.
        expect(binary).toMatchObject({ readOnly: true, encodingIssue: 'binary' })
        expect(dismissNotification).toHaveBeenCalledWith('read-only:/ws/big.md')
    })

    it('keeps the encoding of a UTF-16 file on its tab', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readFile).mockResolvedValueOnce(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ workspaceRoot: '/ws' }) })

        await act(async () => {
            await result.current.openFile('/ws/ps.md')
        })

        expect(result.current.tabs[0]).toMatchObject({ content: 'A', format: { encoding: 'utf-16le', bom: true } })
        expect(result.current.tabs[0]?.readOnly).toBeUndefined()
        expect(notifyWarning).not.toHaveBeenCalled()
    })

    it('asks before opening a very large file, and opens it read-only with a way to edit it anyway', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        const big = { isFile: true, isDirectory: false, isSymlink: false, size: 6 * 1024 * 1024, mtime: null, nlink: null }
        // One look at the size before each open, and one more when the file is read.
        vi.mocked(stat)
            .mockResolvedValueOnce(big as never)
            .mockResolvedValueOnce(big as never)
            .mockResolvedValueOnce(big as never)
        vi.mocked(confirmOpenLargeFile).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
        vi.mocked(readFile).mockResolvedValueOnce(new TextEncoder().encode('# log'))
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ workspaceRoot: '/ws' }) })

        await act(async () => {
            await result.current.openFile('/ws/big.md')
        })
        expect(confirmOpenLargeFile).toHaveBeenCalledWith('big.md', '6.0 MB')
        expect(readFile).not.toHaveBeenCalled()
        expect(result.current.tabs).toEqual([])

        await act(async () => {
            await result.current.openFile('/ws/big.md')
        })
        expect(result.current.tabs[0]).toMatchObject({ content: '# log', readOnly: true, largeFile: true })
        expect(notifyWarning).toHaveBeenCalledWith('big.md is read-only', {
            id: 'read-only:/ws/big.md',
            description: "It's 6.0 MB, which is big enough to make editing slow.",
            timeout: 0,
            action: { label: 'Edit Anyway', onClick: expect.any(Function) },
        })
        act(() => result.current.updateTabContent('/ws/big.md', 'typed'))
        expect(result.current.tabs[0]?.content).toBe('# log')

        const options = vi.mocked(notifyWarning).mock.calls[0]![1] as NotifyOptions
        act(() => options.action!.onClick())
        expect(dismissNotification).toHaveBeenCalledWith('read-only:/ws/big.md')
        expect(result.current.tabs[0]).toMatchObject({ readOnly: false, largeFile: undefined })
        act(() => result.current.updateTabContent('/ws/big.md', '# log!'))
        expect(result.current.tabs[0]).toMatchObject({ content: '# log!', isDirty: true })
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

        expect(showError).toHaveBeenCalledWith('Unsupported file', 'Scrivon supports .md, .markdown, .mmd and .mermaid files only.')
        expect(result.current.tabs).toHaveLength(0)
    })

    it('shows an error when opening a file fails', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readFile).mockRejectedValueOnce(new Error('Permission denied'))

        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper(),
        })

        await act(async () => {
            await result.current.openFile('/ws/new.mmd')
        })

        expect(showError).toHaveBeenCalledWith('Open failed', 'Permission denied')
    })

    it('drops a file that is not there from the recent files, but not one that is only locked', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ workspaceRoot: 'C:\\ws' }),
        })

        vi.mocked(readFile).mockRejectedValueOnce(
            'failed to open file at path: C:\\ws\\gone.md with error: The system cannot find the file specified. (os error 2)'
        )
        await act(async () => {
            await result.current.openFile('C:\\ws\\gone.md')
        })
        expect(removeRecentFiles).toHaveBeenCalledWith('C:\\ws', 'C:\\ws\\gone.md')

        vi.mocked(removeRecentFiles).mockClear()
        vi.mocked(readFile).mockRejectedValueOnce(
            'failed to open file at path: C:\\ws\\busy.md with error: The process cannot access the file because it is being used by another process. (os error 32)'
        )
        await act(async () => {
            await result.current.openFile('C:\\ws\\busy.md')
        })
        expect(removeRecentFiles).not.toHaveBeenCalled()
        expect(showError).toHaveBeenCalledTimes(2)
    })

    it('opens the file without an error when remembering the open tabs fails', async () => {
        vi.mocked(setWorkspaceTabSession).mockRejectedValue('The process cannot access the file. (os error 32)')
        vi.mocked(addRecentFile).mockRejectedValue('The process cannot access the file. (os error 32)')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const unhandled = vi.fn()
        process.on('unhandledRejection', unhandled)
        try {
            const { result } = renderHook(() => useDocumentTabs(), {
                wrapper: createTabsWrapper({ workspaceRoot: '/ws' }),
            })

            await act(async () => {
                await result.current.openFile('/ws/a.mmd')
            })
            await act(async () => {
                await result.current.openFile('/ws/b.mmd')
            })
            await act(async () => {
                await result.current.setActiveTab('/ws/a.mmd')
            })
            await new Promise((resolve) => setTimeout(resolve, 0))

            expect(showError).not.toHaveBeenCalled()
            expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/a.mmd', '/ws/b.mmd'])
            expect(result.current.activeTabId).toBe('/ws/a.mmd')
            expect(unhandled).not.toHaveBeenCalled()
        } finally {
            process.off('unhandledRejection', unhandled)
            warn.mockRestore()
            vi.mocked(setWorkspaceTabSession)
                .mockReset()
                .mockImplementation(async () => undefined)
            vi.mocked(addRecentFile)
                .mockReset()
                .mockImplementation(async () => [])
        }
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
        vi.mocked(readFile).mockResolvedValueOnce(new TextEncoder().encode('content'))

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

    it('keeps the active tab selected when the folder it is in is renamed', async () => {
        const initial = {
            tabs: [tab('/ws/other.mmd', 'other.mmd'), tab('/ws/docs/readme.md', 'readme.md')],
            activeTabId: '/ws/docs/readme.md',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })
        await waitFor(() => expect(result.current.tabs).toHaveLength(2))
        vi.mocked(setWorkspaceTabSession).mockClear()

        act(() => {
            coordinator.remapTabsAfterRename.current('/ws/docs', '/ws/manual', 'manual')
        })

        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/other.mmd', '/ws/manual/readme.md'])
        expect(result.current.activeTabId).toBe('/ws/manual/readme.md')
        expect(result.current.activeTab).toMatchObject({ path: '/ws/manual/readme.md', name: 'readme.md' })
        expect(setWorkspaceTabSession).toHaveBeenCalledWith('/ws', {
            tabIds: ['/ws/other.mmd', '/ws/manual/readme.md'],
            activeTabId: '/ws/manual/readme.md',
        })
    })

    it('closes the read-only notice of a renamed file, whose button would no longer find its tab', async () => {
        const initial = {
            tabs: [
                tab('/ws/old.md', 'old.md', { readOnly: true, largeFile: true }),
                tab('/ws/docs/legacy.md', 'legacy.md', { readOnly: true, encodingIssue: 'legacy-encoding' }),
                tab('/ws/docs/plain.md', 'plain.md'),
                tab('/ws/kept.md', 'kept.md', { readOnly: true, largeFile: true }),
            ],
            activeTabId: '/ws/old.md',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })
        await waitFor(() => expect(result.current.tabs).toHaveLength(4))
        vi.mocked(dismissNotification).mockClear()

        act(() => coordinator.remapTabsAfterRename.current('/ws/old.md', '/ws/new.md', 'new.md'))
        act(() => coordinator.remapTabsAfterRename.current('/ws/docs', '/ws/manual', 'manual'))

        expect(vi.mocked(dismissNotification).mock.calls).toEqual([['read-only:/ws/old.md'], ['read-only:/ws/docs/legacy.md']])
        // The bar above the editor still offers to edit it, under its new name.
        act(() => result.current.makeTabEditable('/ws/new.md'))
        expect(result.current.tabs[0]).toMatchObject({ id: '/ws/new.md', readOnly: false })
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

    it('tells which tabs a delete would close, with their unsaved changes, before it happens', async () => {
        const initial = {
            tabs: [tab('/ws/docs/readme.md', 'readme.md'), tab('/ws/docs/guide/intro.md', 'intro.md'), tab('/ws/other.mmd', 'other.mmd')],
            activeTabId: '/ws/docs/readme.md',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        coordinator.getAutosaveEnabled.current = () => false
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }),
        })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        act(() => result.current.updateTabContent('/ws/docs/guide/intro.md', 'edited'))

        expect(coordinator.findTabsToCloseOnDelete.current('/ws/docs', true)).toEqual([
            expect.objectContaining({ path: '/ws/docs/readme.md', isDirty: false }),
            expect.objectContaining({ path: '/ws/docs/guide/intro.md', isDirty: true }),
        ])
        expect(coordinator.findTabsToCloseOnDelete.current('/ws/other.mmd', false)).toEqual([expect.objectContaining({ path: '/ws/other.mmd' })])
        // Nothing closed yet.
        expect(result.current.tabs).toHaveLength(3)
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
        expect(() => renderHook(() => useDocumentTabActions())).toThrow('useDocumentTabActions must be used within WorkspaceProvider')
        expect(() => renderHook(() => useActiveTabId())).toThrow('useActiveTabId must be used within WorkspaceProvider')
    })

    it('leaves parts that only use the tab actions or the open tab id alone while the user types', async () => {
        const initial = { tabs: [tab('/ws/a.md', 'a.md'), tab('/ws/b.md', 'b.md')], activeTabId: '/ws/a.md' }
        const renders = { actions: 0, activeId: 0 }
        const seenIds: Array<string | null> = []
        function ActionsOnly() {
            useDocumentTabActions()
            renders.actions += 1
            return null
        }
        function ActiveIdOnly() {
            seenIds.push(useActiveTabId())
            renders.activeId += 1
            return null
        }
        const TabsWrapper = createTabsWrapper({ initial })
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: ({ children }) => (
                <TabsWrapper>
                    <ActionsOnly />
                    <ActiveIdOnly />
                    {children}
                </TabsWrapper>
            ),
        })
        await waitFor(() => expect(result.current.activeTabId).toBe('/ws/a.md'))
        const before = { ...renders }

        act(() => result.current.updateTabContent('/ws/a.md', 'typed'))
        act(() => result.current.updateTabContent('/ws/a.md', 'typed more'))

        expect(result.current.activeTab?.content).toBe('typed more')
        expect(renders).toEqual(before)

        await act(async () => {
            await result.current.setActiveTab('/ws/b.md')
        })

        expect(seenIds.at(-1)).toBe('/ws/b.md')
        expect(renders.actions).toBe(before.actions)
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
        vi.mocked(readFile).mockRejectedValueOnce('Permission denied')

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

describe('closing tabs with unsaved changes', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(false)
    })

    function setup({ autosave, flushResult = true }: { autosave: boolean; flushResult?: boolean | (() => boolean) }) {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd', { isDirty: true }), tab('/ws/b.mmd', 'b.mmd', { isDirty: true }), tab('/ws/c.mmd', 'c.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const stateOut: { current?: DocumentTabsState } = {}
        /** What a save that worked does: the text it wrote is on disk, so the tab has no edits left unless typed since. */
        const markSaved = (id: string, content?: string) => {
            const saved = (t: DocumentTab) => (t.id === id && (content === undefined || t.content === content) ? { ...t, isDirty: false } : t)
            const state = stateOut.current!
            state.tabsRef.current = state.tabsRef.current.map(saved)
            state.setTabs((prev) => prev.map(saved))
        }
        const flushSave = vi.fn(async (id: string) => {
            const ok = typeof flushResult === 'function' ? flushResult() : flushResult
            if (ok) markSaved(id)
            return ok
        })
        const cancelScheduledSave = vi.fn()
        coordinator.flushSave.current = flushSave
        coordinator.cancelScheduledSave.current = cancelScheduledSave
        coordinator.getAutosaveEnabled.current = () => autosave
        coordinator.getSaveError.current = () => 'Access is denied. (os error 5)'
        const rendered = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws', stateOut }),
        })
        return { ...rendered, coordinator, flushSave, cancelScheduledSave, markSaved, stateOut }
    }

    it('keeps the tab open when the user cancels the unsaved-changes prompt', async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('cancel')
        const { result, flushSave } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(confirmUnsavedChanges).toHaveBeenCalledWith(['a.mmd'])
        expect(flushSave).not.toHaveBeenCalled()
        expect(result.current.tabs).toHaveLength(3)
    })

    it("closes without writing when the user picks Don't Save", async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('discard')
        const { result, flushSave, cancelScheduledSave } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(flushSave).not.toHaveBeenCalled()
        expect(cancelScheduledSave).toHaveBeenCalledWith('/ws/a.mmd')
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/b.mmd', '/ws/c.mmd'])
    })

    it('saves and then closes when the user picks Save', async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('save')
        const { result, flushSave } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(flushSave).toHaveBeenCalledWith('/ws/a.mmd')
        expect(result.current.tabs).toHaveLength(2)
    })

    it('asks once for every unsaved tab when closing all', async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('cancel')
        const { result } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        await act(async () => {
            await result.current.closeAllTabs()
        })
        await act(async () => {
            await result.current.closeOtherTabs('/ws/c.mmd')
        })

        expect(confirmUnsavedChanges).toHaveBeenNthCalledWith(1, ['a.mmd', 'b.mmd'])
        expect(confirmUnsavedChanges).toHaveBeenNthCalledWith(2, ['a.mmd', 'b.mmd'])
        expect(result.current.tabs).toHaveLength(3)
    })

    it('keeps a tab whose save failed open unless the user chooses to close without saving', async () => {
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('cancel').mockResolvedValueOnce('discard')
        const { result, flushSave } = setup({ autosave: true, flushResult: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledWith([{ name: 'a.mmd', error: 'Access is denied. (os error 5)' }])
        expect(result.current.tabs).toHaveLength(3)

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })
        expect(flushSave).toHaveBeenCalledTimes(2)
        expect(result.current.tabs).toHaveLength(2)
    })

    it('tries the failed save again when the user picks Try Again', async () => {
        let attempts = 0
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('save')
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('retry')
        const { result, flushSave } = setup({ autosave: false, flushResult: () => ++attempts > 1 })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(flushSave).toHaveBeenCalledTimes(2)
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledTimes(1)
        expect(result.current.tabs).toHaveLength(2)
    })

    it('treats a save that hangs for 10 seconds as failed so closing is never stuck', async () => {
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('discard')
        const { result, coordinator } = setup({ autosave: true })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))
        coordinator.flushSave.current = vi.fn(() => new Promise<boolean>(() => {}))

        vi.useFakeTimers()
        try {
            let closing!: Promise<void>
            act(() => {
                closing = result.current.closeTab('/ws/a.mmd')
            })
            await act(async () => {
                await vi.advanceTimersByTimeAsync(10_000)
                await closing
            })
        } finally {
            vi.useRealTimers()
        }

        // Saves of one tab wait their turn, so the question says it is still saving rather than offering a new try.
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledWith([{ name: 'a.mmd', stillSaving: true }])
        expect(result.current.tabs).toHaveLength(2)
    })

    it('does not count time the user spends answering a question during the save', async () => {
        const { result, coordinator, markSaved } = setup({ autosave: true })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))
        // The save is waiting on "File changed on disk: Overwrite?" for 25 seconds, then succeeds.
        let asking = true
        let finish!: (ok: boolean) => void
        coordinator.isAskingUser.current = () => asking
        coordinator.flushSave.current = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)))

        vi.useFakeTimers()
        try {
            let closing!: Promise<void>
            act(() => {
                closing = result.current.closeTab('/ws/a.mmd')
            })
            await act(async () => {
                await vi.advanceTimersByTimeAsync(25_000)
            })
            expect(confirmCloseAfterSaveFailure).not.toHaveBeenCalled()
            asking = false
            markSaved('/ws/a.mmd')
            finish(true)
            await act(async () => {
                await closing
            })
        } finally {
            vi.useRealTimers()
        }

        expect(confirmCloseAfterSaveFailure).not.toHaveBeenCalled()
        expect(result.current.tabs).toHaveLength(2)
    })

    it('gives a second close request the answer to the first instead of asking twice or ignoring it', async () => {
        let answer!: (choice: 'discard') => void
        vi.mocked(confirmUnsavedChanges).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
        const { result, coordinator } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        let first!: Promise<void>
        let second!: Promise<boolean>
        act(() => {
            first = result.current.closeTab('/ws/a.mmd')
            // Like a second click on the window's X while the first question is still open.
            second = coordinator.confirmCloseTabs.current(['/ws/a.mmd'])
        })
        expect(confirmUnsavedChanges).toHaveBeenCalledTimes(1)

        await act(async () => {
            answer('discard')
            await first
        })
        await expect(second).resolves.toBe(true)
        expect(confirmUnsavedChanges).toHaveBeenCalledTimes(1)
        expect(result.current.tabs).toHaveLength(2)
    })

    it('asks about the other tabs once the first question is answered, when the second request is about more', async () => {
        let answer!: (choice: 'discard') => void
        vi.mocked(confirmUnsavedChanges)
            .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
            .mockResolvedValueOnce('cancel')
        const { result, coordinator } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        let first!: Promise<void>
        let all!: Promise<boolean>
        act(() => {
            first = result.current.closeTab('/ws/a.mmd')
            all = coordinator.confirmCloseTabs.current()
        })
        await act(async () => {
            answer('discard')
            await first
        })

        await expect(all).resolves.toBe(false)
        // a.mmd is closed by then, so only b.mmd is left to ask about.
        expect(confirmUnsavedChanges).toHaveBeenLastCalledWith(['b.mmd'])
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/b.mmd', '/ws/c.mmd'])
    })

    it('saves text typed while the closing saves ran before the tabs go, also in a tab that had no edits', async () => {
        const { result, coordinator, markSaved, stateOut } = setup({ autosave: true })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))
        const written: Array<[id: string, content: string]> = []
        let finishA: (() => void) | undefined
        coordinator.flushSave.current = vi.fn(async (id: string) => {
            const content = stateOut.current!.tabsRef.current.find((t) => t.id === id)!.content
            // The first save of a.mmd is slow, like one on a network drive.
            if (id === '/ws/a.mmd' && !written.some(([w]) => w === id)) await new Promise<void>((resolve) => (finishA = resolve))
            written.push([id, content])
            markSaved(id, content)
            return true
        })

        let closing!: Promise<void>
        act(() => {
            closing = result.current.closeAllTabs()
        })
        await waitFor(() => expect(finishA).toBeDefined())
        act(() => {
            result.current.updateTabContent('/ws/a.mmd', 'typed in a while it saved')
            result.current.updateTabContent('/ws/c.mmd', 'typed in c, which had no edits')
        })
        await act(async () => {
            finishA!()
            await closing
        })

        expect(written).toContainEqual(['/ws/a.mmd', 'typed in a while it saved'])
        expect(written).toContainEqual(['/ws/c.mmd', 'typed in c, which had no edits'])
        expect(confirmCloseAfterSaveFailure).not.toHaveBeenCalled()
        expect(result.current.tabs).toEqual([])
    })

    it('asks, rather than saving for ever, when the text keeps changing while it is saved', async () => {
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('cancel').mockResolvedValueOnce('discard')
        const { result, coordinator, markSaved } = setup({ autosave: true })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))
        let typed = 0
        const flushSave = vi.fn(async (id: string) => {
            markSaved(id)
            result.current.updateTabContent(id, `still typing ${++typed}`)
            return true
        })
        coordinator.flushSave.current = flushSave

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })
        expect(flushSave).toHaveBeenCalledTimes(3)
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledWith([{ name: 'a.mmd', error: 'It was edited again while it was being saved.' }])
        expect(result.current.tabs).toHaveLength(3)

        await act(async () => {
            await result.current.closeTab('/ws/a.mmd')
        })
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/b.mmd', '/ws/c.mmd'])
    })

    it('still saves text typed into another closing tab when the user closes one that could not be saved', async () => {
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('discard')
        const { result, coordinator, markSaved, stateOut } = setup({ autosave: true })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))
        const written: Array<[id: string, content: string]> = []
        let finishB: (() => void) | undefined
        coordinator.flushSave.current = vi.fn(async (id: string) => {
            // a.mmd's file is locked by another program.
            if (id === '/ws/a.mmd') return false
            const content = stateOut.current!.tabsRef.current.find((t) => t.id === id)!.content
            // The first save of b.mmd is slow, like one on a network drive.
            if (id === '/ws/b.mmd' && !written.some(([w]) => w === id)) await new Promise<void>((resolve) => (finishB = resolve))
            written.push([id, content])
            markSaved(id, content)
            return true
        })

        let closing!: Promise<void>
        act(() => {
            closing = result.current.closeAllTabs()
        })
        await waitFor(() => expect(finishB).toBeDefined())
        act(() => {
            result.current.updateTabContent('/ws/b.mmd', 'typed in b while it saved')
        })
        await act(async () => {
            finishB!()
            await closing
        })

        // Only a.mmd was asked about, so only its edits go unsaved.
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledTimes(1)
        expect(confirmCloseAfterSaveFailure).toHaveBeenCalledWith([{ name: 'a.mmd', error: 'Access is denied. (os error 5)' }])
        expect(written).toContainEqual(['/ws/b.mmd', 'typed in b while it saved'])
        expect(result.current.tabs).toEqual([])
    })

    it('leaves the tabs as they are until they really close', async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('discard')
        const { result, coordinator, cancelScheduledSave } = setup({ autosave: false })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        // A folder switch asks first, but may then not happen (another folder was picked meanwhile).
        await act(async () => {
            await expect(coordinator.confirmCloseTabs.current()).resolves.toBe(true)
        })
        expect(cancelScheduledSave).not.toHaveBeenCalled()

        act(() => coordinator.clearTabs.current())
        expect(cancelScheduledSave.mock.calls.map(([id]) => id)).toEqual(['/ws/a.mmd', '/ws/b.mmd', '/ws/c.mmd'])
    })
})

describe('opening files that are slow to read', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(true)
    })

    /** Makes reading `slowPath` wait until the test lets it finish; other files read straight away. */
    function slowRead(slowPath: string) {
        let finish!: () => void
        const done = new Promise<void>((resolve) => (finish = resolve))
        vi.mocked(readFile).mockImplementation(async (path) => {
            if (String(path) === slowPath) await done
            return new TextEncoder().encode(`text of ${String(path)}`)
        })
        return finish
    }

    afterEach(() => {
        vi.mocked(readFile).mockReset()
        vi.mocked(readFile).mockResolvedValue(new Uint8Array())
    })

    it('opens a file once when it is clicked again while it is still being read', async () => {
        const finish = slowRead('/ws/big.md')
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ workspaceRoot: '/ws' }) })

        let first!: Promise<void>
        let second!: Promise<void>
        act(() => {
            first = result.current.openFile('/ws/big.md')
            second = result.current.openFile('/ws/big.md')
        })
        await act(async () => {
            finish()
            await Promise.all([first, second])
        })

        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/big.md'])
        expect(result.current.activeTabId).toBe('/ws/big.md')
        expect(readFile).toHaveBeenCalledTimes(1)
        expect(setWorkspaceTabSession).toHaveBeenLastCalledWith('/ws', { tabIds: ['/ws/big.md'], activeTabId: '/ws/big.md' })
    })

    it('shows the file clicked last when an earlier, slower one finishes after it', async () => {
        const finish = slowRead('/ws/big.md')
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ workspaceRoot: '/ws' }) })

        let big!: Promise<void>
        act(() => {
            big = result.current.openFile('/ws/big.md')
        })
        await act(async () => {
            await result.current.openFile('/ws/small.md')
        })
        await act(async () => {
            finish()
            await big
        })

        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/small.md', '/ws/big.md'])
        expect(result.current.activeTabId).toBe('/ws/small.md')
    })

    it('drops a file still being read when its folder is switched, and keeps the old folder’s tab list', async () => {
        const finish = slowRead('/ws/big.md')
        const coordinator = createWorkspaceCoordinatorRefs()
        const options: WrapperOptions = { coordinator, workspaceRoot: '/ws' }
        const { result, rerender } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper(options) })

        let big!: Promise<void>
        act(() => {
            big = result.current.openFile('/ws/big.md')
        })
        await waitFor(() => expect(readFile).toHaveBeenCalledTimes(1))
        // Open Recent: the tabs go, the next folder opens and its saved tabs come back before the read ends.
        act(() => coordinator.clearTabs.current())
        options.workspaceRoot = '/other'
        rerender()
        act(() => coordinator.setTabsFromWorkspace.current([tab('/other/notes.md', 'notes.md')], '/other/notes.md'))
        await act(async () => {
            finish()
            await big
        })

        expect(result.current.tabs.map((t) => t.id)).toEqual(['/other/notes.md'])
        expect(result.current.activeTabId).toBe('/other/notes.md')
        expect(setWorkspaceTabSession).not.toHaveBeenCalledWith('/ws', expect.anything())
        expect(addRecentFile).not.toHaveBeenCalled()

        // Clicking it again reads it afresh instead of waiting on the dropped read.
        await act(async () => {
            await result.current.openFile('/ws/big.md')
        })
        expect(readFile).toHaveBeenCalledTimes(2)
        expect(result.current.tabs.map((t) => t.id)).toEqual(['/other/notes.md', '/ws/big.md'])
    })

    it('drops a file still being read when the folder is closed', async () => {
        const finish = slowRead('/ws/big.md')
        const coordinator = createWorkspaceCoordinatorRefs()
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ coordinator, workspaceRoot: '/ws' }) })

        let big!: Promise<void>
        act(() => {
            big = result.current.openFile('/ws/big.md')
        })
        act(() => coordinator.clearTabs.current())
        await act(async () => {
            finish()
            await big
        })

        expect(result.current.tabs).toEqual([])
        expect(result.current.activeTabId).toBeNull()
        expect(setWorkspaceTabSession).not.toHaveBeenCalled()
    })

    it('keeps the tab the user switched to while another file was still being read', async () => {
        const initial = { tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')], activeTabId: '/ws/a.mmd' }
        const finish = slowRead('/ws/big.md')
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ initial, workspaceRoot: '/ws' }) })
        await waitFor(() => expect(result.current.tabs).toHaveLength(2))

        let big!: Promise<void>
        act(() => {
            big = result.current.openFile('/ws/big.md')
        })
        await act(async () => {
            await result.current.setActiveTab('/ws/b.mmd')
        })
        await act(async () => {
            finish()
            await big
        })

        expect(result.current.tabs.map((t) => t.id)).toEqual(['/ws/a.mmd', '/ws/b.mmd', '/ws/big.md'])
        expect(result.current.activeTabId).toBe('/ws/b.mmd')
    })
})

describe('changes to several tabs at once', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('keeps an edit to another tab made just before a tab is closed', async () => {
        const initial = { tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd')], activeTabId: '/ws/a.mmd' }
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ initial, workspaceRoot: '/ws' }) })
        await waitFor(() => expect(result.current.tabs).toHaveLength(2))

        await act(async () => {
            result.current.updateTabContent('/ws/b.mmd', 'typed in b')
            await result.current.closeTab('/ws/a.mmd')
        })

        expect(result.current.tabs).toEqual([expect.objectContaining({ id: '/ws/b.mmd', content: 'typed in b', isDirty: true })])
        expect(result.current.activeTabId).toBe('/ws/b.mmd')
    })

    it('keeps an edit to another tab made just before a file is renamed or deleted', async () => {
        const initial = {
            tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/b.mmd', 'b.mmd'), tab('/ws/c.mmd', 'c.mmd')],
            activeTabId: '/ws/a.mmd',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }) })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        act(() => {
            result.current.updateTabContent('/ws/b.mmd', 'typed in b')
            coordinator.remapTabsAfterRename.current('/ws/a.mmd', '/ws/renamed.mmd', 'renamed.mmd')
            coordinator.closeTabsForDelete.current('/ws/c.mmd', false)
        })

        expect(result.current.tabs).toEqual([
            expect.objectContaining({ id: '/ws/renamed.mmd' }),
            expect.objectContaining({ id: '/ws/b.mmd', content: 'typed in b', isDirty: true }),
        ])
        expect(result.current.activeTabId).toBe('/ws/renamed.mmd')
    })

    it('keeps a keystroke made in the same moment as the saved tabs are put back', async () => {
        const initial = { tabs: [tab('/ws/opened.mmd', 'opened.mmd')], activeTabId: '/ws/opened.mmd' }
        const coordinator = createWorkspaceCoordinatorRefs()
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }) })
        await waitFor(() => expect(result.current.tabs).toHaveLength(1))

        act(() => {
            result.current.updateTabContent('/ws/opened.mmd', 'typed while restoring')
            coordinator.setTabsFromWorkspace.current(
                [tab('/ws/restored.mmd', 'restored.mmd'), tab('/ws/opened.mmd', 'opened.mmd')],
                '/ws/restored.mmd'
            )
        })

        expect(result.current.tabs).toEqual([
            expect.objectContaining({ id: '/ws/restored.mmd' }),
            expect.objectContaining({ id: '/ws/opened.mmd', content: 'typed while restoring', isDirty: true }),
        ])
        expect(result.current.activeTabId).toBe('/ws/opened.mmd')
    })

    it('puts unsaved text kept from a crash into the tab opened meanwhile, and hands back what it could not', async () => {
        // The version of each file the kept text was written on; a.md and c.md were opened on it.
        const writtenOn = { mtimeMs: 1, size: 6 }
        const initial = {
            tabs: [
                tab('/ws/a.md', 'a.md', { readOnly: true, largeFile: true, disk: { stamp: { ...writtenOn } } }),
                tab('/ws/b.md', 'b.md', { content: 'typed since', isDirty: true }),
                // Typed in and saved since it was opened: no edits now, but newer text and a newer file.
                tab('/ws/c.md', 'c.md', { content: 'typed and saved', disk: { stamp: { mtimeMs: 2, size: 15 } } }),
            ],
            activeTabId: '/ws/a.md',
        }
        const coordinator = createWorkspaceCoordinatorRefs()
        const scheduleBackup = vi.fn()
        coordinator.scheduleBackup.current = scheduleBackup
        const { result } = renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }) })
        await waitFor(() => expect(result.current.tabs).toHaveLength(3))

        const keptB = tab('/ws/b.md', 'b.md', { content: 'kept b', isDirty: true, disk: { stamp: null } })
        const keptC = tab('/ws/c.md', 'c.md', { content: 'kept c', isDirty: true, disk: { stamp: writtenOn } })
        let left!: DocumentTab[]
        act(() => {
            left = coordinator.setTabsFromWorkspace.current(
                [tab('/ws/a.md', 'a.md', { content: 'kept a', isDirty: true, disk: { stamp: writtenOn } }), keptB, keptC],
                '/ws/b.md'
            )
        })

        // a.md had no edits: it takes the kept text, editable as it was then. b.md and c.md were edited since: left as they are.
        expect(result.current.tabs).toEqual([
            expect.objectContaining({ id: '/ws/a.md', content: 'kept a', isDirty: true, disk: { stamp: writtenOn } }),
            expect.objectContaining({ id: '/ws/b.md', content: 'typed since', isDirty: true }),
            expect.objectContaining({ id: '/ws/c.md', content: 'typed and saved', isDirty: false }),
        ])
        expect(result.current.tabs[0]).not.toHaveProperty('readOnly')
        expect(result.current.tabs[0]).not.toHaveProperty('largeFile')
        expect(left).toEqual([keptB, keptC])
        // The text put back is copied again, as after any edit.
        expect(scheduleBackup).toHaveBeenCalledTimes(1)
        expect(scheduleBackup).toHaveBeenCalledWith('/ws/a.md')
        expect(result.current.activeTabId).toBe('/ws/a.md')
    })

    it('never saves the same file twice in the list of open tabs', async () => {
        const initial = { tabs: [tab('/ws/a.mmd', 'a.mmd'), tab('/ws/a.mmd', 'a.mmd')], activeTabId: '/ws/a.mmd' }
        const coordinator = createWorkspaceCoordinatorRefs()
        renderHook(() => useDocumentTabs(), { wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws' }) })

        await act(async () => {
            await coordinator.persistWorkspaceTabSession.current()
        })

        expect(setWorkspaceTabSession).toHaveBeenLastCalledWith('/ws', { tabIds: ['/ws/a.mmd'], activeTabId: '/ws/a.mmd' })
    })
})

describe('reloading a file another app changed', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(isTauri).mockReturnValue(true)
    })

    afterEach(() => {
        vi.mocked(readFile).mockReset()
        vi.mocked(readFile).mockResolvedValue(new Uint8Array())
        vi.mocked(stat).mockReset()
        vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 0, mtime: null, nlink: null } as never)
    })

    it('puts the new text in the editor as the tab takes it, before the screen draws again', async () => {
        const initial = { tabs: [tab('/ws/a.md', 'a.md', { content: 'mine', disk: { stamp: { mtimeMs: 1, size: 4 } } })], activeTabId: '/ws/a.md' }
        const coordinator = createWorkspaceCoordinatorRefs()
        const stateOut: { current?: DocumentTabsState } = {}
        const inTabWhenReplaced: string[] = []
        coordinator.replaceEditorText.current = vi.fn((id: string) => {
            inTabWhenReplaced.push(stateOut.current!.tabsRef.current.find((t) => t.id === id)!.content)
        })
        const { result } = renderHook(() => useDocumentTabs(), {
            wrapper: createTabsWrapper({ initial, coordinator, workspaceRoot: '/ws', stateOut }),
        })
        await waitFor(() => expect(result.current.tabs).toHaveLength(1))
        vi.mocked(stat).mockResolvedValue({ isFile: true, isDirectory: false, isSymlink: false, size: 6, mtime: new Date(2), nlink: null } as never)
        vi.mocked(readFile).mockResolvedValue(new TextEncoder().encode('theirs'))

        await act(async () => {
            await coordinator.reloadChangedTabs.current()
        })

        expect(coordinator.replaceEditorText.current).toHaveBeenCalledExactlyOnceWith('/ws/a.md', 'theirs')
        expect(inTabWhenReplaced).toEqual(['theirs'])
        expect(result.current.tabs[0]).toMatchObject({ content: 'theirs', isDirty: false, disk: { stamp: { mtimeMs: 2, size: 6 } } })
    })
})
