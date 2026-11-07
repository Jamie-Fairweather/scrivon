import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_REPO_URL } from '@/lib/app-branding'
import { APP_VERSION } from '@/lib/legal/app-version'
import { notifyError, notifySuccess } from '@/lib/notify'
import { inlineLinkClassName } from '@/lib/ui/link-classes'
import { AboutDialog } from './about-dialog'

vi.mock('@/lib/notify', () => ({ notifySuccess: vi.fn(), notifyError: vi.fn() }))

function renderAbout() {
    return render(<AboutDialog open onOpenChange={vi.fn()} onOpenLicenses={vi.fn()} />)
}

describe('AboutDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('describes both Markdown and diagrams and links to the source code', () => {
        renderAbout()

        expect(screen.getByText(/Mermaid diagrams and Markdown documents/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute('href', APP_REPO_URL)
        expect(screen.getByText(/MIT License/)).toBeInTheDocument()
    })

    it('underlines its links all the time, not only on hover', () => {
        renderAbout()

        for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('class', inlineLinkClassName)
    })

    it('copies the version info for bug reports', async () => {
        const user = userEvent.setup()
        const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
        renderAbout()

        await user.click(screen.getByRole('button', { name: 'Copy version info' }))

        await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Version info copied'))
        expect(writeText.mock.calls[0]?.[0]).toContain(`Scrivon ${APP_VERSION}`)
    })

    it('says so when copying fails', async () => {
        const user = userEvent.setup()
        vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
        renderAbout()

        await user.click(screen.getByRole('button', { name: 'Copy version info' }))

        await waitFor(() => expect(notifyError).toHaveBeenCalledWith("Couldn't copy version info", expect.any(Error)))
    })
})
