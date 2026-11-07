import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThirdPartyPackage } from '@/lib/legal/third-party-licenses'

// happy-dom has no Web Animations API; the dialog's scroll area asks for it.
if (!Element.prototype.getAnimations) {
    Element.prototype.getAnimations = () => []
}

const { licences } = vi.hoisted(() => ({
    licences: {
        loads: 0,
        fail: false,
        packages: [
            {
                name: '@base-ui/react',
                version: '1.5.0',
                license: 'MIT',
                repository: 'https://github.com/mui/base-ui',
                ecosystem: 'npm',
                licenseText: 'MIT License',
            },
            { name: 'lucide-react', version: '0.500.0', license: 'ISC', repository: null, ecosystem: 'npm', licenseText: 'ISC License' },
            // Its notice mentions "DISCLAIMER", which a search of the licence text would match for 'isc'.
            { name: 'elkjs', version: '0.11.0', license: 'EPL-2.0', repository: null, ecosystem: 'npm', licenseText: 'DISCLAIMER OF WARRANTY' },
            { name: 'tauri', version: '2.11.0', license: 'Apache-2.0 OR MIT', repository: null, ecosystem: 'rust', licenseText: null },
            { name: 'Inter', version: '', license: 'OFL-1.1', repository: null, ecosystem: 'font', licenseText: 'SIL Open Font License' },
        ] satisfies ThirdPartyPackage[],
    },
}))

// Stands in for the generated list, which the dialog loads with a dynamic import. Each load reads the list
// once, so reading it counts loads, and throwing fails the load the way a missing chunk would.
vi.mock('@/lib/legal/third-party-licenses', () => ({
    get THIRD_PARTY_PACKAGES() {
        licences.loads += 1
        if (licences.fail) throw new Error('chunk failed to load')
        return licences.packages
    },
}))

/** A fresh copy of the dialog, so each test starts before the list was ever loaded. */
async function importDialog() {
    vi.resetModules()
    return (await import('./open-source-licenses-dialog')).OpenSourceLicensesDialog
}

beforeEach(() => {
    licences.loads = 0
    licences.fail = false
})

describe('OpenSourceLicensesDialog', () => {
    it('loads the licence list only once the dialog is opened', async () => {
        const OpenSourceLicensesDialog = await importDialog()
        const view = render(<OpenSourceLicensesDialog open={false} onOpenChange={vi.fn()} />)
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(licences.loads).toBe(0)

        view.rerender(<OpenSourceLicensesDialog open onOpenChange={vi.fn()} />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading licences…')
        expect(await screen.findByRole('button', { name: /lucide-react/ })).toBeInTheDocument()
        expect(licences.loads).toBe(1)
    })

    it('keeps the filter outside the scrolling package list', async () => {
        const OpenSourceLicensesDialog = await importDialog()
        render(<OpenSourceLicensesDialog open onOpenChange={vi.fn()} />)

        const row = await screen.findByRole('button', { name: /@base-ui\/react/ })
        const filter = screen.getByRole('searchbox', { name: 'Filter packages' })
        expect(filter.closest('[data-slot=dialog-panel]')).toBeNull()
        expect(row.closest('[data-slot=dialog-panel]')).not.toBeNull()
    })

    it('filters by package name and licence type, not words inside the licence text', async () => {
        const user = userEvent.setup()
        const OpenSourceLicensesDialog = await importDialog()
        render(<OpenSourceLicensesDialog open onOpenChange={vi.fn()} />)
        await screen.findByRole('button', { name: /lucide-react/ })

        await user.type(screen.getByRole('searchbox', { name: 'Filter packages' }), 'isc')

        expect(screen.getByRole('button', { name: /lucide-react/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /elkjs/ })).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /@base-ui\/react/ })).not.toBeInTheDocument()
    })

    it('says whether each entry is an npm package, a Rust crate or a font', async () => {
        const OpenSourceLicensesDialog = await importDialog()
        render(<OpenSourceLicensesDialog open onOpenChange={vi.fn()} />)

        expect(await screen.findByRole('button', { name: /lucide-react/ })).toHaveTextContent('npm package · v0.500.0 · ISC')
        expect(screen.getByRole('button', { name: /tauri/ })).toHaveTextContent('Rust crate · v2.11.0 · Apache-2.0 OR MIT')
        expect(screen.getByRole('button', { name: /Inter/ })).toHaveTextContent('Font · OFL-1.1')
    })

    it("says so when the list can't be loaded, and tries again the next time it opens", async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        licences.fail = true
        const OpenSourceLicensesDialog = await importDialog()
        const onOpenChange = vi.fn()
        const view = render(<OpenSourceLicensesDialog open onOpenChange={onOpenChange} />)

        expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the licence list.")

        fireEvent.click(screen.getByRole('button', { name: 'Close' }))
        expect(onOpenChange).toHaveBeenCalledWith(false)
        view.rerender(<OpenSourceLicensesDialog open={false} onOpenChange={onOpenChange} />)
        licences.fail = false
        view.rerender(<OpenSourceLicensesDialog open onOpenChange={onOpenChange} />)

        expect(screen.getByRole('status')).toHaveTextContent('Loading licences…')
        expect(await screen.findByRole('button', { name: /lucide-react/ })).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(licences.loads).toBe(2)
    })
})
