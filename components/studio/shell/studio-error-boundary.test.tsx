import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentSave } from '@/components/studio/workspace/workspace-provider'
import { logError } from '@/lib/diagnostics/app-log'
import { isTauri } from '@/lib/tauri/platform'
import { clearWorkspaceStore } from '@/lib/tauri/store'
import { CopyErrorDetailsButton, StudioErrorBoundary, StudioReloadFallback } from './studio-error-boundary'
import { StudioRecoveryScreen } from './studio-recovery-screen'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useDocumentSave: vi.fn() }))
vi.mock('@/lib/diagnostics/app-log', () => ({ logError: vi.fn(), logWarning: vi.fn() }))
vi.mock('@/components/studio/hooks/use-window-close', () => ({ useWindowCloseHandler: vi.fn() }))
// The real controls need the desktop window, which these tests don't have.
vi.mock('@/components/studio/shell/window-titlebar-controls', () => ({ TITLEBAR_ABOVE_DIALOGS_CLASS: '', WindowTitlebarControls: () => null }))

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
    vi.mocked(clearWorkspaceStore).mockResolvedValue(undefined)
    vi.mocked(isTauri).mockReturnValue(false)
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
        expect(logError).toHaveBeenCalledWith('Scrivon hit an error while rendering', new Error('Render exploded'))

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
        expect(reload).toHaveBeenCalled()
    })
})

describe('Reset recent folders and tabs', () => {
    function renderReloadFallback() {
        return render(
            <StudioErrorBoundary fallback={StudioReloadFallback}>
                <Boom />
            </StudioErrorBoundary>
        )
    }

    function renderRecovery() {
        return render(
            <StudioErrorBoundary fallback={StudioRecoveryScreen}>
                <Boom />
            </StudioErrorBoundary>
        )
    }

    it('is offered only in the desktop app, where those lists are kept', () => {
        renderReloadFallback()
        expect(screen.queryByRole('button', { name: 'Reset recent folders and tabs' })).not.toBeInTheDocument()
    })

    it('empties the stored lists, then reloads', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        renderReloadFallback()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reset recent folders and tabs' }))

        await waitFor(() => expect(reload).toHaveBeenCalled())
        expect(vi.mocked(clearWorkspaceStore).mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]!)
    })

    it('says why on the screen when the lists could not be emptied, and does not reload', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(clearWorkspaceStore).mockRejectedValue('The process cannot access the file. (os error 32)')
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        renderReloadFallback()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reset recent folders and tabs' }))

        expect(await screen.findByText(/Couldn't reset recent folders and tabs\. The process cannot access the file/)).toBeInTheDocument()
        expect(reload).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Reset recent folders and tabs' })).toBeEnabled()
    })

    it('saves the open files first when the workspace is still running, then empties the lists and reloads', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        renderRecovery()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reset recent folders and tabs' }))

        await waitFor(() => expect(reload).toHaveBeenCalled())
        const saved = flushAllSaves.mock.invocationCallOrder[0]!
        const cleared = vi.mocked(clearWorkspaceStore).mock.invocationCallOrder[0]!
        expect(saved).toBeLessThan(cleared)
        expect(cleared).toBeLessThan(reload.mock.invocationCallOrder[0]!)
    })

    it('keeps the lists when the open files could not be saved', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        flushAllSaves.mockResolvedValue(false)
        renderRecovery()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reset recent folders and tabs' }))

        expect(await screen.findByText(/couldn't be saved/)).toBeInTheDocument()
        expect(clearWorkspaceStore).not.toHaveBeenCalled()
        expect(reload).not.toHaveBeenCalled()
    })

    it('shows on the recovery screen too when the lists could not be emptied', async () => {
        vi.mocked(isTauri).mockReturnValue(true)
        vi.mocked(clearWorkspaceStore).mockRejectedValue(new Error('Disk full.'))
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        renderRecovery()

        await userEvent.setup().click(screen.getByRole('button', { name: 'Reset recent folders and tabs' }))

        expect(await screen.findByText("Couldn't reset recent folders and tabs. Disk full.")).toBeInTheDocument()
        expect(reload).not.toHaveBeenCalled()
    })
})

describe('CopyErrorDetailsButton', () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

    function setClipboard(clipboard: Partial<Clipboard> | undefined) {
        Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true })
    }

    afterEach(() => {
        vi.useRealTimers()
        if (original) Object.defineProperty(navigator, 'clipboard', original)
        else Reflect.deleteProperty(navigator, 'clipboard')
    })

    it('says it copied, then goes back to its label', async () => {
        vi.useFakeTimers()
        const writeText = vi.fn(async () => undefined)
        setClipboard({ writeText })
        render(<CopyErrorDetailsButton details="Scrivon 1.4.2" />)

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }))
        })

        expect(writeText).toHaveBeenCalledWith('Scrivon 1.4.2')
        expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
        act(() => vi.advanceTimersByTime(2000))
        expect(screen.getByRole('button', { name: 'Copy error details' })).toBeInTheDocument()
    })

    it("says it couldn't copy when the write fails", async () => {
        setClipboard({ writeText: vi.fn(async () => Promise.reject(new Error('Not allowed'))) })
        render(<CopyErrorDetailsButton details="details" />)

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }))
        })

        expect(screen.getByRole('button', { name: "Couldn't copy" })).toBeInTheDocument()
    })

    it("says it couldn't copy when there is no clipboard to write to", async () => {
        setClipboard(undefined)
        render(<CopyErrorDetailsButton details="details" />)

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Copy error details' }))
        })

        expect(screen.getByRole('button', { name: "Couldn't copy" })).toBeInTheDocument()
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
