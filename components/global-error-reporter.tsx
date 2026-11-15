'use client'

import { useEffect } from 'react'
import { notifyError } from '@/lib/notify'

const TOAST_ID = 'unexpected-error'
/** The same error again within this long isn't reported again (one thrown on every mouse move, say). */
const REPEAT_QUIET_MS = 5_000

/** Errors that aren't problems: the browser's ResizeObserver notice, and editor work Monaco cancelled on purpose. */
function isHarmless(error: unknown, message: string): boolean {
    if (message.startsWith('ResizeObserver loop')) return true
    return error instanceof Error && error.name === 'Canceled' && error.message === 'Canceled'
}

function keyOf(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/**
 * Catches errors nothing else did (a throw in an event handler, a promise nobody waited for): each is
 * written to the log file and shown in a toast, instead of failing silently.
 */
export function GlobalErrorReporter() {
    useEffect(() => {
        /** When each recent error was last seen, so two errors taking turns are each reported once too. */
        const lastSeen = new Map<string, number>()

        const report = (error: unknown, message: string) => {
            if (isHarmless(error, message)) return
            const key = keyOf(error)
            const now = Date.now()
            for (const [seenKey, at] of lastSeen) if (now - at >= REPEAT_QUIET_MS) lastSeen.delete(seenKey)
            const repeat = lastSeen.has(key)
            lastSeen.set(key, now)
            if (repeat) return
            notifyError('Something went wrong', error, { id: TOAST_ID })
        }

        const onError = (event: ErrorEvent) => report(event.error ?? event.message, event.message ?? '')
        const onRejection = (event: PromiseRejectionEvent) => report(event.reason, '')

        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)
        return () => {
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onRejection)
        }
    }, [])

    return null
}
