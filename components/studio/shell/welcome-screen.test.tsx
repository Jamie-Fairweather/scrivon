import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { WelcomeScreen } from './welcome-screen'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: vi.fn() }))

function mockSession(overrides: Partial<ReturnType<typeof useWorkspaceSession>> = {}) {
    const session = {
        isDesktop: true,
        recentWorkspaces: [] as string[],
        openingWorkspace: null,
        pickAndOpenWorkspace: vi.fn(),
        openWorkspace: vi.fn(),
        removeRecent: vi.fn(),
        ...overrides,
    }
    vi.mocked(useWorkspaceSession).mockReturnValue(session as unknown as ReturnType<typeof useWorkspaceSession>)
    return session
}

describe('WelcomeScreen', () => {
    it('lists every supported extension in the intro, without markdown backticks', () => {
        mockSession()
        const { container } = render(<WelcomeScreen />)

        expect(container.textContent).not.toContain('`')
        expect(screen.getByText(/Open a folder to browse \.md, \.mmd and \.mermaid files/)).toBeInTheDocument()
    })

    it('is the main landmark', () => {
        mockSession()
        render(<WelcomeScreen />)

        expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { level: 1 }))
    })
})

describe('WelcomeScreen recent folders', () => {
    it('names the folder in each remove button and removes the right one', async () => {
        const session = mockSession({ recentWorkspaces: ['C:\\work\\diagrams', '/home/me/notes'] })

        render(<WelcomeScreen />)

        expect(screen.getByRole('button', { name: 'Remove diagrams from recent folders' })).toBeInTheDocument()
        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove notes from recent folders' }))

        expect(session.removeRecent).toHaveBeenCalledWith('/home/me/notes')
    })

    it('moves focus to the next remove button after a folder is removed', async () => {
        const session = mockSession({ recentWorkspaces: ['C:\\work\\a', 'C:\\work\\b', 'C:\\work\\c'] })
        const { rerender } = render(<WelcomeScreen />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove b from recent folders' }))
        expect(session.removeRecent).toHaveBeenCalledWith('C:\\work\\b')
        mockSession({ ...session, recentWorkspaces: ['C:\\work\\a', 'C:\\work\\c'] })
        rerender(<WelcomeScreen />)

        expect(screen.getByRole('button', { name: 'Remove c from recent folders' })).toHaveFocus()
    })

    it('moves focus to the new last remove button after the last folder is removed', async () => {
        const session = mockSession({ recentWorkspaces: ['C:\\work\\a', 'C:\\work\\b'] })
        const { rerender } = render(<WelcomeScreen />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove b from recent folders' }))
        mockSession({ ...session, recentWorkspaces: ['C:\\work\\a'] })
        rerender(<WelcomeScreen />)

        expect(screen.getByRole('button', { name: 'Remove a from recent folders' })).toHaveFocus()
    })

    it('moves focus to Open Folder after the only folder is removed', async () => {
        const session = mockSession({ recentWorkspaces: ['C:\\work\\a'] })
        const { rerender } = render(<WelcomeScreen />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove a from recent folders' }))
        mockSession({ ...session, recentWorkspaces: [] })
        rerender(<WelcomeScreen />)

        expect(screen.getByRole('button', { name: 'Open Folder' })).toHaveFocus()
    })

    it('leaves focus alone when it has already moved on', async () => {
        const session = mockSession({ recentWorkspaces: ['C:\\work\\a', 'C:\\work\\b'] })
        const { rerender } = render(<WelcomeScreen />)

        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove a from recent folders' }))
        const openB = screen.getByRole('button', { name: /^b/ })
        openB.focus()
        mockSession({ ...session, recentWorkspaces: ['C:\\work\\b'] })
        rerender(<WelcomeScreen />)

        expect(openB).toHaveFocus()
    })

    it('names a drive root by its path instead of leaving the row blank', () => {
        mockSession({ recentWorkspaces: ['D:\\'] })

        render(<WelcomeScreen />)

        // Both lines of the row: the name, then the path.
        expect(screen.getAllByText('D:\\')).toHaveLength(2)
        expect(screen.getByRole('button', { name: 'Remove D:\\ from recent folders' })).toBeInTheDocument()
    })

    it('shows the folder being opened as busy, ignores clicks on it, and leaves the other folders clickable', async () => {
        const session = mockSession({ recentWorkspaces: ['C:\\work\\big', 'C:\\work\\small'], openingWorkspace: 'c:\\work\\big' })
        const user = userEvent.setup()

        render(<WelcomeScreen />)
        const big = screen.getByRole('button', { name: /^big/ })
        const small = screen.getByRole('button', { name: /^small/ })

        expect(big).toHaveAttribute('aria-busy', 'true')
        expect(big).toHaveAttribute('aria-disabled', 'true')
        expect(small).not.toHaveAttribute('aria-busy')
        expect(screen.getByRole('button', { name: 'Open Folder' })).not.toHaveAttribute('aria-busy')

        await user.click(big)
        expect(session.openWorkspace).not.toHaveBeenCalled()
        await user.click(small)
        expect(session.openWorkspace).toHaveBeenCalledWith('C:\\work\\small')
    })

    it('shows the Open Folder button as busy while a folder picked in the dialog opens', () => {
        mockSession({ recentWorkspaces: ['C:\\work\\small'], openingWorkspace: 'C:\\work\\picked' })

        render(<WelcomeScreen />)

        expect(screen.getByRole('button', { name: 'Open Folder' })).toHaveAttribute('aria-busy', 'true')
        expect(screen.getByRole('button', { name: /^small/ })).not.toHaveAttribute('aria-busy')
    })

    it('keeps Hebrew folder names in order in the path, and lets each name take its own direction', () => {
        const LRM = '\u200E'
        mockSession({ recentWorkspaces: ['C:\\Users\\Dana\\מסמכים\\פרויקט'] })

        render(<WelcomeScreen />)

        // A mark after each separator stops the two Hebrew folders from swapping places.
        expect(screen.getByText(`${LRM}C:\\${LRM}Users\\${LRM}Dana\\${LRM}מסמכים\\${LRM}פרויקט${LRM}`)).toBeInTheDocument()
        expect(screen.getByText('פרויקט')).toHaveAttribute('dir', 'auto')
    })
})
