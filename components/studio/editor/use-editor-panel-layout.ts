'use client'

import { useCallback, useEffect, useState } from 'react'
import { STORAGE_KEY_WIDTH } from '@/lib/workspace/types'

const DEFAULT_WIDTH = 400

export function useEditorPanelLayout() {
    const [width, setWidth] = useState(DEFAULT_WIDTH)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        const storedWidth = localStorage.getItem(STORAGE_KEY_WIDTH)
        if (storedWidth) {
            const parsed = Number.parseInt(storedWidth, 10)
            if (!Number.isNaN(parsed)) setWidth(parsed)
        }
        setHydrated(true)
    }, [])

    const onWidthChange = useCallback((next: number) => {
        setWidth(next)
        localStorage.setItem(STORAGE_KEY_WIDTH, String(next))
    }, [])

    return { width, hydrated, onWidthChange }
}
