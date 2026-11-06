import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalKeybindsProvider } from '@/components/studio/settings/global-keybinds-provider'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'

const mocks = vi.hoisted(() => ({
    setExplorerOpen: vi.fn(),
    setEditorOpen: vi.fn(),
    setPreviewOnly: vi.fn(),
    openMode: vi.fn(),
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ isDesktop: true, workspaceRoot: 'C:/work' }),
    useDocumentTabs: () => ({ activeTabId: 'C:/work/a.mmd' }),
    useDocumentSave: () => ({ flushSave: vi.fn(), flushAllSaves: vi.fn() }),
    useStudioLayout: () => ({
        layout: { explorerOpen: true, editorOpen: true },
        setExplorerOpen: mocks.setExplorerOpen,
        setEditorOpen: mocks.setEditorOpen,
        setPreviewOnly: mocks.setPreviewOnly,
    }),
    useCanvasFit: () => ({ requestCanvasFit: vi.fn() }),
}))

vi.mock('@/components/studio/command-palette/command-palette-provider', () => ({
    useCommandPalette: () => ({ openMode: mocks.openMode }),
}))

function Providers({ children }: { children: ReactNode }) {
    return (
        <SettingsProvider>
            <GlobalKeybindsProvider>{children}</GlobalKeybindsProvider>
        </SettingsProvider>
    )
}

function press(key: string, init: KeyboardEventInit = {}) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

describe('GlobalKeybindsProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        const store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => {
                store.set(key, String(value))
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('runs shortcuts while settings is closed', () => {
        renderHook(() => useAppSettings(), { wrapper: Providers })

        press('b', { ctrlKey: true })

        expect(mocks.setExplorerOpen).toHaveBeenCalledWith(false)
    })

    it('turns shortcuts off while settings is open, so recording a shortcut does not also run it', () => {
        const { result } = renderHook(() => useAppSettings(), { wrapper: Providers })
        act(() => {
            result.current.openSettings('keyboard')
        })

        press('o', { ctrlKey: true, shiftKey: true })
        press('F1')
        press(',', { ctrlKey: true })

        expect(mocks.setPreviewOnly).not.toHaveBeenCalled()
        expect(mocks.openMode).not.toHaveBeenCalled()
        expect(result.current.activeSection).toBe('keyboard')

        act(() => {
            result.current.closeSettings()
        })
        press('o', { ctrlKey: true, shiftKey: true })

        expect(mocks.setPreviewOnly).toHaveBeenCalledTimes(1)
    })
})
