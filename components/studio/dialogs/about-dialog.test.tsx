import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_REPO_URL } from '@/lib/app-branding'
import { inlineLinkClassName } from '@/lib/ui/link-classes'
import { AboutDialog } from './about-dialog'

const onCopyDiagnosticInfo = vi.fn()
const version = vi.hoisted(() => ({ value: '1.5.0' }))
vi.mock('@/lib/legal/app-version', () => ({
    get APP_VERSION() {
        return version.value
    },
}))

function renderAbout() {
    return render(<AboutDialog open onOpenChange={vi.fn()} onOpenLicenses={vi.fn()} onCopyDiagnosticInfo={onCopyDiagnosticInfo} />)
}

describe('AboutDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        version.value = '1.5.0'
    })

    it('describes both Markdown and diagrams and links to the source code', () => {
        renderAbout()

        expect(screen.getByText(/Mermaid diagrams and Markdown documents/)).toBeInTheDocument()
        expect(screen.getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute('href', APP_REPO_URL)
        expect(screen.getByText(/MIT License/)).toBeInTheDocument()
    })

    it('lists every document export format, HTML included', () => {
        renderAbout()

        expect(screen.getByText(/documents as PDF, Word or HTML/)).toBeInTheDocument()
    })

    it('marks a release candidate as a pre-release', () => {
        version.value = '1.6.0-rc.1'
        renderAbout()

        expect(screen.getByText('Version 1.6.0-rc.1')).toBeInTheDocument()
        expect(screen.getByText('Pre-release')).toBeInTheDocument()
    })

    it('has no pre-release mark on a stable version', () => {
        renderAbout()

        expect(screen.getByText('Version 1.5.0')).toBeInTheDocument()
        expect(screen.queryByText('Pre-release')).not.toBeInTheDocument()
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
