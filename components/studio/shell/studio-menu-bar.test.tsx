import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { commandToPaletteItem } from '@/components/studio/command-palette/command-items'
import { CommandRegistryProvider, useCommands } from '@/components/studio/commands/command-registry'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { useEditorCommands } from '@/components/studio/editor/editor-commands'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { StudioCommands } from '@/components/studio/shell/studio-commands'
import { useAppTheme } from '@/components/theme/app-theme-provider'
import {
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
import { StudioMenuBar } from './studio-menu-bar'

vi.mock('next/image', () => ({
    default: (props: { alt: string }) => <span data-alt={props.alt} />,
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useCanvasFit: vi.fn(),
    useDocumentSave: vi.fn(),
    useDocumentTabs: vi.fn(),
    useStudioLayout: vi.fn(),
    useWorkspaceCoordinator: vi.fn(),
    useWorkspaceSession: vi.fn(),
}))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: vi.fn() }))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({ useCanvasControls: vi.fn() }))
vi.mock('@/components/studio/theme/theme-menu', () => ({ ThemeMenu: () => null }))
vi.mock('@/lib/monaco/markdown-editing', () => ({ formatMarkdown: vi.fn() }))
vi.mock('@/components/studio/dialogs/open-source-licenses-dialog', () => ({ OpenSourceLicensesDialog: () => null }))
vi.mock('@/components/studio/shell/menu-bar-update-button', () => ({ MenuBarUpdateButton: () => <button type="button">Update</button> }))
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
} = {}) {
    vi.mocked(useCanvasControls).mockReturnValue({ canFitToView } as unknown as ReturnType<typeof useCanvasControls>)
    vi.mocked(useWorkspaceSession).mockReturnValue({
        isDesktop,
        workspaceRoot,
        openingWorkspace,
        recentWorkspaces,
        pickAndOpenWorkspace: vi.fn(),
        openWorkspace: vi.fn(),
        closeWorkspace: vi.fn(),
        refreshTree: vi.fn(async () => {}),
    } as unknown as ReturnType<typeof useWorkspaceSession>)
    vi.mocked(useWorkspaceCoordinator).mockReturnValue({ reloadChangedTabs: { current: vi.fn(async () => {}) } } as unknown as ReturnType<
        typeof useWorkspaceCoordinator
    >)
    vi.mocked(useDocumentTabs).mockReturnValue({
        tabs: activeTabId ? [{ id: activeTabId, path: activeTabId, name: 'a.md', content: '', isDirty: dirty }] : [],
        activeTabId,
        activeTab,
        openExample: vi.fn(),
        closeTab: vi.fn(async () => {}),
        closeOtherTabs: vi.fn(async () => {}),
        closeAllTabs: vi.fn(async () => {}),
    } as unknown as ReturnType<typeof useDocumentTabs>)
    vi.mocked(useStudioLayout).mockReturnValue({
        layout: { explorerOpen: true, editorOpen: true, outlineOpen },
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
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
        settings: { keybinds },
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

    it('lists About and Licences directly in the Help menu', async () => {
        render(<Studio />)

        const menu = await openMenu('Help')
        expect(within(menu).getByRole('menuitem', { name: 'About Scrivon…' })).toBeInTheDocument()
        expect(within(menu).getByRole('menuitem', { name: 'Licences…' })).toBeInTheDocument()
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
    it('has Save, Save All, Close Tab and Exit, with their shortcuts', async () => {
        mockContexts({ isDesktop: true, workspaceRoot: 'C:/work', activeTabId: 'C:/work/a.md', dirty: true })
        render(<Studio />)

        const file = await openMenu('File')
        expect(menuLabels(file)).toEqual(['Open Folder…', 'Close Folder', 'SaveCtrl+S', 'Save AllCtrl+Shift+S', 'Close Tab', 'ExitAlt+F4'])
        for (const name of ['Save Ctrl+S', 'Save All Ctrl+Shift+S', 'Close Tab', 'Exit Alt+F4']) {
            expect(within(file).getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled', 'true')
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
        for (const name of [/^Save Ctrl/, /^Save All/, 'Close Tab']) {
            expect(within(file).getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true')
        }
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
        expect(compared).toBe(30)
    })
})

describe('StudioMenuBar View menu', () => {
    it('turns off Fit Diagram to Screen when there is no diagram to fit', async () => {
        mockContexts({ workspaceRoot: 'C:/work', canFitToView: false })
        render(<Studio />)

        const fit = within(await openMenu('View')).getByRole('menuitem', { name: /^Fit Diagram to Screen/ })
        expect(fit).toHaveAttribute('aria-disabled', 'true')
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

    it('shows and hides the Outline panel', async () => {
        mockContexts({ workspaceRoot: 'C:/work', outlineOpen: false })
        render(<Studio />)

        const outline = within(await openMenu('View')).getByRole('menuitemcheckbox', { name: 'Outline' })
        expect(outline).toHaveAttribute('aria-checked', 'false')
        await userEvent.setup().click(outline)

        expect(vi.mocked(useStudioLayout)().setOutlineOpen).toHaveBeenCalledWith(true)
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
