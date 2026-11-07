import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rename, writeFile } from '@tauri-apps/plugin-fs'
import { dismissNotification, notifyError, type NotifyOptions } from '@/lib/notify'
import { deleteUnsavedBackup, saveUnsavedBackup, settleUnsavedBackups } from '@/lib/tauri/backups'
import { confirmCloseAfterSaveFailure, confirmUnsavedChanges } from '@/lib/tauri/dialog'
import { isTauri } from '@/lib/tauri/platform'
import type { DocumentTab } from '@/lib/workspace/types'
import { BACKUP_DELAY_MS, DocumentSaveProvider, useDocumentSave } from './document-save-context'
import { DocumentTabsProvider, useDocumentTabs, useDocumentTabsState } from './document-tabs-context'
import { createWorkspaceCoordinatorRefs } from './workspace-coordinator'

const settingsState = vi.hoisted(() => ({ autosave: { enabled: true, delayMs: 400 } }))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: settingsState, setAutosaveEnabled: vi.fn() }),
}))

vi.mock('@/lib/notify', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/notify')>()),
    notifyError: vi.fn(() => 'toast'),
    dismissNotification: vi.fn(),
}))

vi.mock('@/lib/tauri/dialog', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/tauri/dialog')>()),
    confirmCloseAfterSaveFailure: vi.fn(async () => 'cancel' as const),
    confirmUnsavedChanges: vi.fn(async () => 'cancel' as const),
}))

vi.mock('@/lib/tauri/backups', () => ({
    saveUnsavedBackup: vi.fn(async () => undefined),
    deleteUnsavedBackup: vi.fn(async () => undefined),
    listUnsavedBackups: vi.fn(async () => []),
    settleUnsavedBackups: vi.fn(async () => undefined),
}))

function tab(id: string, overrides: Partial<DocumentTab> = {}): DocumentTab {
    return { id, path: id, name: id.split('/').pop()!, content: 'v0', isDirty: false, isSaving: false, ...overrides }
}

function createWrapper(initialTabs: DocumentTab[]) {
    return function Wrapper({ children }: { children: ReactNode }) {
        const coordinator = useMemo(() => createWorkspaceCoordinatorRefs(), [])
        const tabsState = useDocumentTabsState()
        const seeded = useRef(false)
        useLayoutEffect(() => {
            if (seeded.current) return
            seeded.current = true
            tabsState.tabsRef.current = initialTabs
            tabsState.setTabs(initialTabs)
            tabsState.setActiveTabId(initialTabs[0]?.id ?? null)
        }, [tabsState])
        return (
            <DocumentTabsProvider coordinator={coordinator} workspaceRoot="/ws" tabsState={tabsState}>
                <DocumentSaveProvider coordinator={coordinator} tabsRef={tabsState.tabsRef} setTabs={tabsState.setTabs} workspaceRoot="/ws">
                    {children}
                </DocumentSaveProvider>
            </DocumentTabsProvider>
        )
    }
}

function useHarness() {
    return { save: useDocumentSave(), tabs: useDocumentTabs() }
}

/**
 * Makes every write wait until the test finishes it, and records what reached the disk. A save writes a
 * temporary file and then renames it over the real one.
 */
function deferWrites() {
    const disk = new Map<string, string>()
    const pending: Array<() => void> = []
    vi.mocked(writeFile).mockImplementation(
        (path, data) =>
            new Promise<void>((resolve) => {
                pending.push(() => {
                    disk.set(String(path), new TextDecoder().decode(data as Uint8Array))
                    resolve()
                })
            })
    )
    vi.mocked(rename).mockImplementation(async (from, to) => {
        disk.set(String(to), disk.get(String(from))!)
        disk.delete(String(from))
    })
    const finishNext = async () => {
        await act(async () => {
            pending.shift()?.()
        })
    }
    return { disk, pending, finishNext }
}

describe('DocumentSaveProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(writeFile).mockResolvedValue(undefined)
        vi.mocked(rename).mockResolvedValue(undefined)
    })

    it('keeps a tab dirty when it was edited while its save was running, then saves the newer text', async () => {
        const writes = deferWrites()
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd')]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))

        act(() => result.current.tabs.updateTabContent('/ws/a.mmd', 'hello '))
        let firstSave!: Promise<boolean>
        act(() => {
            firstSave = result.current.save.flushSave('/ws/a.mmd')
        })
        await waitFor(() => expect(writes.pending).toHaveLength(1))

        act(() => result.current.tabs.updateTabContent('/ws/a.mmd', 'hello w'))
        await writes.finishNext()
        await expect(firstSave).resolves.toBe(true)

        expect(writes.disk.get('/ws/a.mmd')).toBe('hello ')
        expect(result.current.tabs.tabs[0]).toMatchObject({ content: 'hello w', isDirty: true })

        let secondSave!: Promise<boolean>
        act(() => {
            secondSave = result.current.save.flushSave('/ws/a.mmd')
        })
        await waitFor(() => expect(writes.pending).toHaveLength(1))
        await writes.finishNext()
        await expect(secondSave).resolves.toBe(true)

        expect(writes.disk.get('/ws/a.mmd')).toBe('hello w')
        expect(result.current.tabs.tabs[0]?.isDirty).toBe(false)
    })

    it('runs saves for one file one after another, so the newest text lands last', async () => {
        const writes = deferWrites()
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd')]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))

        act(() => result.current.tabs.updateTabContent('/ws/a.mmd', 'v1'))
        act(() => {
            void result.current.save.flushSave('/ws/a.mmd')
        })
        await waitFor(() => expect(writes.pending).toHaveLength(1))

        act(() => result.current.tabs.updateTabContent('/ws/a.mmd', 'v2'))
        let flushAll!: Promise<boolean>
        act(() => {
            void result.current.save.flushSave('/ws/a.mmd')
            flushAll = result.current.save.flushAllSaves()
        })

        // The second write must wait for the first one.
        expect(writes.pending).toHaveLength(1)
        await writes.finishNext()
        await waitFor(() => expect(writes.pending).toHaveLength(1))
        await writes.finishNext()
        await expect(flushAll).resolves.toBe(true)

        expect(vi.mocked(writeFile).mock.calls.map((call) => new TextDecoder().decode(call[1] as Uint8Array))).toEqual(['v1', 'v2'])
        expect(writes.disk.get('/ws/a.mmd')).toBe('v2')
        expect([...writes.disk.keys()]).toEqual(['/ws/a.mmd'])
        expect(result.current.tabs.tabs[0]?.isDirty).toBe(false)
    })

    it('saves a UTF-16 file as UTF-16 with its byte-order mark', async () => {
        const written = new Map<string, Uint8Array>()
        vi.mocked(writeFile).mockImplementation(async (path, data) => {
            written.set(String(path), data as Uint8Array)
        })
        vi.mocked(rename).mockImplementation(async (from, to) => {
            written.set(String(to), written.get(String(from))!)
        })
        const { result } = renderHook(useHarness, {
            wrapper: createWrapper([tab('/ws/ps.md', { content: 'A', format: { encoding: 'utf-16le', bom: true } })]),
        })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))

        act(() => result.current.tabs.updateTabContent('/ws/ps.md', 'é'))
        await act(async () => {
            await result.current.save.flushSave('/ws/ps.md')
        })

        expect(written.get('/ws/ps.md')).toEqual(new Uint8Array([0xff, 0xfe, 0xe9, 0x00]))
    })

    it('keeps the real error text when a save fails', async () => {
        vi.mocked(writeFile).mockRejectedValueOnce('The network path was not found. (os error 53)')
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd', { isDirty: true })]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))

        let ok!: boolean
        await act(async () => {
            ok = await result.current.save.flushSave('/ws/a.mmd')
        })

        expect(ok).toBe(false)
        expect(result.current.tabs.tabs[0]).toMatchObject({ isDirty: true, saveError: 'The network path was not found. (os error 53)' })
    })
})

describe('save error notices', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: true, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(writeFile).mockResolvedValue(undefined)
        vi.mocked(rename).mockResolvedValue(undefined)
    })

    async function failingTab() {
        vi.mocked(writeFile).mockRejectedValue('The network path was not found. (os error 53)')
        const rendered = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd', { isDirty: true })]) })
        await waitFor(() => expect(rendered.result.current.tabs.tabs).toHaveLength(1))
        const save = async () => {
            await act(async () => {
                await rendered.result.current.save.flushSave('/ws/a.mmd')
            })
        }
        return { ...rendered, save }
    }

    it('shows one notice with Try Again for a run of failed saves, and clears it once a save works', async () => {
        const { save } = await failingTab()

        await save()
        await save()

        expect(notifyError).toHaveBeenCalledTimes(1)
        expect(notifyError).toHaveBeenCalledWith("Couldn't save a.mmd", 'The network path was not found. (os error 53)', {
            id: 'save-error:/ws/a.mmd',
            description: 'The network path was not found. (os error 53)',
            timeout: 0,
            action: { label: 'Try Again', onClick: expect.any(Function) },
        })

        vi.mocked(writeFile).mockResolvedValue(undefined)
        await save()
        expect(dismissNotification).toHaveBeenCalledWith('save-error:/ws/a.mmd')
    })

    it('keeps the error on the tab while the user keeps typing', async () => {
        const { result, save } = await failingTab()
        await save()

        act(() => result.current.tabs.updateTabContent('/ws/a.mmd', 'more text'))

        expect(result.current.tabs.tabs[0]?.saveError).toBe('The network path was not found. (os error 53)')
    })

    it('saves again from the notice and reports a new failure', async () => {
        const { save } = await failingTab()
        await save()
        const options = vi.mocked(notifyError).mock.calls[0]![2] as NotifyOptions

        await act(async () => {
            options.action!.onClick()
        })

        await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(2))
        expect(dismissNotification).toHaveBeenCalledWith('save-error:/ws/a.mmd')
        expect(writeFile).toHaveBeenCalledTimes(2)
    })

    it('clears the notice when the tab is closed without saving', async () => {
        vi.mocked(confirmCloseAfterSaveFailure).mockResolvedValueOnce('discard')
        const { result, save } = await failingTab()
        await save()
        vi.mocked(dismissNotification).mockClear()

        await act(async () => {
            await result.current.tabs.closeTab('/ws/a.mmd')
        })

        expect(result.current.tabs.tabs).toEqual([])
        expect(dismissNotification).toHaveBeenCalledWith('save-error:/ws/a.mmd')
    })
})

describe('copies of unsaved text', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: false, delayMs: 400 }
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(writeFile).mockResolvedValue(undefined)
        vi.mocked(rename).mockResolvedValue(undefined)
    })

    async function typeAndWait(result: { current: ReturnType<typeof useHarness> }, steps: Array<[text: string, waitMs: number]>) {
        vi.useFakeTimers()
        try {
            for (const [text, waitMs] of steps) {
                act(() => result.current.tabs.updateTabContent('/ws/a.mmd', text))
                await act(async () => {
                    await vi.advanceTimersByTimeAsync(waitMs)
                })
            }
        } finally {
            vi.useRealTimers()
        }
    }

    it('keeps a copy a second after typing stops, with autosave off, and drops it once the file is saved', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd', { disk: { stamp: null } })]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))

        await typeAndWait(result, [
            ['draft 1', 500],
            ['draft 2', BACKUP_DELAY_MS],
        ])

        expect(saveUnsavedBackup).toHaveBeenCalledTimes(1)
        expect(saveUnsavedBackup).toHaveBeenCalledWith(expect.objectContaining({ path: '/ws/a.mmd', root: '/ws', content: 'draft 2', stamp: null }))
        expect(writeFile).not.toHaveBeenCalled()

        await act(async () => {
            await result.current.save.flushSave('/ws/a.mmd')
        })
        expect(deleteUnsavedBackup).toHaveBeenCalledWith('/ws/a.mmd')
    })

    it('keeps the copy while saving fails', async () => {
        vi.mocked(writeFile).mockRejectedValue('The device is not ready. (os error 21)')
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd')]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))
        await typeAndWait(result, [['draft', BACKUP_DELAY_MS]])

        await act(async () => {
            await result.current.save.flushSave('/ws/a.mmd')
        })

        expect(saveUnsavedBackup).toHaveBeenCalledTimes(1)
        expect(deleteUnsavedBackup).not.toHaveBeenCalled()
    })

    it('drops the copy when the user closes the file without saving', async () => {
        vi.mocked(confirmUnsavedChanges).mockResolvedValueOnce('discard')
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd')]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))
        await typeAndWait(result, [['draft', BACKUP_DELAY_MS]])

        await act(async () => {
            await result.current.tabs.closeTab('/ws/a.mmd')
        })

        expect(result.current.tabs.tabs).toEqual([])
        expect(deleteUnsavedBackup).toHaveBeenCalledWith('/ws/a.mmd')
        expect(writeFile).not.toHaveBeenCalled()
        // Closing waits for the removal to reach the disk, so the window can't close before it does.
        expect(vi.mocked(settleUnsavedBackups).mock.invocationCallOrder[0]).toBeGreaterThan(
            vi.mocked(deleteUnsavedBackup).mock.invocationCallOrder[0]!
        )
    })

    it('never copies text the user did not type, such as a read-only file', async () => {
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd', { readOnly: true })]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))
        await typeAndWait(result, [['draft', BACKUP_DELAY_MS]])

        expect(saveUnsavedBackup).not.toHaveBeenCalled()
    })
})

describe('turning autosave back on', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        settingsState.autosave = { enabled: false, delayMs: 50 }
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(writeFile).mockResolvedValue(undefined)
        vi.mocked(rename).mockResolvedValue(undefined)
    })

    it('saves the tabs that already have unsaved edits, but not read-only ones', async () => {
        const { result, rerender } = renderHook(useHarness, {
            wrapper: createWrapper([tab('/ws/a.mmd'), tab('/ws/b.mmd'), tab('/ws/locked.md', { readOnly: true, isDirty: true })]),
        })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(3))
        act(() => {
            result.current.tabs.updateTabContent('/ws/a.mmd', 'edit a')
            result.current.tabs.updateTabContent('/ws/b.mmd', 'edit b')
        })
        await new Promise((resolve) => setTimeout(resolve, 100))
        expect(writeFile).not.toHaveBeenCalled()

        settingsState.autosave = { enabled: true, delayMs: 50 }
        rerender()

        await waitFor(() => expect(result.current.tabs.tabs.map((t) => t.isDirty)).toEqual([false, false, true]))
        expect(writeFile).toHaveBeenCalledTimes(2)
    })
})
