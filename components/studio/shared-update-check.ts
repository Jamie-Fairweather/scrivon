'use client'

import { useSyncExternalStore } from 'react'

/**
 * The update check, for Settings. Settings is drawn from the root layout, outside the studio and its
 * AppUpdateProvider, so the provider shares its check here. `check` is null while no studio is open.
 */
export type SharedUpdateCheck = {
    check: (() => Promise<void>) | null
    checking: boolean
}

const NO_CHECK: SharedUpdateCheck = { check: null, checking: false }
let shared = NO_CHECK
const listeners = new Set<() => void>()

/** Shares the check (or, with null, takes it away again). */
export function shareUpdateCheck(next: SharedUpdateCheck | null): void {
    shared = next ?? NO_CHECK
    for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function useSharedUpdateCheck(): SharedUpdateCheck {
    return useSyncExternalStore(
        subscribe,
        () => shared,
        () => NO_CHECK
    )
}
