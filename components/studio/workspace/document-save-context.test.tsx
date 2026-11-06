import { act, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rename, writeFile } from '@tauri-apps/plugin-fs'
import { dismissNotification, notifyError, type NotifyOptions } from '@/lib/notify'
import { confirmCloseAfterSaveFailure } from '@/lib/tauri/dialog'
import { isTauri } from '@/lib/tauri/platform'
import type { DocumentTab } from '@/lib/workspace/types'
import { DocumentSaveProvider, useDocumentSave } from './document-save-context'
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
                <DocumentSaveProvider coordinator={coordinator} tabsRef={tabsState.tabsRef} setTabs={tabsState.setTabs}>
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
        vi.mocked(writeFile).mockRejectedValueOnce('Access is denied. (os error 5)')
        const { result } = renderHook(useHarness, { wrapper: createWrapper([tab('/ws/a.mmd', { isDirty: true })]) })
        await waitFor(() => expect(result.current.tabs.tabs).toHaveLength(1))

        let ok!: boolean
        await act(async () => {
            ok = await result.current.save.flushSave('/ws/a.mmd')
        })

        expect(ok).toBe(false)
        expect(result.current.tabs.tabs[0]).toMatchObject({ isDirty: true, saveError: 'Access is denied. (os error 5)' })
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
        vi.mocked(writeFile).mockRejectedValue('Access is denied. (os error 5)')
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
        expect(notifyError).toHaveBeenCalledWith("Couldn't save a.mmd", 'Access is denied. (os error 5)', {
            id: 'save-error:/ws/a.mmd',
            description: 'Access is denied. (os error 5)',
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

        expect(result.current.tabs.tabs[0]?.saveError).toBe('Access is denied. (os error 5)')
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
