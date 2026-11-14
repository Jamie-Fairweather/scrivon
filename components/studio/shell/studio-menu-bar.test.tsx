import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useMemo, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { CommandRegistryProvider, useCommands, useRegisterCommands } from '@/components/studio/commands/command-registry'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { useEditorCommands } from '@/components/studio/editor/editor-commands'
import { exportAvailability, type ExportState } from '@/components/studio/editor/export-availability'
import { buildExportCommands } from '@/components/studio/editor/export-commands'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { StudioCommands } from '@/components/studio/shell/studio-commands'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import {
    useActiveTabId,
    useCanvasFit,
    useDocumentSave,
    useDocumentTabs,
    useStudioLayout,
    useWorkspaceCoordinator,
    useWorkspaceSession,
} from '@/components/studio/workspace/workspace-provider'
import { formatMarkdown } from '@/lib/monaco/markdown-editing'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { KeybindBindings } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'
import { StudioMenuBar } from './studio-menu-bar'

vi.mock('next/image', () => ({
    default: (props: { alt: string }) => <span data-alt={props.alt} />,
}))
const promptName = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useActiveTabId: vi.fn(),
    useCanvasFit: vi.fn(),
    useDocumentSave: vi.fn(),
    useDocumentTabs: vi.fn(),
    useStudioLayout: vi.fn(),
    useWorkspaceCoordinator: vi.fn(),
    useWorkspaceSession: vi.fn(),
}))
vi.mock('@/components/studio/dialogs/move-to-provider', () => ({ useMoveTo: () => ({ chooseFolder: vi.fn() }) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: vi.fn() }))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({ useCanvasControls: vi.fn() }))
vi.mock('@/components/studio/theme/theme-menu', () => ({ ThemeMenu: () => null }))
vi.mock('@/lib/monaco/markdown-editing', () => ({ formatMarkdown: vi.fn() }))
vi.mock('@/components/studio/dialogs/open-source-licenses-dialog', () => ({ OpenSourceLicensesDialog: () => null }))
vi.mock('@/components/studio/shell/menu-bar-update-button', () => ({ MenuBarUpdateButton: () => <button type="button">Update</button> }))
const { checkForUpdates } = vi.hoisted(() => ({ checkForUpdates: vi.fn(async () => {}) }))
vi.mock('@/components/studio/app-update-provider', () => ({ useAppUpdate: () => ({ checking: false, checkForUpdates }) }))
vi.mock('@/components/studio/shell/window-titlebar-controls', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/studio/shell/window-titlebar-controls')>()),
    WindowTitlebarControls: () => null,
}))

type EditorState = 'none' | 'hidden' | 'ready'

const fakeEditor = { focus: vi.fn(), trigger: vi.fn(), getModel: () => ({}), hasTextFocus: () => false }

function mockContexts({
    isDesktop = false,
    workspaceRoot = null as string | null,
    openingWorkspace = null as string | null,
    recentWorkspaces = [] as string[],
    keybinds = createDefaultKeybinds(false) as KeybindBindings,
    canFitToView = true,
    activeTabId = null as string | null,
    dirty = false,
    outlineOpen = false,
    activeTab = null as { name: string; isDirty: boolean } | null,
    zoom = 1,
} = {}) {
    vi.mocked(useCanvasControls).mockReturnValue({ canFitToView, zoomDiagram: vi.fn() } as unknown as ReturnType<typeof useCanvasControls>)
    vi.mocked(useWorkspaceSession).mockReturnValue({
        isDesktop,
        workspaceRoot,
        openingWorkspace,
        recentWorkspaces,
        pickAndOpenWorkspace: vi.fn(),
        openWorkspace: vi.fn(),
        closeWorkspace: vi.fn(),
        refreshTree: vi.fn(async () => {}),
        tree: [
            { kind: 'directory', name: 'docs', path: 'C:\\work\\docs', children: [{ kind: 'file', name: 'a.md', path: 'C:\\work\\docs\\a.md' }] },
            { kind: 'directory', name: 'drafts', path: 'C:\\work\\drafts', children: [] },
        ],
        suggestName: (_folder: string, name: string) => name,
        getNameError: () => null,
        createFile: vi.fn(async () => {}),
        createFolder: vi.fn(async () => {}),
        folderToggles: new Map(),
        setFoldersExpanded: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceSession>)
    vi.mocked(useActiveTabId).mockReturnValue(activeTabId)
    vi.mocked(useWorkspaceCoordinator).mockReturnValue({ reloadChangedTabs: { current: vi.fn(async () => {}) } } as unknown as ReturnType<
        typeof useWorkspaceCoordinator
    >)
    vi.mocked(useActiveTabId).mockReturnValue(activeTabId)
    vi.mocked(useDocumentTabs).mockReturnValue({
        tabs: activeTabId ? [{ id: activeTabId, path: activeTabId, name: 'a.md', content: '', isDirty: dirty }] : [],
        activeTabId,
        activeTab,
        openExample: vi.fn(),
        closeTab: vi.fn(async () => {}),
        closeOtherTabs: vi.fn(async () => {}),
        closeAllTabs: vi.fn(async () => {}),
        canReopenClosedTab: true,
        reopenClosedTab: vi.fn(async () => {}),
        revertTab: vi.fn(async () => {}),
    } as unknown as ReturnType<typeof useDocumentTabs>)
    vi.mocked(useStudioLayout).mockReturnValue({
        layout: { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen },
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setPreviewOpen: vi.fn(),
        setOutlineOpen: vi.fn(),
        setPreviewOnly: vi.fn(),
    } as unknown as ReturnType<typeof useStudioLayout>)
    vi.mocked(useDocumentSave).mockReturnValue({
        autosaveEnabled: true,
        setAutosaveEnabled: vi.fn(),
        flushSave: vi.fn(async () => true),
        flushAllSaves: vi.fn(async () => true),
    } as unknown as ReturnType<typeof useDocumentSave>)
    vi.mocked(useAppSettings).mockReturnValue({
        settings: { keybinds, appearance: { zoom, previewFontSize: 14 } },
        updateSettings: vi.fn(),
        openSettings: vi.fn(),
        flushPendingSettings: vi.fn(),
    } as unknown as ReturnType<typeof useAppSettings>)
    vi.mocked(useAppTheme).mockReturnValue({ themeId: 'scrivon-dark', isLight: false, setThemeId: vi.fn() } as unknown as ReturnType<
        typeof useAppTheme
    >)
    vi.mocked(useCanvasFit).mockReturnValue({ requestCanvasFit: vi.fn() } as unknown as ReturnType<typeof useCanvasFit>)
}

/** Stands in for the editor panel, which registers the Edit menu's commands. */
function EditorCommands({ state }: { state: EditorState }) {
    useEditorCommands(state === 'none' ? null : (fakeEditor as never), { shown: state === 'ready', readOnly: false, markdown: true })
    return null
}

/** The palette's rows, from the same list: label, shortcut and whether it can run. */
let paletteRows: Array<{ label: string; shortcut?: string; disabled?: boolean }> = []
function PaletteRows() {
    const commands = useCommands()
    useEffect(() => {
        paletteRows = commands.map(commandToPaletteItem)
    }, [commands])
    return null
}

/** The menu bar as the studio has it: the commands registered by the features, read by the menu bar. */
function Studio({ children, editor = 'none' }: { children?: ReactNode; editor?: EditorState }) {
    return (
        <CommandRegistryProvider>
            <StudioCommands />
            <HelpCommands />
            <EditorCommands state={editor} />
            <PaletteRows />
            <StudioMenuBar />
            {children}
        </CommandRegistryProvider>
    )
}

async function openMenu(name: string) {
    await userEvent.setup().click(screen.getByRole('menuitem', { name }))
    return screen.findByRole('menu')
}

/** Plain items and tick boxes, in menu order. */
const menuItems = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'))
const menuLabels = (menu: HTMLElement) => menuItems(menu).map((item) => item.textContent)

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    mockContexts()
    paletteRows = []
})

describe('StudioMenuBar', () => {
    it('is a real menubar with arrow-key movement between menus', async () => {
        render(<Studio />)

        const menubar = screen.getByRole('menubar')
        const file = within(menubar).getByRole('menuitem', { name: 'File' })
        expect(
            within(menubar)
                .getAllByRole('menuitem')
                .map((el) => el.textContent)
        ).toEqual(['File', 'Options', 'Help'])

        file.focus()
        const user = userEvent.setup()
        await user.keyboard('{ArrowRight}')

        expect(within(menubar).getByRole('menuitem', { name: 'Options' })).toHaveFocus()
    })

    it('adds Edit and View once a folder is open', () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        expect(
            within(screen.getByRole('menubar'))
                .getAllByRole('menuitem')
                .map((el) => el.textContent)
        ).toEqual(['File', 'Edit', 'View', 'Options', 'Help'])
    })

    it('keeps the update button out of the menubar focus loop', () => {
        mockContexts({ isDesktop: true })
        render(<Studio />)

        expect(within(screen.getByRole('menubar')).queryByRole('button', { name: 'Update' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
    })

    it('shows the open file and folder in the drag area, marking unsaved changes, without getting in the way of dragging', () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:\\Users\\me\\docs', activeTab: { name: 'notes.md', isDirty: true } })
        render(<StudioMenuBar />)

        const title = screen.getByText('● notes.md — docs')
        // Clicks on the text reach the drag area, so it still drags, maximises and opens the window menu.
        expect(title.parentElement).toHaveAttribute('data-tauri-drag-region')
        expect(title).toHaveClass('pointer-events-none')
    })

    it('shows the open file in the title bar in the browser too, and nothing with no folder open', () => {
        mockContexts({ workspaceRoot: '/home/me/work', activeTab: { name: 'flow.mmd', isDirty: false } })
        const { rerender } = render(<StudioMenuBar />)
        expect(screen.getByText('flow.mmd — work')).toBeInTheDocument()

        mockContexts()
        rerender(<StudioMenuBar />)
        expect(screen.queryByText(/flow\.mmd/)).not.toBeInTheDocument()
    })

    it('focuses File when F10 is pressed', () => {
        render(<Studio />)

        fireEvent.keyDown(document.body, { key: 'F10' })

        expect(screen.getByRole('menuitem', { name: 'File' })).toHaveFocus()
    })

    it('lists the bug report helpers, About and Licences directly in the Help menu', async () => {
        render(<Studio />)

        const menu = await openMenu('Help')
        // The browser build has no updates to check for.
        expect(menuLabels(menu)).toEqual(['Report an Issue', 'Copy Diagnostic Info', 'Open Logs Folder', 'About Scrivon…', 'Licences…'])
        // Just the one between the two groups, with no stray one on top.
        expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1)
    })

    it('checks for updates from the Help menu of the desktop app', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        render(<Studio />)

        const menu = await openMenu('Help')
        expect(menuLabels(menu)).toEqual([
            'Check for Updates…',
            'Report an Issue',
            'Copy Diagnostic Info',
            'Open Logs Folder',
            'About Scrivon…',
            'Licences…',
        ])
        await userEvent.setup().click(within(menu).getByRole('menuitem', { name: 'Check for Updates…' }))

        expect(checkForUpdates).toHaveBeenCalledTimes(1)
    })

    it("shows each item's keyboard shortcut", async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)
        const user = userEvent.setup()

        const view = await openMenu('View')
        expect(within(view).getByRole('menuitemcheckbox', { name: 'Explorer Ctrl+Shift+B' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitemcheckbox', { name: 'Editor Ctrl+E' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitem', { name: 'Preview Only Ctrl+Shift+O' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitem', { name: 'Fit Diagram to Screen Ctrl+R' })).toBeInTheDocument()

        await user.keyboard('{Escape}')
        await user.click(screen.getByRole('menuitem', { name: 'Options' }))
        expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Settings… Ctrl+,' })).toBeInTheDocument()
    })

    it('marks the open folder in Open Recent and turns off the one still being opened', async () => {
        mockContexts({
            isDesktop: true,
            workspaceRoot: 'C:\\work\\diagrams',
            openingWorkspace: 'C:\\work\\big',
            recentWorkspaces: ['c:\\work\\diagrams', 'C:\\work\\big', 'C:\\work\\notes'],
        })
        render(<Studio />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'File' }))
        await user.click(await screen.findByRole('menuitem', { name: 'Open Recent' }))
        const item = async (name: string) => screen.findByRole('menuitem', { name })

        // Ticked and named as the current folder, without aria-current: Contrast themes would fill that row
        // like the keyboard's, so two rows would look picked.
        const current = await item('diagrams (current folder)')
        expect(current.querySelector('svg')).not.toBeNull()
        expect(current).not.toHaveAttribute('aria-current')
        expect(await item('notes')).not.toHaveAttribute('aria-current')
        expect(await item('big')).toHaveAttribute('aria-disabled', 'true')
        expect(await item('big')).toHaveAttribute('aria-busy', 'true')
        expect(await item('notes')).not.toHaveAttribute('aria-disabled', 'true')
    })

    it('keeps Hebrew folder names in order in an Open Recent tooltip', async () => {
        const LRM = '\u200E'
        mockContexts({ isDesktop: true, workspaceRoot: null, openingWorkspace: null, recentWorkspaces: ['D:\\מסמכים\\פרויקט'] })
        render(<Studio />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'File' }))
        await user.click(await screen.findByRole('menuitem', { name: 'Open Recent' }))

        const item = await screen.findByRole('menuitem', { name: 'פרויקט' })
        expect(item).toHaveAttribute('title', `${LRM}D:\\${LRM}מסמכים\\${LRM}פרויקט${LRM}`)
        expect(within(item).getByText('פרויקט')).toHaveAttribute('dir', 'auto')
    })

    it("follows the user's own key bindings and shows nothing for an unbound action", async () => {
        const keybinds = createDefaultKeybinds(false)
        keybinds['view.toggleExplorer'] = [{ key: 'b', ctrl: true, alt: true }]
        keybinds['view.fitDiagram'] = []
        mockContexts({ workspaceRoot: 'C:/work', keybinds })
        render(<Studio />)

        const view = await openMenu('View')

        expect(within(view).getByRole('menuitemcheckbox', { name: 'Explorer Ctrl+Alt+B' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitem', { name: 'Fit Diagram to Screen' })).toBeInTheDocument()
    })
})

describe('StudioMenuBar File menu', () => {
    it('has Save, Save All, Revert, the tab commands and Exit, with their shortcuts', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md', dirty: true })
        render(<Studio />)

        const file = await openMenu('File')
        expect(menuLabels(file)).toEqual([
            'New Diagram…Ctrl+Alt+N',
            'New Document…Ctrl+N',
            'New Folder…',
            'Open Folder…',
            'Close Folder',
            'SaveCtrl+S',
            'Save AllCtrl+Shift+S',
            'Revert File',
            'Close TabCtrl+W',
            'Reopen Closed TabCtrl+Shift+T',
            'Next TabCtrl+Tab or Ctrl+PageDown',
            'Previous TabCtrl+Shift+Tab or Ctrl+PageUp',
            'ExitAlt+F4',
        ])
        for (const name of [
            'New Diagram… Ctrl+Alt+N',
            'New Document… Ctrl+N',
            'New Folder…',
            'Save Ctrl+S',
            'Save All Ctrl+Shift+S',
            'Revert File',
            'Close Tab Ctrl+W',
            'Reopen Closed Tab Ctrl+Shift+T',
            'Exit Alt+F4',
        ]) {
            expect(within(file).getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled', 'true')
        }
        // Only one tab is open.
        expect(within(file).getByRole('menuitem', { name: /^Next Tab/ })).toHaveAttribute('aria-disabled', 'true')
    })

    it('reverts the open file and reopens the last closed tab', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md' })
        render(<Studio />)
        const user = userEvent.setup()

        await user.click(within(await openMenu('File')).getByRole('menuitem', { name: 'Revert File' }))
        await user.click(within(await openMenu('File')).getByRole('menuitem', { name: /^Reopen Closed Tab/ }))

        expect(vi.mocked(useDocumentTabs)().revertTab).toHaveBeenCalledWith('C:/work/a.md')
        expect(vi.mocked(useDocumentTabs)().reopenClosedTab).toHaveBeenCalledTimes(1)
    })

    it('asks for a new document in the open file’s folder', async () => {
        mockContexts({ workspaceRoot: 'C:\\work', activeTabId: 'C:\\work\\docs\\a.md' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('File')).getByRole('menuitem', { name: 'New Document… Ctrl+N' }))

        expect(promptName).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new-document', folder: 'C:\\work\\docs' }))
    })

    it('asks for a new document in the explorer row clicked before the menu', async () => {
        mockContexts({ workspaceRoot: 'C:\\work', activeTabId: 'C:\\work\\docs\\a.md' })
        render(
            <Studio>
                <div role="treeitem" aria-selected={false} tabIndex={0} data-path={'C:\\work\\drafts'}>
                    drafts
                </div>
            </Studio>
        )
        const user = userEvent.setup()

        await user.click(screen.getByRole('treeitem'))
        await user.click(within(await openMenu('File')).getByRole('menuitem', { name: 'New Document… Ctrl+N' }))

        expect(promptName).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new-document', folder: 'C:\\work\\drafts' }))
    })

    it('turns off the new items with no folder open', async () => {
        render(<Studio />)

        const file = await openMenu('File')
        for (const name of [/^New Diagram/, /^New Document/, /^New Folder/]) {
            expect(within(file).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
        }
    })

    it('saves the open file', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('File')).getByRole('menuitem', { name: /^Save Ctrl/ }))

        expect(vi.mocked(useDocumentSave)().flushSave).toHaveBeenCalledWith('C:/work/a.md')
    })

    it('turns off what needs an open file when none is', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work' })
        render(<Studio />)

        const file = await openMenu('File')
        for (const name of [/^Save Ctrl/, /^Save All/, 'Revert File', /^Close Tab/]) {
            expect(within(file).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
        }
    })
})

const MARKDOWN: ExportState = {
    tabKind: 'markdown',
    exporting: false,
    hasMarkdown: true,
    hasDiagram: false,
    hasDiagramSource: false,
    diagramError: false,
    isPending: false,
    isEmpty: false,
    isStale: false,
}
const exportActions = { openDialog: vi.fn(), openMenu: vi.fn(), exportDiagram: vi.fn() }

/** Stands in for the export provider, which registers the export commands for the active tab. */
function ExportCommands({ state }: { state: ExportState }) {
    const commands = useMemo(() => buildExportCommands({ availability: exportAvailability(state), lastFormat: 'pdf', ...exportActions }), [state])
    useRegisterCommands(commands)
    return null
}

async function openExportMenu() {
    const user = userEvent.setup()
    const file = await openMenu('File')
    await user.click(within(file).getByRole('menuitem', { name: 'Export' }))
    const exportMenu = (await screen.findByRole('menuitem', { name: 'PDF…' })).closest<HTMLElement>('[role="menu"]')!
    return { file, exportMenu }
}

describe('StudioMenuBar File → Export', () => {
    beforeEach(() => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md' })
    })

    it('sits after the save items, with every kind of export', async () => {
        render(
            <Studio>
                <ExportCommands state={MARKDOWN} />
            </Studio>
        )

        const { file, exportMenu } = await openExportMenu()
        const labels = menuLabels(file)
        const save = labels.indexOf('SaveCtrl+S')
        expect(labels.slice(save, save + 4)).toEqual(['SaveCtrl+S', 'Save AllCtrl+Shift+S', 'Revert File', 'Export'])
        expect(menuLabels(exportMenu)).toEqual(['PDF…', 'Word…', 'HTML…', 'Diagram as SVG…', 'Diagram as PNG'])
    })

    it('turns on only what the active tab can export', async () => {
        render(
            <Studio>
                <ExportCommands state={MARKDOWN} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        for (const name of ['PDF…', 'Word…', 'HTML…']) expect(within(exportMenu).getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled')
        for (const name of ['Diagram as SVG…', 'Diagram as PNG']) {
            expect(within(exportMenu).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
        }
    })

    it('opens the export dialog at the chosen format', async () => {
        render(
            <Studio>
                <ExportCommands state={MARKDOWN} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        fireEvent.click(within(exportMenu).getByRole('menuitem', { name: 'HTML…' }))
        expect(exportActions.openDialog).toHaveBeenCalledWith('html')
    })

    it('saves a diagram as SVG, or as PNG at the size picked', async () => {
        const mermaid: ExportState = { ...MARKDOWN, tabKind: 'mermaid', hasMarkdown: false, hasDiagram: true, hasDiagramSource: true }
        render(
            <Studio>
                <ExportCommands state={mermaid} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        expect(within(exportMenu).getByRole('menuitem', { name: 'PDF…' })).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(within(exportMenu).getByRole('menuitem', { name: 'Diagram as PNG' }))
        fireEvent.click(await screen.findByRole('menuitem', { name: '4×…' }))
        expect(exportActions.exportDiagram).toHaveBeenCalledWith(4)
    })

    it('is greyed out when the tab can export nothing', async () => {
        render(
            <Studio>
                <ExportCommands state={{ ...MARKDOWN, tabKind: null, hasMarkdown: false }} />
            </Studio>
        )

        const file = await openMenu('File')
        expect(within(file).getByRole('menuitem', { name: 'Export' })).toHaveAttribute('aria-disabled', 'true')
    })

    it('is left out with no folder open, as nothing can be exported', async () => {
        mockContexts()
        render(<Studio />)

        expect(menuLabels(await openMenu('File'))).not.toContain('Export')
    })
})

describe('StudioMenuBar Edit menu', () => {
    beforeEach(() => {
        mockContexts({ workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md' })
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            callback(0)
            return 0
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("lists the editor's commands with their keys", async () => {
        render(<Studio editor="ready" />)

        const edit = await openMenu('Edit')
        expect(menuLabels(edit)).toEqual([
            'UndoCtrl+Z',
            'RedoCtrl+Y',
            'CutCtrl+X',
            'CopyCtrl+C',
            'PasteCtrl+V',
            'Select AllCtrl+A',
            'FindCtrl+F',
            'ReplaceCtrl+H',
            'Go to Line…Ctrl+G',
            'BoldCtrl+B',
            'ItalicCtrl+I',
            'Inline CodeCtrl+E',
            'LinkCtrl+K',
        ])
    })

    it('runs the command in the editor', async () => {
        render(<Studio editor="ready" />)

        await userEvent.setup().click(within(await openMenu('Edit')).getByRole('menuitem', { name: /^Replace/ }))

        expect(fakeEditor.focus).toHaveBeenCalled()
        expect(fakeEditor.trigger).toHaveBeenCalledWith('scrivon', 'editor.action.startFindReplaceAction', null)
    })

    it('makes the selection bold in the editor', async () => {
        render(<Studio editor="ready" />)

        await userEvent.setup().click(within(await openMenu('Edit')).getByRole('menuitem', { name: 'Bold Ctrl+B' }))

        expect(fakeEditor.focus).toHaveBeenCalled()
        expect(formatMarkdown).toHaveBeenCalledWith(fakeEditor, 'bold')
    })

    it.each<EditorState>(['none', 'hidden'])('turns every item off when the editor is %s', async (state) => {
        render(<Studio editor={state} />)

        const items = within(await openMenu('Edit')).getAllByRole('menuitem')
        expect(items).toHaveLength(13)
        expect(items.every((item) => item.getAttribute('aria-disabled') === 'true')).toBe(true)
    })
})

describe('StudioMenuBar and the palette', () => {
    it('show each command with the same label, shortcut and on/off state', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md', canFitToView: false })
        render(<Studio editor="ready" />)
        const user = userEvent.setup()

        let compared = 0
        for (const name of ['File', 'Edit', 'View', 'Options', 'Help']) {
            const menu = await openMenu(name)
            for (const item of menuItems(menu)) {
                const row = paletteRows.find((r) => item.textContent === `${r.label}${r.shortcut ?? ''}`)
                if (!row) continue
                expect(item.getAttribute('aria-disabled') === 'true').toBe(Boolean(row.disabled))
                compared++
            }
            await user.keyboard('{Escape}')
            await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        }
        // Everything but the Open Recent and Theme submenus, which list choices rather than commands.
        expect(compared).toBe(47)
    })
})

describe('StudioMenuBar View menu', () => {
    it('turns off Fit Diagram to Screen when there is no diagram to fit', async () => {
        mockContexts({ workspaceRoot: 'C:/work', canFitToView: false })
        render(<Studio />)

        const fit = within(await openMenu('View')).getByRole('menuitem', { name: /^Fit Diagram to Screen/ })
        expect(fit).toHaveAttribute('aria-disabled', 'true')
    })

    it('zooms the diagram in, out and back to 100%, with their shortcuts (F06)', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        const view = await openMenu('View')
        expect(within(view).getByRole('menuitem', { name: 'Zoom Diagram In Alt+=' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitem', { name: 'Zoom Diagram Out Alt+-' })).toBeInTheDocument()
        await userEvent.setup().click(within(view).getByRole('menuitem', { name: 'Reset Diagram Zoom Alt+0' }))

        expect(vi.mocked(useCanvasControls)().zoomDiagram).toHaveBeenCalledWith('reset')
    })

    it('turns diagram zoom off when no diagram is shown (F06)', async () => {
        mockContexts({ workspaceRoot: 'C:/work', canFitToView: false })
        render(<Studio />)

        const view = await openMenu('View')
        for (const name of [/^Zoom Diagram In/, /^Zoom Diagram Out/, /^Reset Diagram Zoom/]) {
            expect(within(view).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
        }
    })

    it('switches the layout', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('View')).getByRole('menuitem', { name: 'Editor and Preview' }))

        expect(vi.mocked(useStudioLayout)().setExplorerOpen).toHaveBeenCalledWith(false)
        expect(vi.mocked(useStudioLayout)().setEditorOpen).toHaveBeenCalledWith(true)
    })

    it('hides the explorer from its tick box', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('View')).getByRole('menuitemcheckbox', { name: /^Explorer/ }))

        expect(vi.mocked(useStudioLayout)().setExplorerOpen).toHaveBeenCalledWith(false)
    })

    it('hides the preview from its tick box', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        const preview = within(await openMenu('View')).getByRole('menuitemcheckbox', { name: 'Preview Ctrl+Alt+P' })
        expect(preview).toHaveAttribute('aria-checked', 'true')
        await userEvent.setup().click(preview)

        expect(vi.mocked(useStudioLayout)().setPreviewOpen).toHaveBeenCalledWith(false)
    })

    it('shows and hides the Outline panel', async () => {
        mockContexts({ workspaceRoot: 'C:/work', outlineOpen: false })
        render(<Studio />)

        const outline = within(await openMenu('View')).getByRole('menuitemcheckbox', { name: 'Outline' })
        expect(outline).toHaveAttribute('aria-checked', 'false')
        await userEvent.setup().click(outline)

        expect(vi.mocked(useStudioLayout)().setOutlineOpen).toHaveBeenCalledWith(true)
    })

    it('zooms the whole app in, out and back to 100%, with the zoom keys', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', zoom: 1.25 })
        render(<Studio />)

        const view = await openMenu('View')
        expect(within(view).getByRole('menuitem', { name: 'Zoom In Ctrl+= or Ctrl+Plus' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitem', { name: 'Zoom Out Ctrl+-' })).toBeInTheDocument()
        await userEvent.setup().click(within(view).getByRole('menuitem', { name: 'Reset Zoom Ctrl+0' }))

        const update = vi.mocked(useAppSettings)().updateSettings as unknown as ReturnType<typeof vi.fn>
        const change = update.mock.calls[0]?.[0] as (current: { appearance: { zoom: number } }) => { appearance: { zoom: number } }
        expect(change({ appearance: { zoom: 1.25 } }).appearance.zoom).toBe(1)
    })
})

describe('StudioMenuBar focus after a command', () => {
    beforeEach(() => {
        mockContexts({ workspaceRoot: 'C:/work' })
    })

    function renderWithEditor() {
        render(
            <Studio>
                <textarea aria-label="editor" />
            </Studio>
        )
        const editor = screen.getByLabelText('editor')
        editor.focus()
        return editor
    }

    it('goes back to the editor after a command chosen with the keyboard', async () => {
        const editor = renderWithEditor()
        const user = userEvent.setup()

        fireEvent.keyDown(editor, { key: 'Alt', altKey: true })
        fireEvent.keyUp(editor, { key: 'Alt' })
        expect(screen.getByRole('menuitem', { name: 'File' })).toHaveFocus()
        await user.keyboard('{ArrowRight}{ArrowRight}')
        expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus()
        await user.keyboard('{ArrowDown}')
        const fit = within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Fit Diagram to Screen/ })
        await waitFor(() => expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull())
        fit.focus()
        await user.keyboard('{Enter}')

        expect(vi.mocked(useCanvasFit)().requestCanvasFit).toHaveBeenCalledTimes(1)
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        await waitFor(() => expect(editor).toHaveFocus())
    })

    it('goes back to the editor after a command chosen with the mouse', async () => {
        const editor = renderWithEditor()
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'View' }))
        await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Preview Only/ }))

        expect(vi.mocked(useStudioLayout)().setPreviewOnly).toHaveBeenCalledTimes(1)
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        await waitFor(() => expect(editor).toHaveFocus())
    })

    it('keeps focus in a dialog the command opened', async () => {
        renderWithEditor()
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'Help' }))
        await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'About Scrivon…' }))

        const about = await screen.findByRole('dialog')
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        await waitFor(() => expect(about.contains(document.activeElement)).toBe(true))
    })

    it('goes back to the menu title when Esc closes a menu', async () => {
        renderWithEditor()
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'View' }))
        await screen.findByRole('menu')
        await user.keyboard('{Escape}')

        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'View' })).toHaveFocus())
    })
})

describe('StudioMenuBar when a feature adds a command later', () => {
    it('shows it without the menu bar changing', async () => {
        mockContexts({ workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md' })
        const view = render(<Studio editor="none" />)
        expect(within(await openMenu('Edit')).getByRole('menuitem', { name: /^Find/ })).toHaveAttribute('aria-disabled', 'true')
        await userEvent.setup().keyboard('{Escape}')

        view.rerender(<Studio editor="ready" />)
        await act(async () => {})
        expect(within(await openMenu('Edit')).getByRole('menuitem', { name: /^Find/ })).not.toHaveAttribute('aria-disabled', 'true')
    })
})
