import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { logError } from '@/lib/diagnostics/app-log'
import { PaneCrashNotice, PaneErrorBoundary } from './pane-error-boundary'

vi.mock('@/lib/diagnostics/app-log', () => ({ logError: vi.fn(), logWarning: vi.fn() }))

const pane = { broken: true }

function FlakyPane() {
    if (pane.broken) throw new Error('bad table')
    return <p>Preview</p>
}

function Harness({ version }: { version: number }) {
    return (
        <PaneErrorBoundary
            resetKeys={[version]}
            fallback={(error) => <PaneCrashNotice title="The preview hit an error" error={error} hint="Edit the document to try again." />}
        >
            <FlakyPane />
        </PaneErrorBoundary>
    )
}

describe('PaneErrorBoundary', () => {
    beforeEach(() => {
        pane.broken = true
        // React and the boundary both log the caught error.
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.mocked(logError).mockReset()
    })

    it('logs a render error and shows a notice in place of the pane', () => {
        render(<Harness version={1} />)

        expect(logError).toHaveBeenCalledWith('A pane hit an error while rendering', new Error('bad table'))
        expect(screen.getByText('The preview hit an error')).toBeInTheDocument()
        expect(screen.getByText('bad table')).toBeInTheDocument()
        expect(screen.getByText('Edit the document to try again.')).toBeInTheDocument()
    })

    it('draws the pane again once a reset key changes', () => {
        const view = render(<Harness version={1} />)

        pane.broken = false
        view.rerender(<Harness version={2} />)

        expect(screen.getByText('Preview')).toBeInTheDocument()
        expect(screen.queryByText('The preview hit an error')).toBeNull()
    })
})
