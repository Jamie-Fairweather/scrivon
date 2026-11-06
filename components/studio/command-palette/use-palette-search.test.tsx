import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { notifyError } from '@/lib/notify'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { getWorkspaceFileSize } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { getRecentFiles } from '@/lib/tauri/store'
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

vi.mock('@/lib/tauri/fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/tauri/fs')>()
    return { ...actual, getWorkspaceFileSize: vi.fn(async () => null) }
})

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

describe('usePaletteSearch file cache', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/a.md'), file('/ws/b.md')]
        state.tabs.tabs = []
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockImplementation(async () => 'the oauth flow')
        vi.mocked(getWorkspaceFileSize).mockImplementation(async () => 14)
    })

    it('does not read unchanged files again while the user keeps typing', async () => {
        const { result } = renderHook(() => usePaletteSearch('text', true))

        act(() => result.current.setQuery('oauth'))
        await waitFor(() => expect(groupPaths(result.current.groups, 'text')).toEqual(['/ws/a.md', '/ws/b.md']))
        expect(readTextFile).toHaveBeenCalledTimes(2)

        act(() => result.current.setQuery('oauth flow'))
        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        expect(groupPaths(result.current.groups, 'text')).toEqual(['/ws/a.md', '/ws/b.md'])
        expect(readTextFile).toHaveBeenCalledTimes(2)
    })

    it('reads files fresh after the palette is closed and opened again', async () => {
        const { result } = renderHook(() => usePaletteSearch('text', true))

        act(() => result.current.setQuery('oauth'))
        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        act(() => result.current.resetSearch())

        act(() => result.current.setQuery('oauth'))
        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        expect(readTextFile).toHaveBeenCalledTimes(4)
    })
})

describe('usePaletteSearch while closed', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/a.md'), file('/ws/b.md')]
        state.tabs.tabs = [{ id: '/ws/a.md', path: '/ws/a.md', name: 'a.md', content: 'a', isDirty: false }]
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('builds no results while the palette is closed, even as the editor changes', () => {
        const { result, rerender } = renderHook(() => usePaletteSearch('all', false))
        const closedGroups = result.current.groups
        expect(closedGroups).toEqual([])

        // Typing in the editor gives a new tabs array on every keystroke.
        state.tabs.tabs = [{ ...state.tabs.tabs[0]!, content: 'ab', isDirty: true }]
        rerender()
        expect(result.current.groups).toBe(closedGroups)
    })

    it('builds results once the palette opens', () => {
        let enabled = false
        const { result, rerender } = renderHook(() => usePaletteSearch('all', enabled))
        enabled = true
        rerender()
        expect(groupPaths(result.current.groups, 'tabs')).toEqual(['/ws/a.md'])
    })
})

describe('usePaletteSearch recent files', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/kept.md'), file('/ws/new-name.md')]
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('leaves out recent files that were deleted or renamed', async () => {
        vi.mocked(getRecentFiles).mockResolvedValueOnce(['/ws/deleted.md', '/ws/kept.md', '/ws/old-name.md'])
        const { result } = renderHook(() => usePaletteSearch('all', true))

        await waitFor(() => expect(groupPaths(result.current.groups, 'recent')).toEqual(['/ws/kept.md']))
    })

    it('shows no recent files when the store cannot be read', async () => {
        vi.mocked(getRecentFiles).mockRejectedValueOnce(new Error('store unavailable'))
        const { result } = renderHook(() => usePaletteSearch('all', true))

        await waitFor(() => expect(getRecentFiles).toHaveBeenCalled())
        await waitFor(() => expect(groupPaths(result.current.groups, 'files')).toEqual(['/ws/kept.md', '/ws/new-name.md']))
        expect(groupPaths(result.current.groups, 'recent')).toEqual([])
    })
})

describe('usePaletteSearch commands in the default results', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/notes.md'), file('/ws/settings-notes.md')]
        state.session.recentWorkspaces = []
        state.tabs.tabs = []
        state.tabs.activeTabId = null
        vi.mocked(isTauri).mockReturnValue(false)
    })

    function groupIds(groups: PaletteGroup[]): string[] {
        return groups.map((group) => group.id)
    }

    it('lists runnable commands first when nothing is typed and no folder is open', () => {
        state.session.workspaceRoot = null
        state.session.recentWorkspaces = ['/projects/alpha']
        const { result } = renderHook(() => usePaletteSearch('all', true))

        expect(groupIds(result.current.groups)).toEqual(['actions', 'workspaces'])
        const commands = groupPaths(result.current.groups, 'actions')
        expect(commands).toContain('action:open-folder')
        // Close Folder needs a folder, and the recent folder already has its own group.
        expect(commands).not.toContain('action:close-folder')
        expect(commands.some((value) => value.startsWith('action:recent-workspace:'))).toBe(false)
        expect(commands.length).toBeLessThanOrEqual(5)
    })

    it('finds a command by name without the > prefix', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('theme'))
        expect(groupPaths(result.current.groups, 'actions')).toContain('action:toggle-theme')
    })

    it('lists commands after matching files while typing', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('settings'))
        expect(groupIds(result.current.groups)).toEqual(['files', 'actions'])
        expect(groupPaths(result.current.groups, 'actions')).toContain('action:open-settings')
    })

    it('lists commands first when nothing is typed in a folder', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        expect(groupIds(result.current.groups)[0]).toBe('actions')
    })

    it('keeps commands out of Go to File and Find in Workspace', () => {
        const { result } = renderHook(() => usePaletteSearch('files', true))

        act(() => result.current.setQuery('settings'))
        expect(groupIds(result.current.groups)).toEqual(['files'])
    })
})

describe('usePaletteSearch unavailable commands', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/notes.md')]
        state.session.recentWorkspaces = []
        state.tabs.tabs = []
        state.tabs.activeTabId = null
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('keeps a matching command that cannot run on top, instead of a weaker match that would run on Enter', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('close tab'))
        const first = result.current.groups[0]?.items[0]
        expect(first?.kind === 'action' && first.value).toBe('action:close-tab')
        expect(first?.kind === 'action' && first.disabled).toBe(true)
    })

    it('lists unavailable commands last in the > list', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('>'))
        const items = result.current.groups.find((group) => group.id === 'actions')?.items ?? []
        const disabled = items.map((item) => item.kind === 'action' && Boolean(item.disabled))
        expect(disabled.indexOf(true)).toBeGreaterThan(0)
        expect(disabled.slice(disabled.indexOf(true)).every(Boolean)).toBe(true)
    })
})
