import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentSave } from '@/components/studio/workspace/workspace-provider'
import { StudioErrorBoundary, StudioReloadFallback } from './studio-error-boundary'
import { StudioRecoveryScreen } from './studio-recovery-screen'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useDocumentSave: vi.fn() }))
vi.mock('@/components/studio/hooks/use-window-close', () => ({ useWindowCloseHandler: vi.fn() }))

const flushAllSaves = vi.fn<() => Promise<boolean>>()
const reload = vi.fn()
let shouldThrow = true

function Boom() {
    if (shouldThrow) throw new Error('Render exploded')
    return <p>Recovered view</p>
}

beforeEach(() => {
    vi.clearAllMocks()
    shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(useDocumentSave).mockReturnValue({ flushAllSaves } as unknown as ReturnType<typeof useDocumentSave>)
    flushAllSaves.mockResolvedValue(true)
    vi.stubGlobal('location', { ...window.location, reload })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('StudioErrorBoundary', () => {
    it('renders its children when nothing throws', () => {
        shouldThrow = false
        render(
            <StudioErrorBoundary fallback={StudioReloadFallback}>
                <Boom />
            </StudioErrorBoundary>
        )
        expect(screen.getByText('Recovered view')).toBeInTheDocument()
    })

    it('shows the error with a title bar and a reload button instead of a blank window', async () => {
        render(
            <StudioErrorBoundary fallback={StudioReloadFallback}>
                <Boom />
            </StudioErrorBoundary>
        )

        expect(screen.getByRole('alert')).toHaveTextContent('Render exploded')
        expect(screen.getByRole('banner')).toBeInTheDocument()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
        expect(reload).toHaveBeenCalled()
    })
})

describe('StudioRecoveryScreen', () => {
    function renderRecovery() {
        return render(
            <StudioErrorBoundary fallback={StudioRecoveryScreen}>
                <Boom />
            </StudioErrorBoundary>
        )
    }

    it('saves open files before reloading', async () => {
        renderRecovery()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Save and reload' }))

        await waitFor(() => expect(reload).toHaveBeenCalled())
        expect(flushAllSaves).toHaveBeenCalled()
        expect(flushAllSaves.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]!)
    })

    it('does not reload when saving fails, and offers to reload without saving', async () => {
        flushAllSaves.mockResolvedValue(false)
        renderRecovery()
        const user = userEvent.setup()

        await user.click(screen.getByRole('button', { name: 'Save and reload' }))

        expect(await screen.findByText(/couldn't be saved/)).toBeInTheDocument()
        expect(reload).not.toHaveBeenCalled()

        await user.click(screen.getByRole('button', { name: 'Reload without saving' }))
        expect(reload).toHaveBeenCalled()
    })

    it('renders the view again on "Try again"', async () => {
        renderRecovery()

        shouldThrow = false
        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))

        expect(screen.getByText('Recovered view')).toBeInTheDocument()
    })
})
