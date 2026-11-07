import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dismissNotification, notifyWarning } from '@/lib/notify'
import { dismissUpdateToast, showUpdateAvailableToast } from '@/lib/updater/update-toast'
import { ToastProvider } from './toast'

/** The titles of the toasts on screen (Base UI also copies them into a live region for screen readers). */
function toastTitles(): string[] {
    return [...document.querySelectorAll('[data-slot="toast-title"]')].map((title) => title.textContent ?? '')
}

describe('ToastProvider', () => {
    afterEach(() => {
        act(() => {
            dismissNotification('stuck')
            dismissUpdateToast()
        })
    })

    it('gives a notice that never times out a close button that dismisses it', async () => {
        const user = userEvent.setup()
        render(<ToastProvider />)
        act(() => {
            notifyWarning('Settings could not be read', { id: 'stuck', timeout: 0 })
        })
        await waitFor(() => expect(toastTitles()).toEqual(['Settings could not be read']))

        // Base UI hides the button from screen readers (aria-hidden) while the stack is collapsed and it isn't focused.
        await user.click(screen.getByLabelText('Dismiss notification'))

        await waitFor(() => expect(toastTitles()).toEqual([]))
    })

    it('lets a long file path wrap, so it never pushes the buttons out of the toast', async () => {
        render(<ToastProvider />)
        act(() => {
            notifyWarning('Saved example.pdf', {
                id: 'stuck',
                timeout: 0,
                description: 'G:\\My Drive\\Documents\\Diagrams\\example.pdf',
                action: { label: 'Show in folder', onClick: vi.fn() },
            })
        })
        await waitFor(() => expect(toastTitles()).toEqual(['Saved example.pdf']))

        // A flex item is never narrower than its longest word unless it may shrink (min-w-0) and break words.
        const text = document.querySelector('[data-slot="toast-text"]')!
        expect(text.className).toMatch(/\bmin-w-0\b/)
        expect(text.querySelector('.flex-col')!.className).toMatch(/\bmin-w-0\b/)
        for (const slot of ['toast-title', 'toast-description']) {
            expect(document.querySelector(`[data-slot="${slot}"]`)!.className, slot).toMatch(/\bwrap-anywhere\b/)
        }
        expect(screen.getByText('Show in folder')).toBeTruthy()
    })

    it('does not add a second dismiss button to the update toast', async () => {
        render(<ToastProvider />)
        act(() => {
            showUpdateAvailableToast('2.0.0', vi.fn())
        })
        await waitFor(() => expect(toastTitles()).toEqual(['Update available: v2.0.0']))

        expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
        expect(screen.queryByLabelText('Dismiss notification')).toBeNull()
    })
})
