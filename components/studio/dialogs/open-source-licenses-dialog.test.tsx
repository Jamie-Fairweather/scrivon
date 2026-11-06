import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OpenSourceLicensesDialog } from './open-source-licenses-dialog'

// happy-dom has no Web Animations API; the dialog's scroll area asks for it.
if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
}

describe('OpenSourceLicensesDialog', () => {
    it('keeps the filter outside the scrolling package list', () => {
        render(<OpenSourceLicensesDialog open onOpenChange={vi.fn()} />)

        const filter = screen.getByRole('searchbox', { name: 'Filter packages' })
        expect(filter.closest('[data-slot=dialog-panel]')).toBeNull()
        expect(screen.getByRole('button', { name: /@base-ui\/react/ }).closest('[data-slot=dialog-panel]')).not.toBeNull()
    })

    it('filters by package name and licence type, not words inside the licence text', async () => {
        const user = userEvent.setup()
        render(<OpenSourceLicensesDialog open onOpenChange={vi.fn()} />)

        await user.type(screen.getByRole('searchbox', { name: 'Filter packages' }), 'isc')

        // Only two bundled packages are ISC-licensed. Apache and EPL notices merely contain words like "DISCLAIM".
        expect(screen.getByRole('button', { name: /lucide-react/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /@ungap\/structured-clone/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /@swc\/helpers/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /elkjs/ })).not.toBeInTheDocument()
    })
})
