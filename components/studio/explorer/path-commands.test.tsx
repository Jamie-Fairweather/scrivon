import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { matchesCommandName, searchActions } from '@/components/studio/command-palette/search-actions'
import { CommandRegistryProvider, useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
import { buildExplorerCommands } from '@/components/studio/explorer/explorer-commands'
import { buildPathCommands, usePathCommands } from '@/components/studio/explorer/path-commands'
import { exampleTabId } from '@/lib/examples/example-tab'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import { copyPath, revealInFileExplorer } from '@/lib/workspace/path-actions'

const { session, activeTab } = vi.hoisted(() => ({
    session: { workspaceRoot: null as string | null },
    activeTab: { id: null as string | null },
}))

vi.mock('@/lib/workspace/path-actions', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/workspace/path-actions')>()),
    revealInFileExplorer: vi.fn(async () => undefined),
    copyPath: vi.fn(async () => undefined),
}))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { keybinds: createDefaultKeybinds(false) } }),
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => session,
    useActiveTabId: () => activeTab.id,
}))

const ROOT = 'C:\\Work\\notes'
const PLAN = 'C:\\Work\\notes\\docs\\plan.md'

const find = (path: string | null, root: string | null, id: string) => buildPathCommands(path, root).find((command) => command.id === id)

beforeEach(() => {
    vi.clearAllMocks()
})

describe('buildPathCommands', () => {
    it('offers Reveal in File Explorer, Copy Path and Copy Relative Path for a file in the folder', () => {
        expect(buildPathCommands(PLAN, ROOT).map((c) => [c.label, c.disabled])).toEqual([
            ['Reveal in File Explorer', false],
            ['Copy Path', false],
            ['Copy Relative Path', false],
        ])
    })

    it('shows the file in Windows File Explorer, or copies its full or relative path', () => {
        void find(PLAN, ROOT, 'reveal-in-file-explorer')!.run()
        expect(revealInFileExplorer).toHaveBeenCalledWith(PLAN, ROOT)

        void find(PLAN, ROOT, 'copy-path')!.run()
        expect(copyPath).toHaveBeenCalledWith(PLAN)

        void find(PLAN, ROOT, 'copy-relative-path')!.run()
        expect(copyPath).toHaveBeenLastCalledWith('docs\\plan.md', 'relative')
    })

    it('are off, and say why, when no file from the folder is open (an example tab, or no tab)', () => {
        for (const command of buildPathCommands(null, ROOT)) {
            expect(command).toMatchObject({ disabled: true, disabledReason: 'No file from the folder is open' })
            void command.run()
        }
        expect(revealInFileExplorer).not.toHaveBeenCalled()
        expect(copyPath).not.toHaveBeenCalled()
    })

    it('say to open a folder when none is open', () => {
        for (const command of buildPathCommands(null, null)) {
            expect(command).toMatchObject({ disabled: true, disabledReason: 'No folder open' })
        }
    })

    it('only copy the full path of a file outside the open folder, like the tab menu', () => {
        const outside = 'D:\\elsewhere\\plan.md'
        expect(find(outside, ROOT, 'reveal-in-file-explorer')).toMatchObject({ disabled: true, disabledReason: 'Not in the open folder' })
        expect(find(outside, ROOT, 'copy-relative-path')).toMatchObject({ disabled: true, disabledReason: 'Not in the open folder' })
        expect(find(outside, ROOT, 'copy-path')).toMatchObject({ disabled: false })

        void find(outside, ROOT, 'copy-relative-path')!.run()
        expect(copyPath).not.toHaveBeenCalled()
    })
})

describe('finding them in the palette', () => {
    // The explorer's commands come first in the palette, so the order alone doesn't put Reveal in File Explorer on top.
    const explorer = buildExplorerCommands({
        hasWorkspace: true,
        canRevealActiveFile: true,
        collapseAllFolders: () => {},
        revealActiveFile: () => {},
        moveActiveFile: () => {},
    })
    const actions = [...explorer, ...buildPathCommands(PLAN, ROOT)].map(commandToPaletteItem)
    const top = (query: string) => searchActions(actions, query)[0]?.value

    it('finds them by the names the menus show', () => {
        expect(top('reveal in file explorer')).toBe('action:reveal-in-file-explorer')
        expect(top('copy path')).toBe('action:copy-path')
        expect(top('copy relative path')).toBe('action:copy-relative-path')
    })

    it('keeps the sidebar’s Reveal Active File apart from Windows File Explorer', () => {
        const sidebar = actions.find((action) => action.value === 'action:reveal-active-file')!
        expect(sidebar.label).toBe('Reveal Active File in Sidebar')
        expect(matchesCommandName(sidebar, 'reveal in file explorer')).toBe(false)
    })
})

describe('usePathCommands', () => {
    let shown: readonly ShownCommand[] = []

    function Probe() {
        usePathCommands()
        shown = useCommands()
        return null
    }

    function renderCommands(workspaceRoot: string | null, tabId: string | null) {
        session.workspaceRoot = workspaceRoot
        activeTab.id = tabId
        render(
            <CommandRegistryProvider>
                <Probe />
            </CommandRegistryProvider>
        )
    }

    const states = () => shown.map((command) => [command.id, command.disabled])

    it('acts on the open file', () => {
        renderCommands(ROOT, PLAN)
        expect(states()).toEqual([
            ['reveal-in-file-explorer', false],
            ['copy-path', false],
            ['copy-relative-path', false],
        ])

        act(() => void shown.find((command) => command.id === 'reveal-in-file-explorer')!.run())
        expect(revealInFileExplorer).toHaveBeenCalledWith(PLAN, ROOT)
    })

    it('is off for an example tab, which has no file on disk', () => {
        renderCommands(ROOT, exampleTabId('sample-1'))
        expect(shown.every((command) => command.disabled)).toBe(true)
    })

    it('is off with no folder open, as no tabs show then', () => {
        renderCommands(null, PLAN)
        expect(shown).toHaveLength(3)
        expect(shown.every((command) => command.disabled && command.disabledReason === 'No folder open')).toBe(true)
    })
})
