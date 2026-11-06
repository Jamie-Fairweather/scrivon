'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Batches rapid value updates to at most one React state commit per animation frame.
 *
 * When `resetKey` changes (for example the active tab), the new value is returned straight away instead of
 * waiting a frame, so a different document is never rendered for a frame with the previous one's value.
 */
export function useFrameSyncedValue<T>(value: T, resetKey?: unknown): T {
    const [synced, setSynced] = useState(value)
    const [syncedKey, setSyncedKey] = useState(resetKey)
    const valueRef = useRef(value)
    const rafRef = useRef<number | null>(null)

    const keyChanged = !Object.is(syncedKey, resetKey)
    if (keyChanged) {
        setSyncedKey(resetKey)
        setSynced(value)
    }

    useEffect(() => {
        valueRef.current = value

        if (rafRef.current !== null) return

        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            setSynced(valueRef.current)
        })
    }, [value])

    useEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
        }
    }, [])

    return keyChanged ? value : synced
}
