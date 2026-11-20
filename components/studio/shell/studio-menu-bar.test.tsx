import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useMemo, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { CommandRegistryProvider, useCommands, useRegisterCommands } from '@/components/studio/commands/command-registry'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { useEditorCommands } from '@/components/studio/editor/editor-commands'
import { PresentModeProvider, usePresentMode } from '@/components/studio/present/present-mode-provider'
import { exportAvailability, type ExportState } from '@/components/studio/editor/export-availability'
import { buildExportCommands } from '@/components/studio/editor/export-commands'
import { batchExportAvailability, buildBatchExportCommands, type BatchExportState } from '@/components/studio/batch-export/batch-export-commands'
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
import { editMarkdownTable, formatMarkdown } from '@/lib/monaco/markdown-editing'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import type { AppSettings, KeybindBindings } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'
import { StudioMenuBar } from './studio-menu-bar'

vi.mock('next/image', () => ({
    default: (props: { alt: string }) => <span data-alt={props.alt} />,
}))
const promptName = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/components/studio/dialogs/name-prompt-provider', () => ({ useNamePrompt: () => ({ promptName }) }))
const chooseTemplate = vi.hoisted(() =>
    vi.fn(async () => ({ title: 'Meeting notes', fileName: 'meeting-notes.md', kind: 'markdown' as const, text: '# {{title}}' }))
)
vi.mock('@/components/studio/dialogs/template-picker-provider', () => ({ useTemplatePicker: () => ({ chooseTemplate }) }))
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
const showFileHistory = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/components/studio/dialogs/file-history-provider', () => ({ useFileHistory: () => ({ showFileHistory }) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: vi.fn() }))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({ useCanvasControls: vi.fn() }))
const openPaletteMode = vi.hoisted(() => vi.fn())
vi.mock('@/components/studio/command-palette/command-palette-provider', () => ({
    useOptionalCommandPalette: () => ({ open: vi.fn(), openMode: openPaletteMode }),
}))
vi.mock('@/components/studio/theme/theme-menu', () => ({ ThemeMenu: () => null }))
vi.mock('@/lib/monaco/markdown-editing', () => ({
    formatMarkdown: vi.fn(),
    editMarkdownTable: vi.fn(),
    canInsertMarkdownTable: vi.fn(() => true),
    insertMarkdownTable: vi.fn(),
}))
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
    statusBarVisible = true,
    spellcheckEnabled = true,
    focusMode = false,
    dimOtherParagraphs = false,
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
        layout: focusMode
            ? { explorerOpen: false, editorOpen: true, previewOpen: false, outlineOpen: false }
            : { explorerOpen: true, editorOpen: true, previewOpen: true, outlineOpen },
        focusMode,
        setFocusMode: vi.fn(),
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
        settings: {
            keybinds,
            appearance: { zoom, previewFontSize: 14 },
            theme: { id: 'scrivon-dark', light: 'scrivon-light', dark: 'scrivon-dark' },
            statusBar: { visible: statusBarVisible },
            spellcheck: { enabled: spellcheckEnabled, language: 'en-GB', words: [] },
            editor: { scrollSync: true, jumpFromPreview: true, dimOtherParagraphs },
            layout: { focusMode },
        },
        updateSettings: vi.fn(),
        openSettings: vi.fn(),
        flushPendingSettings: vi.fn(),
    } as unknown as ReturnType<typeof useAppSettings>)
    vi.mocked(useAppTheme).mockReturnValue({ themeId: 'scrivon-dark', isLight: false, setThemeId: vi.fn() } as unknown as ReturnType<
        typeof useAppTheme
    >)
    vi.mocked(useCanvasFit).mockReturnValue({ requestCanvasFit: vi.fn() } as unknown as ReturnType<typeof useCanvasFit>)
}

const askTableSize = vi.fn(async () => null)

/** Stands in for the editor panel, which registers the Edit menu's commands. */
function EditorCommands({ state, inTable = false }: { state: EditorState; inTable?: boolean }) {
    useEditorCommands(state === 'none' ? null : (fakeEditor as never), {
        shown: state === 'ready',
        readOnly: false,
        markdown: true,
        inTable,
        askTableSize,
    })
    return null
}

/** The palette's rows, from the same list: label, shortcut and whether it can run. */
let paletteRows: Array<{ label: string; shortcut?: string; disabled?: boolean; disabledReason?: string }> = []
function PaletteRows() {
    const commands = useCommands()
    useEffect(() => {
        paletteRows = commands.map(commandToPaletteItem)
    }, [commands])
    return null
}

/** The menu bar as the studio has it: the commands registered by the features, read by the menu bar. */
function Studio({ children, editor = 'none', inTable }: { children?: ReactNode; editor?: EditorState; inTable?: boolean }) {
    return (
        <CommandRegistryProvider>
            <StudioCommands />
            <HelpCommands />
            <EditorCommands state={editor} inTable={inTable} />
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

    it('lists the command palette, the bug report helpers, About and Licences directly in the Help menu', async () => {
        render(<Studio />)

        const menu = await openMenu('Help')
        // The browser build has no updates to check for.
        expect(menuLabels(menu)).toEqual([
            'Command Palette…F1',
            'Report an Issue',
            'Copy Diagnostic Info',
            'Open Logs Folder',
            'About Scrivon…',
            'Licences…',
        ])
        // One under the palette and one between the two groups, with no stray one for the missing update check.
        expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2)
    })

    it('opens the command palette from the Help menu with no folder open', async () => {
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('Help')).getByRole('menuitem', { name: 'Command Palette… F1' }))

        expect(openPaletteMode).toHaveBeenCalledWith('all')
    })

    it('checks for updates from the Help menu of the desktop app', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        render(<Studio />)

        const menu = await openMenu('Help')
        expect(menuLabels(menu)).toEqual([
            'Command Palette…F1',
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
            'New Diagram…Alt+N',
            'New Document…Ctrl+N',
            'New Folder…',
            'New from Template…',
            'Open Folder…',
            'Close Folder',
            'SaveCtrl+S',
            'Save AllCtrl+Shift+S',
            'Revert File',
            'Show File History…',
            'Close TabCtrl+W',
            'Reopen Closed TabCtrl+Shift+T',
            'Next TabCtrl+Tab or Ctrl+PageDown',
            'Previous TabCtrl+Shift+Tab or Ctrl+PageUp',
            'Move Tab LeftCtrl+Shift+PageUp',
            'Move Tab RightCtrl+Shift+PageDown',
            'ExitAlt+F4',
        ])
        for (const name of [
            'New Diagram… Alt+N',
            'New Document… Ctrl+N',
            'New Folder…',
            'Save Ctrl+S',
            'Save All Ctrl+Shift+S',
            'Revert File',
            'Show File History…',
            'Close Tab Ctrl+W',
            'Reopen Closed Tab Ctrl+Shift+T',
            'Exit Alt+F4',
        ]) {
            expect(within(file).getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled', 'true')
        }
        // Only one tab is open.
        expect(within(file).getByRole('menuitem', { name: /^Next Tab/ })).toHaveAttribute('aria-disabled', 'true')
        expect(within(file).getByRole('menuitem', { name: /^Move Tab Left/ })).toHaveAttribute('aria-disabled', 'true')
        expect(within(file).getByRole('menuitem', { name: /^Move Tab Right/ })).toHaveAttribute('aria-disabled', 'true')
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

    it('shows the open file’s history', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md' })
        render(<Studio />)
        const user = userEvent.setup()

        await user.click(within(await openMenu('File')).getByRole('menuitem', { name: 'Show File History…' }))

        expect(showFileHistory).toHaveBeenCalledWith('C:/work/a.md')
    })

    it('asks for a new document in the open file’s folder', async () => {
        mockContexts({ workspaceRoot: 'C:\\work', activeTabId: 'C:\\work\\docs\\a.md' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('File')).getByRole('menuitem', { name: 'New Document… Ctrl+N' }))

        expect(promptName).toHaveBeenCalledWith(expect.objectContaining({ kind: 'new-document', folder: 'C:\\work\\docs' }))
    })

    it('starts a new file from a template in the folder New Document would use', async () => {
        mockContexts({ workspaceRoot: 'C:\\work', activeTabId: 'C:\\work\\docs\\a.md' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('File')).getByRole('menuitem', { name: 'New from Template…' }))

        expect(chooseTemplate).toHaveBeenCalledTimes(1)
        await waitFor(() =>
            expect(promptName).toHaveBeenCalledWith(
                expect.objectContaining({
                    kind: 'new-from-template',
                    folder: 'C:\\work\\docs',
                    template: { title: 'Meeting notes', extension: '.md' },
                })
            )
        )
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
        for (const name of [/^New Diagram/, /^New Document/, /^New Folder/, /^New from Template/]) {
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
        for (const name of [/^Save Ctrl/, /^Save All/, 'Revert File', 'Show File History…', /^Close Tab/]) {
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
const exportActions = {
    openDialog: vi.fn(),
    openMenu: vi.fn(),
    exportDiagram: vi.fn(),
    diagramOptions: { theme: 'app', transparent: false },
    setDiagramOptions: vi.fn(),
} as const

/** Stands in for the export provider, which registers the export commands for the active tab. */
function ExportCommands({ state }: { state: ExportState }) {
    const commands = useMemo(() => buildExportCommands({ availability: exportAvailability(state), lastFormat: 'pdf', ...exportActions }), [state])
    useRegisterCommands(commands)
    return null
}

const exportOpenFolder = vi.fn()

/** Stands in for the folder export provider, which registers Export All Diagrams in Folder…. */
function FolderExportCommand({ state }: { state: BatchExportState }) {
    const commands = useMemo(() => buildBatchExportCommands({ availability: batchExportAvailability(state), exportOpenFolder }), [state])
    useRegisterCommands(commands)
    return null
}

const FOLDER_OPEN: BatchExportState = { isDesktop: true, hasFolder: true, exporting: false }

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
        expect(labels.slice(save, save + 5)).toEqual(['SaveCtrl+S', 'Save AllCtrl+Shift+S', 'Revert File', 'Show File History…', 'Export'])
        expect(menuLabels(exportMenu)).toEqual([
            'PDF…',
            'Word…',
            'HTML…',
            'Diagram as SVG…',
            'Diagram as PNG',
            'Copy Diagram as SVG',
            'Copy Diagram as PNG',
        ])
    })

    it('ends with the export of every diagram in the open folder', async () => {
        render(
            <Studio>
                <ExportCommands state={MARKDOWN} />
                <FolderExportCommand state={FOLDER_OPEN} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        expect(menuLabels(exportMenu).at(-1)).toBe('All Diagrams in Folder…')
        fireEvent.click(within(exportMenu).getByRole('menuitem', { name: 'All Diagrams in Folder…' }))
        expect(exportOpenFolder).toHaveBeenCalled()
    })

    it('is on with a folder open and no tab, for the export of every diagram in the folder', async () => {
        render(
            <Studio>
                <ExportCommands state={{ ...MARKDOWN, tabKind: null, hasMarkdown: false }} />
                <FolderExportCommand state={FOLDER_OPEN} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        expect(within(exportMenu).getByRole('menuitem', { name: 'PDF…' })).toHaveAttribute('aria-disabled', 'true')
        expect(within(exportMenu).getByRole('menuitem', { name: 'All Diagrams in Folder…' })).not.toHaveAttribute('aria-disabled')
    })

    it('is left out on the welcome screen, where the folder export is only in the palette, greyed out', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: null, openingWorkspace: null, recentWorkspaces: [] })
        render(
            <Studio>
                <FolderExportCommand state={{ ...FOLDER_OPEN, hasFolder: false }} />
            </Studio>
        )

        const file = await openMenu('File')
        expect(within(file).getByRole('menuitem', { name: /^Save Ctrl/ })).toBeInTheDocument()
        expect(within(file).queryByRole('menuitem', { name: 'Export' })).not.toBeInTheDocument()
    })

    it('greys out the folder export while another export runs', async () => {
        render(
            <Studio>
                <ExportCommands state={{ ...MARKDOWN, exporting: true }} />
                <FolderExportCommand state={{ ...FOLDER_OPEN, exporting: true }} />
            </Studio>
        )

        const file = await openMenu('File')
        expect(within(file).getByRole('menuitem', { name: 'Export' })).toHaveAttribute('aria-disabled', 'true')
    })

    it('turns on only what the active tab can export', async () => {
        render(
            <Studio>
                <ExportCommands state={MARKDOWN} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        for (const name of ['PDF…', 'Word…', 'HTML…']) expect(within(exportMenu).getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled')
        for (const name of ['Diagram as SVG…', 'Diagram as PNG', 'Copy Diagram as SVG', 'Copy Diagram as PNG']) {
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

    it('copies a diagram to the clipboard', async () => {
        const mermaid: ExportState = { ...MARKDOWN, tabKind: 'mermaid', hasMarkdown: false, hasDiagram: true, hasDiagramSource: true }
        render(
            <Studio>
                <ExportCommands state={mermaid} />
            </Studio>
        )

        const { exportMenu } = await openExportMenu()
        fireEvent.click(within(exportMenu).getByRole('menuitem', { name: 'Copy Diagram as PNG' }))
        expect(exportActions.exportDiagram).toHaveBeenCalledWith('copy-png')
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
            'Find in Workspace…Ctrl+Shift+F',
            'Replace in Workspace…Ctrl+Shift+H',
            'Go to Line…Ctrl+G',
            'Go to File…Ctrl+Shift+N',
            'BoldCtrl+B',
            'ItalicCtrl+I',
            'Inline CodeCtrl+E',
            'LinkCtrl+K',
            'Table',
        ])
    })

    it('runs the command in the editor', async () => {
        render(<Studio editor="ready" />)

        await userEvent.setup().click(within(await openMenu('Edit')).getByRole('menuitem', { name: 'Replace Ctrl+H' }))

        expect(fakeEditor.focus).toHaveBeenCalled()
        expect(fakeEditor.trigger).toHaveBeenCalledWith('scrivon', 'editor.action.startFindReplaceAction', null)
    })

    it('makes the selection bold in the editor', async () => {
        render(<Studio editor="ready" />)

        await userEvent.setup().click(within(await openMenu('Edit')).getByRole('menuitem', { name: 'Bold Ctrl+B' }))

        expect(fakeEditor.focus).toHaveBeenCalled()
        expect(formatMarkdown).toHaveBeenCalledWith(fakeEditor, 'bold')
    })

    it.each([
        ['Find in Workspace… Ctrl+Shift+F', 'text'],
        ['Go to File… Ctrl+Shift+N', 'files'],
    ])('opens the palette from %s', async (name, mode) => {
        render(<Studio editor="ready" />)

        await userEvent.setup().click(within(await openMenu('Edit')).getByRole('menuitem', { name }))

        expect(openPaletteMode).toHaveBeenCalledWith(mode)
    })

    it('opens the palette with the Replace box from Replace in Workspace…', async () => {
        render(<Studio editor="ready" />)

        await userEvent.setup().click(within(await openMenu('Edit')).getByRole('menuitem', { name: 'Replace in Workspace… Ctrl+Shift+H' }))

        expect(openPaletteMode).toHaveBeenCalledWith('text', { replace: true })
    })

    it.each<EditorState>(['none', 'hidden'])('turns every editor item off when the editor is %s, but not the palette ones', async (state) => {
        render(<Studio editor={state} />)

        const menu = await openMenu('Edit')
        const palette = ['Find in Workspace… Ctrl+Shift+F', 'Replace in Workspace… Ctrl+Shift+H', 'Go to File… Ctrl+Shift+N'].map((name) =>
            within(menu).getByRole('menuitem', { name })
        )
        const editorItems = within(menu)
            .getAllByRole('menuitem')
            .filter((item) => !palette.includes(item))
        // The editor's thirteen, and the Table submenu.
        expect(editorItems).toHaveLength(14)
        expect(editorItems.every((item) => item.getAttribute('aria-disabled') === 'true')).toBe(true)
        expect(palette.every((item) => item.getAttribute('aria-disabled') !== 'true')).toBe(true)
    })
})

describe('StudioMenuBar Edit → Table', () => {
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

    async function openTableMenu() {
        const edit = await openMenu('Edit')
        await userEvent.setup().click(within(edit).getByRole('menuitem', { name: 'Table' }))
        const table = (await screen.findByRole('menuitem', { name: 'Insert Table…' })).closest<HTMLElement>('[role="menu"]')!
        return { edit, table }
    }

    it('ends the Edit menu, with every table command and Format Table’s keys', async () => {
        render(<Studio editor="ready" inTable />)

        const { edit, table } = await openTableMenu()
        expect(menuLabels(edit).at(-1)).toBe('Table')
        expect(menuLabels(table)).toEqual([
            'Insert Table…',
            'Insert Row Above',
            'Insert Row Below',
            'Delete Row',
            'Move Row Up',
            'Move Row Down',
            'Insert Column Left',
            'Insert Column Right',
            'Delete Column',
            'Move Column Left',
            'Move Column Right',
            'Align Column Left',
            'Align Column Centre',
            'Align Column Right',
            'Align Column None',
            'Format TableAlt+Shift+F',
        ])
    })

    it('runs a table command in the editor', async () => {
        render(<Studio editor="ready" inTable />)

        const { table } = await openTableMenu()
        await userEvent.setup().click(within(table).getByRole('menuitem', { name: 'Move Column Right' }))

        expect(fakeEditor.focus).toHaveBeenCalled()
        expect(editMarkdownTable).toHaveBeenCalledWith(fakeEditor, 'move-column-right')
    })

    it('opens Insert Table… from the menu', async () => {
        render(<Studio editor="ready" />)

        const { table } = await openTableMenu()
        await userEvent.setup().click(within(table).getByRole('menuitem', { name: 'Insert Table…' }))

        await waitFor(() => expect(askTableSize).toHaveBeenCalled())
    })

    const off = (menu: HTMLElement) =>
        menuItems(menu)
            .filter((item) => item.getAttribute('aria-disabled') === 'true')
            .map((item) => item.textContent)

    it('greys out what needs a table outside one', async () => {
        render(<Studio editor="ready" />)

        const { table } = await openTableMenu()

        expect(off(table)).toHaveLength(15)
        expect(off(table)).not.toContain('Insert Table…')
    })

    it('greys out Insert Table… in a table', async () => {
        render(<Studio editor="ready" inTable />)

        const { table } = await openTableMenu()

        expect(off(table)).toEqual(['Insert Table…'])
    })

    it('greys out the submenu when no file is open', async () => {
        render(<Studio editor="none" />)

        const edit = await openMenu('Edit')

        expect(within(edit).getByRole('menuitem', { name: 'Table' })).toHaveAttribute('aria-disabled', 'true')
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
        expect(compared).toBe(62)
    })
})

describe('StudioMenuBar View menu', () => {
    describe('Present', () => {
        function PresentState() {
            return <p data-testid="presenting">{usePresentMode().presentingTabId ?? 'off'}</p>
        }

        function renderWithPresentMode() {
            const fullscreen = { enter: vi.fn(async () => {}), leave: vi.fn(async () => {}) }
            render(
                <PresentModeProvider fullscreen={fullscreen}>
                    <Studio>
                        <PresentState />
                    </Studio>
                </PresentModeProvider>
            )
        }

        it('presents the open Markdown document, with F5', async () => {
            const activeTab = { id: 'C:/work/a.md', name: 'a.md', content: '# Talk', isDirty: false }
            mockContexts({ workspaceRoot: 'C:/work', activeTabId: activeTab.id, activeTab })
            renderWithPresentMode()

            const present = within(await openMenu('View')).getByRole('menuitem', { name: /^Present/ })
            expect(present).toHaveTextContent('PresentF5')
            expect(present).not.toHaveAttribute('aria-disabled', 'true')
            await userEvent.setup().click(present)

            expect(screen.getByTestId('presenting')).toHaveTextContent('C:/work/a.md')
        })

        it('is greyed out, with the reason in the palette, when the open document isn’t Markdown or is empty', async () => {
            const diagram = { id: 'C:/work/flow.mmd', name: 'flow.mmd', content: 'flowchart TD', isDirty: false }
            mockContexts({ workspaceRoot: 'C:/work', activeTabId: diagram.id, activeTab: diagram })
            renderWithPresentMode()

            expect(within(await openMenu('View')).getByRole('menuitem', { name: /^Present/ })).toHaveAttribute('aria-disabled', 'true')
            expect(paletteRows.find((row) => row.label === 'Present')).toMatchObject({
                disabled: true,
                disabledReason: 'Only Markdown documents can be presented',
            })
        })
    })

    it('lists the panels with the Status Bar, the layouts, and the explorer helpers', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        const view = await openMenu('View')
        const groups = Array.from(view.querySelectorAll('[role="group"]')).map((group) =>
            Array.from(group.querySelectorAll('[role^="menuitem"]')).map((item) => item.textContent)
        )
        expect(groups.slice(0, 4)).toEqual([
            ['ExplorerCtrl+Shift+B', 'EditorCtrl+E', 'PreviewCtrl+Alt+P', 'Outline', 'Status Bar'],
            ['Show All Panels', 'Editor and Preview', 'Preview OnlyCtrl+Shift+O'],
            ['Focus ModeF11', 'Dim Other Paragraphs', 'PresentF5'],
            ['Reveal Active File in Sidebar', 'Collapse All Folders'],
        ])
    })

    it('turns focus mode on from its tick box, with F11', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        const focus = within(await openMenu('View')).getByRole('menuitemcheckbox', { name: 'Focus Mode F11' })
        expect(focus).toHaveAttribute('aria-checked', 'false')
        await userEvent.setup().click(focus)

        expect(vi.mocked(useStudioLayout)().setFocusMode).toHaveBeenCalledWith(true)
    })

    it('turns focus mode off from the menu, which stays in focus mode, and shows the hidden panes as off', async () => {
        mockContexts({ workspaceRoot: 'C:/work', focusMode: true, statusBarVisible: true })
        render(<Studio />)

        const view = await openMenu('View')
        for (const name of ['Explorer Ctrl+Shift+B', 'Preview Ctrl+Alt+P', 'Outline', 'Status Bar']) {
            expect(within(view).getByRole('menuitemcheckbox', { name })).toHaveAttribute('aria-checked', 'false')
        }
        const focus = within(view).getByRole('menuitemcheckbox', { name: 'Focus Mode F11' })
        expect(focus).toHaveAttribute('aria-checked', 'true')
        await userEvent.setup().click(focus)

        expect(vi.mocked(useStudioLayout)().setFocusMode).toHaveBeenCalledWith(false)
    })

    it('switches Dim other paragraphs from its tick box', async () => {
        mockContexts({ workspaceRoot: 'C:/work', dimOtherParagraphs: true })
        render(<Studio />)

        const dim = within(await openMenu('View')).getByRole('menuitemcheckbox', { name: 'Dim Other Paragraphs' })
        expect(dim).toHaveAttribute('aria-checked', 'true')
        await userEvent.setup().click(dim)

        const update = vi.mocked(useAppSettings)().updateSettings as unknown as ReturnType<typeof vi.fn>
        const change = update.mock.calls[0]?.[0] as (current: AppSettings) => AppSettings
        expect(change(createDefaultSettings(false)).editor.dimOtherParagraphs).toBe(true)
    })

    it('shows and hides the status bar from its tick box', async () => {
        mockContexts({ workspaceRoot: 'C:/work', statusBarVisible: true })
        render(<Studio />)

        const statusBar = within(await openMenu('View')).getByRole('menuitemcheckbox', { name: 'Status Bar' })
        expect(statusBar).toHaveAttribute('aria-checked', 'true')
        await userEvent.setup().click(statusBar)

        const update = vi.mocked(useAppSettings)().updateSettings as unknown as ReturnType<typeof vi.fn>
        const change = update.mock.calls[0]?.[0] as (current: AppSettings) => AppSettings
        expect(change(createDefaultSettings(false)).statusBar.visible).toBe(false)
    })

    it('closes every folder in the explorer', async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<Studio />)

        await userEvent.setup().click(within(await openMenu('View')).getByRole('menuitem', { name: 'Collapse All Folders' }))

        expect(vi.mocked(useWorkspaceSession)().setFoldersExpanded).toHaveBeenCalledWith(expect.arrayContaining(['C:\\work\\docs']), false)
    })

    it('opens the Outline with all panels and closes it for Editor and Preview', async () => {
        mockContexts({ workspaceRoot: 'C:/work', outlineOpen: false })
        render(<Studio />)
        const user = userEvent.setup()

        await user.click(within(await openMenu('View')).getByRole('menuitem', { name: 'Show All Panels' }))
        expect(vi.mocked(useStudioLayout)().setOutlineOpen).toHaveBeenLastCalledWith(true)
        await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

        await user.click(within(await openMenu('View')).getByRole('menuitem', { name: 'Editor and Preview' }))
        expect(vi.mocked(useStudioLayout)().setOutlineOpen).toHaveBeenLastCalledWith(false)
    })

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
        expect(within(view).getByRole('menuitem', { name: 'Zoom Diagram In Alt+= or Alt+Plus' })).toBeInTheDocument()
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

describe('StudioMenuBar Options menu', () => {
    it('switches spell check on and off next to Autosave', async () => {
        mockContexts({ spellcheckEnabled: false })
        render(<Studio />)

        const options = await openMenu('Options')
        expect(menuLabels(options)).toEqual(['Settings…Ctrl+,', 'Autosave', 'Spell Check'])
        const spelling = within(options).getByRole('menuitemcheckbox', { name: 'Spell Check' })
        expect(spelling).toHaveAttribute('aria-checked', 'false')
        await userEvent.setup().click(spelling)

        const update = vi.mocked(useAppSettings)().updateSettings as unknown as ReturnType<typeof vi.fn>
        const change = update.mock.calls[0]?.[0] as (current: { spellcheck: { enabled: boolean } }) => { spellcheck: { enabled: boolean } }
        expect(change({ spellcheck: { enabled: false } }).spellcheck.enabled).toBe(true)
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
        expect(within(await openMenu('Edit')).getByRole('menuitem', { name: 'Find Ctrl+F' })).toHaveAttribute('aria-disabled', 'true')
        await userEvent.setup().keyboard('{Escape}')

        view.rerender(<Studio editor="ready" />)
        await act(async () => {})
        expect(within(await openMenu('Edit')).getByRole('menuitem', { name: 'Find Ctrl+F' })).not.toHaveAttribute('aria-disabled', 'true')
    })
})
