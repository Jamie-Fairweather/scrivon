import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { WelcomeScreen } from './welcome-screen'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useWorkspaceSession: vi.fn() }))

describe('WelcomeScreen recent folders', () => {
    it('names the folder in each remove button and removes the right one', async () => {
        const removeRecent = vi.fn()
        vi.mocked(useWorkspaceSession).mockReturnValue({
            isDesktop: true,
            recentWorkspaces: ['C:\\work\\diagrams', '/home/me/notes'],
            pickAndOpenWorkspace: vi.fn(),
            openWorkspace: vi.fn(),
            removeRecent,
        } as unknown as ReturnType<typeof useWorkspaceSession>)

        render(<WelcomeScreen />)

        expect(screen.getByRole('button', { name: 'Remove diagrams from recent folders' })).toBeInTheDocument()
        await userEvent.setup().click(screen.getByRole('button', { name: 'Remove notes from recent folders' }))

        expect(removeRecent).toHaveBeenCalledWith('/home/me/notes')
    })
})
