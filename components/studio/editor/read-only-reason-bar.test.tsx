import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentTabActions, useDocumentTabs } from '@/components/studio/workspace/workspace-provider'
import type { DocumentTab } from '@/lib/workspace/types'
import { ReadOnlyReasonBar } from './read-only-reason-bar'

vi.mock('@/components/studio/workspace/workspace-provider', () => ({ useDocumentTabs: vi.fn(), useDocumentTabActions: vi.fn() }))

const makeTabEditable = vi.fn()

function showTab(activeTab: DocumentTab | null) {
    vi.mocked(useDocumentTabs).mockReturnValue({ activeTab } as ReturnType<typeof useDocumentTabs>)
}

function tab(overrides: Partial<DocumentTab>): DocumentTab {
    return { id: 'C:\\ws\\a.md', path: 'C:\\ws\\a.md', name: 'a.md', content: '', isDirty: false, isSaving: false, ...overrides }
}

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useDocumentTabActions).mockReturnValue({ makeTabEditable } as unknown as ReturnType<typeof useDocumentTabActions>)
})

describe('ReadOnlyReasonBar', () => {
    it('says a file that is not UTF-8 is read-only and lets the user edit it as UTF-8', async () => {
        showTab(tab({ readOnly: true, encodingIssue: 'legacy-encoding' }))
        render(<ReadOnlyReasonBar />)

        expect(screen.getByRole('status')).toHaveTextContent("Read-only. It isn't saved as UTF-8")
        await userEvent.setup().click(screen.getByRole('button', { name: 'Edit as UTF-8' }))
        expect(makeTabEditable).toHaveBeenCalledWith('C:\\ws\\a.md')
    })

    it('says how big a very large file is and lets the user edit it anyway', async () => {
        showTab(tab({ readOnly: true, largeFile: true, disk: { stamp: { size: 6 * 1024 * 1024, mtimeMs: 1 } } }))
        render(<ReadOnlyReasonBar />)

        expect(screen.getByRole('status')).toHaveTextContent("It's 6.0 MB, which is big enough to make editing slow.")
        await userEvent.setup().click(screen.getByRole('button', { name: 'Edit Anyway' }))
        expect(makeTabEditable).toHaveBeenCalledWith('C:\\ws\\a.md')
    })

    it('offers no way to edit a file that looks binary', () => {
        showTab(tab({ readOnly: true, encodingIssue: 'binary' }))
        render(<ReadOnlyReasonBar />)

        expect(screen.getByRole('status')).toHaveTextContent('It looks like a binary file')
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('shows nothing for an editable file, an example, or no file at all', () => {
        showTab(tab({}))
        const { container, rerender } = render(<ReadOnlyReasonBar />)
        expect(container).toBeEmptyDOMElement()

        // Examples are read-only for another reason, which their tab already makes plain.
        showTab(tab({ id: 'example:sample-1', readOnly: true }))
        rerender(<ReadOnlyReasonBar />)
        expect(container).toBeEmptyDOMElement()

        showTab(null)
        rerender(<ReadOnlyReasonBar />)
        expect(container).toBeEmptyDOMElement()
    })
})
