import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import {
    useCanvasFit,
    useDocumentSave,
    useDocumentTabs,
    useStudioLayout,
    useWorkspaceSession,
} from '@/components/studio/workspace/workspace-provider'
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
    useWorkspaceSession: vi.fn(),
}))
vi.mock('@/components/studio/settings/settings-provider', () => ({ useAppSettings: vi.fn() }))
vi.mock('@/components/studio/canvas/canvas-controls-provider', () => ({ useCanvasControls: vi.fn() }))
vi.mock('@/components/studio/theme/theme-menu', () => ({ ThemeMenu: () => null }))
vi.mock('@/components/studio/shell/menu-bar-update-button', () => ({ MenuBarUpdateButton: () => <button type="button">Update</button> }))
vi.mock('@/components/studio/shell/window-titlebar-controls', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/components/studio/shell/window-titlebar-controls')>()),
    WindowTitlebarControls: () => null,
}))

function mockContexts({
    isDesktop = false,
    workspaceRoot = null as string | null,
    openingWorkspace = null as string | null,
    recentWorkspaces = [] as string[],
    keybinds = createDefaultKeybinds(false) as KeybindBindings,
    canFitToView = true,
    activeTab = null as { name: string; isDirty: boolean } | null,
} = {}) {
    vi.mocked(useDocumentTabs).mockReturnValue({ activeTab } as unknown as ReturnType<typeof useDocumentTabs>)
    vi.mocked(useCanvasControls).mockReturnValue({ canFitToView } as unknown as ReturnType<typeof useCanvasControls>)
    vi.mocked(useWorkspaceSession).mockReturnValue({
        isDesktop,
        workspaceRoot,
        openingWorkspace,
        recentWorkspaces,
        pickAndOpenWorkspace: vi.fn(),
        openWorkspace: vi.fn(),
        closeWorkspace: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceSession>)
    vi.mocked(useStudioLayout).mockReturnValue({
        layout: { explorerOpen: true, editorOpen: true },
        setExplorerOpen: vi.fn(),
        setEditorOpen: vi.fn(),
        setPreviewOnly: vi.fn(),
    } as unknown as ReturnType<typeof useStudioLayout>)
    vi.mocked(useDocumentSave).mockReturnValue({ autosaveEnabled: true, setAutosaveEnabled: vi.fn() } as unknown as ReturnType<
        typeof useDocumentSave
    >)
    vi.mocked(useAppSettings).mockReturnValue({ settings: { keybinds }, openSettings: vi.fn() } as unknown as ReturnType<typeof useAppSettings>)
    vi.mocked(useCanvasFit).mockReturnValue({ requestCanvasFit: vi.fn() } as unknown as ReturnType<typeof useCanvasFit>)
}

describe('StudioMenuBar', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockContexts()
    })

    it('is a real menubar with arrow-key movement between menus', async () => {
        render(<StudioMenuBar />)

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

    it('keeps the update button out of the menubar focus loop', () => {
        mockContexts({ isDesktop: true })
        render(<StudioMenuBar />)

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
        render(<StudioMenuBar />)

        fireEvent.keyDown(document.body, { key: 'F10' })

        expect(screen.getByRole('menuitem', { name: 'File' })).toHaveFocus()
    })

    it('lists About and Licences directly in the Help menu', async () => {
        render(<StudioMenuBar />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'Help' }))

        const menu = await screen.findByRole('menu')
        expect(within(menu).getByRole('menuitem', { name: 'About Scrivon…' })).toBeInTheDocument()
        expect(within(menu).getByRole('menuitem', { name: 'Licences…' })).toBeInTheDocument()
    })

    it("shows each item's keyboard shortcut", async () => {
        mockContexts({ workspaceRoot: 'C:/work' })
        render(<StudioMenuBar />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'View' }))
        const view = await screen.findByRole('menu')
        expect(within(view).getByRole('menuitemcheckbox', { name: 'Explorer Ctrl+B' })).toBeInTheDocument()
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
        render(<StudioMenuBar />)
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
        render(<StudioMenuBar />)
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
        render(<StudioMenuBar />)
        const user = userEvent.setup()

        await user.click(screen.getByRole('menuitem', { name: 'View' }))
        const view = await screen.findByRole('menu')

        expect(within(view).getByRole('menuitemcheckbox', { name: 'Explorer Ctrl+Alt+B' })).toBeInTheDocument()
        expect(within(view).getByRole('menuitem', { name: 'Fit Diagram to Screen' })).toBeInTheDocument()
    })
})

describe('StudioMenuBar View menu', () => {
    beforeEach(() => vi.clearAllMocks())

    it('turns off Fit Diagram to Screen when there is no diagram to fit', async () => {
        mockContexts({ workspaceRoot: 'C:/work', canFitToView: false })
        render(<StudioMenuBar />)

        await userEvent.setup().click(screen.getByRole('menuitem', { name: 'View' }))

        const fit = within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Fit Diagram to Screen/ })
        expect(fit).toHaveAttribute('aria-disabled', 'true')
    })
})

describe('StudioMenuBar focus after a command', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockContexts({ workspaceRoot: 'C:/work' })
    })

    function renderWithEditor() {
        render(
            <>
                <StudioMenuBar />
                <textarea aria-label="editor" />
            </>
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
