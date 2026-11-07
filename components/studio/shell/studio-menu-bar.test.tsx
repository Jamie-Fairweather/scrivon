import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasControls } from '@/components/studio/canvas/canvas-controls-provider'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useCanvasFit, useDocumentSave, useStudioLayout, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { createDefaultKeybinds } from '@/lib/settings/defaults'
import type { KeybindBindings } from '@/lib/settings/types'
import { StudioMenuBar } from './studio-menu-bar'

vi.mock('next/image', () => ({
    default: (props: { alt: string }) => <span data-alt={props.alt} />,
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useCanvasFit: vi.fn(),
    useDocumentSave: vi.fn(),
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

        expect(await item('diagrams')).toHaveAttribute('aria-current', 'true')
        expect(await item('notes')).not.toHaveAttribute('aria-current')
        expect(await item('big')).toHaveAttribute('aria-disabled', 'true')
        expect(await item('big')).toHaveAttribute('aria-busy', 'true')
        expect(await item('notes')).not.toHaveAttribute('aria-disabled', 'true')
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
