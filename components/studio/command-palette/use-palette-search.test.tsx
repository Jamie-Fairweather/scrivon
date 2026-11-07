import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { notifyError } from '@/lib/notify'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { getWorkspaceFileSize } from '@/lib/tauri/fs'
import type { AppThemeId } from '@/lib/theme/catalog'
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
    theme: { themeId: 'scrivon-light' as AppThemeId, isLight: true, setThemeId: vi.fn() as (id: AppThemeId) => void },
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

    it("keeps the last query's text hits in place, but not openable, until the new query's search finishes", async () => {
        const { result } = renderHook(() => usePaletteSearch('text', true))
        const textItems = () => result.current.groups.find((group) => group.id === 'text')?.items ?? []
        const disabled = () => textItems().map((item) => item.kind === 'text' && Boolean(item.disabled))

        act(() => result.current.setQuery('oauth'))
        await waitFor(() => expect(textItems()).toHaveLength(2))
        expect(disabled()).toEqual([false, false])
        expect(result.current.textUnreadableFiles).toBe(1)

        act(() => result.current.setQuery('oauth flow'))
        expect(result.current.isSearchingText).toBe(true)
        // Still listed so the list doesn't jump, but Enter can't open a hit for the old query.
        expect(disabled()).toEqual([true, true])
        expect(result.current.textUnreadableFiles).toBe(0)

        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        expect(disabled()).toEqual([false, false])
    })

    it('drops the text hits once the query is too short to search file contents', async () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('oauth'))
        await waitFor(() => expect(groupPaths(result.current.groups, 'text')).toHaveLength(2))

        act(() => result.current.setQuery('o'))
        expect(groupPaths(result.current.groups, 'text')).toEqual([])
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

describe('usePaletteSearch one-character queries', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/a.md')]
        state.tabs.tabs = []
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockImplementation(async () => '図表の説明')
    })

    it('searches file contents for a single Japanese character', async () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('図'))
        await waitFor(() => expect(groupPaths(result.current.groups, 'text')).toEqual(['/ws/a.md']))
    })

    it('searches file contents for a single character in Find in Workspace', async () => {
        vi.mocked(readTextFile).mockImplementation(async () => 'x marks the spot')
        const { result } = renderHook(() => usePaletteSearch('text', true))

        act(() => result.current.setQuery('x'))
        await waitFor(() => expect(groupPaths(result.current.groups, 'text')).toEqual(['/ws/a.md']))
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

describe('usePaletteSearch duplicate files', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/open.md'), file('/ws/recent.md'), file('/ws/other.md')]
        state.tabs.tabs = [{ id: '/ws/open.md', path: '/ws/open.md', name: 'open.md', content: '', isDirty: false }]
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('does not list open or recent files again under Files', async () => {
        vi.mocked(getRecentFiles).mockResolvedValueOnce(['/ws/recent.md'])
        const { result } = renderHook(() => usePaletteSearch('all', true))

        await waitFor(() => expect(groupPaths(result.current.groups, 'recent')).toEqual(['/ws/recent.md']))
        expect(groupPaths(result.current.groups, 'tabs')).toEqual(['/ws/open.md'])
        expect(groupPaths(result.current.groups, 'files')).toEqual(['/ws/other.md'])
    })

    it('does not repeat a matching open file under Files while typing', () => {
        const { result } = renderHook(() => usePaletteSearch('files', true))

        act(() => result.current.setQuery('open'))
        expect(groupPaths(result.current.groups, 'tabs')).toEqual(['/ws/open.md'])
        expect(groupPaths(result.current.groups, 'files')).toEqual([])
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

    it('lists recent folders first, then runnable commands, when nothing is typed and no folder is open', () => {
        state.session.workspaceRoot = null
        state.session.recentWorkspaces = ['/projects/alpha']
        const { result } = renderHook(() => usePaletteSearch('all', true))

        expect(groupIds(result.current.groups)).toEqual(['workspaces', 'actions'])
        const commands = groupPaths(result.current.groups, 'actions')
        expect(commands).toContain('action:open-folder')
        // Close Folder needs a folder, and the recent folder already has its own group.
        expect(commands).not.toContain('action:close-folder')
        expect(commands.some((value) => value.startsWith('action:recent-workspace:'))).toBe(false)
        expect(commands.length).toBeLessThanOrEqual(5)
    })

    it('lists commands first on a fresh start with no recent folders', () => {
        state.session.workspaceRoot = null
        const { result } = renderHook(() => usePaletteSearch('all', true))

        expect(groupIds(result.current.groups)).toEqual(['actions'])
        expect(groupPaths(result.current.groups, 'actions')).toContain('action:open-folder')
    })

    it.each(['scr', 'scrivon', 'code', 'notes', 'work'])(
        'puts the recent folder typed (%s) first when no folder is open, so Enter opens it',
        (query) => {
            state.session.workspaceRoot = null
            state.session.recentWorkspaces = ['C:\\code\\scrivon', 'C:\\work\\notes']
            const { result } = renderHook(() => usePaletteSearch('all', true))

            act(() => result.current.setQuery(query))
            expect(groupIds(result.current.groups)[0]).toBe('workspaces')
            expect(result.current.groups[0]?.items[0]?.kind).toBe('workspace')
        }
    )

    it('never suggests a command that cannot run, or an example, next to the results', () => {
        state.session.workspaceRoot = null
        state.session.recentWorkspaces = ['/p/alpha']
        const { result } = renderHook(() => usePaletteSearch('all', true))

        for (const query of ['alpha', 'docs', 'example', 'fit diagram']) {
            act(() => result.current.setQuery(query))
            const commands = result.current.groups.find((group) => group.id === 'actions')?.items ?? []
            expect(commands.filter((item) => item.kind === 'action' && (item.disabled || item.value.startsWith('action:example:')))).toEqual([])
        }
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

    it('lists commands after open editors and before the other files when nothing is typed in a folder', () => {
        state.tabs.tabs = [{ id: '/ws/notes.md', path: '/ws/notes.md', name: 'notes.md', content: '', isDirty: false }]
        state.tabs.activeTabId = '/ws/notes.md'
        const { result } = renderHook(() => usePaletteSearch('all', true))

        expect(groupIds(result.current.groups)).toEqual(['tabs', 'actions', 'files'])
    })

    it('lists commands first when nothing is typed and no file has been opened yet', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        expect(groupIds(result.current.groups)).toEqual(['actions', 'files'])
    })

    it('keeps commands out of Go to File and Find in Workspace', () => {
        const { result } = renderHook(() => usePaletteSearch('files', true))

        act(() => result.current.setQuery('settings'))
        expect(groupIds(result.current.groups)).toEqual(['files'])
    })
})

describe('usePaletteSearch commands next to text hits', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = [file('/ws/plan.md'), file('/ws/theme.md')]
        state.session.recentWorkspaces = []
        state.tabs.tabs = []
        state.tabs.activeTabId = null
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(readTextFile).mockImplementation(async () => '- todo: pick a theme')
    })

    it('opens a text hit, not a command, when a word found in files is typed', async () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('todo'))
        expect(groupPaths(result.current.groups, 'actions')).toEqual([])

        await waitFor(() => expect(groupPaths(result.current.groups, 'text')).toEqual(['/ws/plan.md', '/ws/theme.md']))
        expect(result.current.groups[0]?.items[0]?.kind).toBe('text')
        expect(groupPaths(result.current.groups, 'actions')).toEqual([])
    })

    it('lists matching commands after file names and text hits', async () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('theme'))
        await waitFor(() => expect(result.current.isSearchingText).toBe(false))
        expect(result.current.groups.map((group) => group.id)).toEqual(['files', 'text', 'actions'])
        expect(groupPaths(result.current.groups, 'actions')).toContain('action:toggle-theme')
    })
})

describe('usePaletteSearch recent folders', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = null
        state.tabs.tabs = []
        vi.mocked(isTauri).mockReturnValue(false)
    })

    it('finds a folder whose name was stored the macOS way, typed on a Windows keyboard', () => {
        const korean = 'C:\\work\\한글'.normalize('NFD')
        state.session.recentWorkspaces = ['C:\\work\\notes', korean]
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('한글'))
        expect(groupPaths(result.current.groups, 'workspaces')).toEqual([korean])
    })

    it('finds a folder with a Turkish İ in its name', () => {
        state.session.recentWorkspaces = ['C:\\work\\notes', 'C:\\work\\İstanbul']
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('istanbul'))
        expect(groupPaths(result.current.groups, 'workspaces')).toEqual(['C:\\work\\İstanbul'])
    })
})

describe('usePaletteSearch theme toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        state.settings.settings = createDefaultSettings(false)
        state.session.workspaceRoot = '/ws'
        state.session.tree = []
        state.tabs.tabs = []
        vi.mocked(isTauri).mockReturnValue(false)
    })

    function runToggle(result: { current: ReturnType<typeof usePaletteSearch> }) {
        act(() => result.current.setQuery('>switch to'))
        const toggle = result.current.groups[0]?.items.find((item) => item.value === 'action:toggle-theme')
        if (toggle?.kind !== 'action') throw new Error('toggle command missing')
        act(() => void toggle.run())
    }

    it('switches back to the theme the user had, not to Scrivon', () => {
        state.theme.themeId = 'tokyo-night-storm'
        state.theme.isLight = false
        const { result, rerender } = renderHook(() => usePaletteSearch('all', true))

        runToggle(result)
        expect(state.theme.setThemeId).toHaveBeenLastCalledWith('tokyo-night-light')

        state.theme.themeId = 'tokyo-night-light'
        state.theme.isLight = true
        rerender()
        runToggle(result)
        expect(state.theme.setThemeId).toHaveBeenLastCalledWith('tokyo-night-storm')
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

    it('does not offer a weaker command that would run on Enter when the one typed cannot run', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('close tab'))
        expect(groupPaths(result.current.groups, 'actions')).toEqual([])
    })

    it('keeps a matching command that cannot run on top of the > list, with its reason', () => {
        const { result } = renderHook(() => usePaletteSearch('all', true))

        act(() => result.current.setQuery('>close tab'))
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
