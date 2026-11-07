import { describe, expect, it, vi } from 'vitest'

const notifyWarning = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notifyWarning }))

import { notifySavedWithoutPageNumbers } from '@/lib/markdown/pdf-page-number-warning'

describe('notifySavedWithoutPageNumbers', () => {
    it('warns that the PDF was saved, just without numbers, and gives the reason', () => {
        notifySavedWithoutPageNumbers('Could not save numbered PDF: disk full')

        expect(notifyWarning).toHaveBeenCalledWith('Saved without page numbers', { description: 'Could not save numbered PDF: disk full' })
    })
})
