import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogErrorBoundary } from './dialog-error-boundary'

const dialog = { broken: true }

function FlakyDialog({ open }: { open: boolean }) {
    if (open && dialog.broken) throw new Error('bad row')
    return open ? <div role="dialog">Dialog</div> : null
}

function Harness({ open, onCrash }: { open: boolean; onCrash: (error: Error) => void }) {
    return (
        <>
            <p>The rest of the page</p>
            <DialogErrorBoundary open={open} onCrash={onCrash}>
                <FlakyDialog open={open} />
            </DialogErrorBoundary>
        </>
    )
}

describe('DialogErrorBoundary', () => {
    beforeEach(() => {
        dialog.broken = true
        // React and the boundary both log the caught error.
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => vi.restoreAllMocks())

    it('reports a dialog that fails as it opens once, and draws nothing in its place', () => {
        const onCrash = vi.fn()
        const view = render(<Harness open={false} onCrash={onCrash} />)

        view.rerender(<Harness open onCrash={onCrash} />)

        expect(onCrash).toHaveBeenCalledTimes(1)
        expect(onCrash.mock.calls[0]![0]).toEqual(new Error('bad row'))
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.getByText('The rest of the page')).toBeInTheDocument()
    })

    it('tries the dialog again after it has been closed and opened again', () => {
        const onCrash = vi.fn()
        const view = render(<Harness open={false} onCrash={onCrash} />)
        view.rerender(<Harness open onCrash={onCrash} />)

        // What onCrash does: close the dialog. Whatever broke it is fixed by the time it opens again.
        view.rerender(<Harness open={false} onCrash={onCrash} />)
        dialog.broken = false
        view.rerender(<Harness open onCrash={onCrash} />)

        expect(screen.getByRole('dialog')).toBeInTheDocument()
        expect(onCrash).toHaveBeenCalledTimes(1)
    })

    it('stays empty while the dialog stays open after a crash', () => {
        const onCrash = vi.fn()
        const view = render(<Harness open onCrash={onCrash} />)
        dialog.broken = false

        view.rerender(<Harness open onCrash={onCrash} />)

        expect(screen.queryByRole('dialog')).toBeNull()
        expect(onCrash).toHaveBeenCalledTimes(1)
    })

    it('reports each new crash', () => {
        const onCrash = vi.fn()
        const view = render(<Harness open={false} onCrash={onCrash} />)
        view.rerender(<Harness open onCrash={onCrash} />)
        view.rerender(<Harness open={false} onCrash={onCrash} />)
        view.rerender(<Harness open onCrash={onCrash} />)

        expect(onCrash).toHaveBeenCalledTimes(2)
    })
})
