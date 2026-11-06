import { notifyWarning } from '@/lib/notify'

/** The PDF was saved, but its page numbers couldn't be added; `reason` says why. */
export function notifySavedWithoutPageNumbers(reason: string): void {
    notifyWarning('Saved without page numbers', { description: reason })
}
