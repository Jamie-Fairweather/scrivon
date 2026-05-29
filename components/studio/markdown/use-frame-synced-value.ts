'use client'

import { useEffect, useRef, useState } from 'react'

/** Batches rapid value updates to at most one React state commit per animation frame. */
export function useFrameSyncedValue<T>(value: T): T {
    const [synced, setSynced] = useState(value)
    const valueRef = useRef(value)
    const rafRef = useRef<number | null>(null)

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

    return synced
}
