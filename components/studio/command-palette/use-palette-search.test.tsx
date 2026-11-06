import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { notifyError } from '@/lib/notify'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { isTauri } from '@/lib/tauri/platform'
import type { FileNode } from '@/lib/workspace/types'
import { searchWorkspaceContent } from '@/components/studio/command-palette/search-content'
import type { PaletteGroup } from '@/components/studio/command-palette/types'
import { usePaletteSearch } from '@/components/studio/command-palette/use-palette-search'

const state = vi.hoisted(() => ({
    session: {
        isDesktop: true,
        workspaceRoot: '/ws' as string | null,
        tree: [] as FileNode[],
        recentWorkspaces: [] as string[],
        pickAndOpenWorkspace: async () => {},
        openWorkspace: async () => {},
        closeWorkspace: async () => {},
    },
    tabs: {
        tabs: [] as Array<{ id: string; path: string; name: string; content: string; isDirty: boolean }>,
        activeTabId: null as string | null,
        openFile: async () => {},
        openExample: () => {},
        setActiveTab: async () => {},
        closeTab: async () => {},
        closeOtherTabs: async () => {},
        closeAllTabs: async () => {},
    },
    save: { autosaveEnabled: true, setAutosaveEnabled: () => {}, flushSave: async () => true, flushAllSaves: async () => true },
    layout: { layout: { explorerOpen: true, editorOpen: true }, setExplorerOpen: () => {}, setEditorOpen: () => {}, setPreviewOnly: () => {} },
    canvas: { requestCanvasFit: () => {} },
    theme: { isLight: true, setThemeId: () => {} },
    settings: { settings: null as unknown, openSettings: () => {} },
}))

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => state.session,
    useDocumentTabs: () => state.tabs,
    useDocumentSave: () => state.save,
    useStudioLayout: () => state.layout,
    useCanvasFit: () => state.canvas,
}))

vi.mock('@/components/theme/app-theme-provider', () => ({
    useAppTheme: () => state.theme,
}))

vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => state.settings,
}))

vi.mock('@/lib/notify', () => ({
    notifyError: vi.fn(),
}))

vi.mock('@/components/studio/command-palette/search-content', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/studio/command-palette/search-content')>()
    return { ...actual, searchWorkspaceContent: vi.fn(actual.searchWorkspaceContent) }
})

function file(path: string): FileNode {
    return { kind: 'file', name: path.split('/').pop()!, path }
}

function groupPaths(groups: PaletteGroup[], id: string): string[] {
    const group = groups.find((g) => g.id === id)
    return (group?.items ?? []).map((item) => (item.kind === 'action' ? item.value : item.path))
}

describe('usePaletteSearch text search', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/a.md'), file('/ws/gone.md'), file('/ws/b.md')]
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockImplementation(async (path) => {
            if (String(path) === '/ws/gone.md') throw new Error('The system cannot find the file specified. (os error 2)')
            return 'the oauth flow'
        })
    })

    it('stops the spinner and shows the other hits when one file cannot be read', async () => {
        const { result } = renderHook(() => usePaletteSearch('text', true))

        act(() => result.current.setQuery('oauth'))
        expect(result.current.isSearchingText).toBe(true)

        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        expect(groupPaths(result.current.groups, 'text').sort()).toEqual(['/ws/a.md', '/ws/b.md'])
        expect(result.current.textUnreadableFiles).toBe(1)
    })

    it('stops the spinner and tells the user when the search itself fails', async () => {
        vi.mocked(searchWorkspaceContent).mockRejectedValueOnce(new Error('boom'))
        const { result } = renderHook(() => usePaletteSearch('text', true))

        act(() => result.current.setQuery('oauth'))

        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        expect(result.current.groups.find((group) => group.id === 'text')).toBeUndefined()
        expect(notifyError).toHaveBeenCalledWith("Couldn't search file contents", expect.any(Error), { id: 'palette-text-search' })
    })
})
