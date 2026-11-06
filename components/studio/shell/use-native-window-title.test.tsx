import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useDocumentTabs, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isTauri } from '@/lib/tauri/platform'
import { useNativeWindowTitle, windowTitleFor } from './use-native-window-title'

const setTitle = vi.fn<(title: string) => Promise<void>>()

vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: vi.fn(),
    useWorkspaceSession: vi.fn(),
}))

function mockState(activeTab: { name: string; isDirty: boolean } | null, workspaceRoot: string | null) {
    vi.mocked(useDocumentTabs).mockReturnValue({ activeTab } as unknown as ReturnType<typeof useDocumentTabs>)
    vi.mocked(useWorkspaceSession).mockReturnValue({ workspaceRoot } as unknown as ReturnType<typeof useWorkspaceSession>)
}

beforeEach(() => {
    vi.clearAllMocks()
    setTitle.mockResolvedValue(undefined)
    vi.mocked(getCurrentWindow).mockReturnValue({ setTitle } as unknown as ReturnType<typeof getCurrentWindow>)
    vi.mocked(isTauri).mockReturnValue(true)
})

describe('windowTitleFor', () => {
    it('names the file, folder and app, and marks unsaved changes', () => {
        expect(windowTitleFor({ name: 'notes.md', isDirty: false }, 'C:\\Users\\me\\docs')).toBe('notes.md — docs — Scrivon')
        expect(windowTitleFor({ name: 'flow.mmd', isDirty: true }, '/home/me/work/')).toBe('● flow.mmd — work — Scrivon')
        expect(windowTitleFor(null, 'C:\\Users\\me\\docs')).toBe('docs — Scrivon')
        expect(windowTitleFor(null, null)).toBe('Scrivon')
    })
})

describe('useNativeWindowTitle', () => {
    it('updates the native title when the active file or its saved state changes', async () => {
        mockState({ name: 'notes.md', isDirty: false }, 'C:\\docs')
        const { rerender } = renderHook(() => useNativeWindowTitle())
        await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('notes.md — docs — Scrivon'))

        mockState({ name: 'notes.md', isDirty: true }, 'C:\\docs')
        rerender()
        await waitFor(() => expect(setTitle).toHaveBeenLastCalledWith('● notes.md — docs — Scrivon'))
        expect(setTitle).toHaveBeenCalledTimes(2)

        // Same title again (e.g. typing in an already-unsaved file): no extra call.
        rerender()
        expect(setTitle).toHaveBeenCalledTimes(2)
    })

    it('does nothing outside the desktop app and survives a refused title change', async () => {
        vi.mocked(isTauri).mockReturnValue(false)
        mockState(null, null)
        renderHook(() => useNativeWindowTitle())
        expect(setTitle).not.toHaveBeenCalled()

        vi.mocked(isTauri).mockReturnValue(true)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        setTitle.mockRejectedValue(new Error('not allowed'))
        renderHook(() => useNativeWindowTitle())
        await waitFor(() => expect(warn).toHaveBeenCalledWith('Could not set the window title:', expect.any(Error)))
        warn.mockRestore()
    })
})
