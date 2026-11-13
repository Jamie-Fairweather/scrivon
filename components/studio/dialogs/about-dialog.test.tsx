import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_REPO_URL } from '@/lib/app-branding'
import { inlineLinkClassName } from '@/lib/ui/link-classes'
import { AboutDialog } from './about-dialog'

const onCopyDiagnosticInfo = vi.fn()

function renderAbout() {
    return render(<AboutDialog open onOpenChange={vi.fn()} onOpenLicenses={vi.fn()} onCopyDiagnosticInfo={onCopyDiagnosticInfo} />)
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

    it('copies the diagnostic info for bug reports, as the Help menu does', async () => {
        const user = userEvent.setup()
        renderAbout()

        await user.click(screen.getByRole('button', { name: 'Copy diagnostic info' }))

        expect(onCopyDiagnosticInfo).toHaveBeenCalledOnce()
    })

    it('closes and opens the licences from its Licences button', async () => {
        const user = userEvent.setup()
        const onOpenChange = vi.fn()
        const onOpenLicenses = vi.fn()
        render(<AboutDialog open onOpenChange={onOpenChange} onOpenLicenses={onOpenLicenses} onCopyDiagnosticInfo={vi.fn()} />)

        await user.click(screen.getByRole('button', { name: 'Licences' }))

        expect(onOpenChange).toHaveBeenCalledWith(false)
        expect(onOpenLicenses).toHaveBeenCalledOnce()
    })
})
