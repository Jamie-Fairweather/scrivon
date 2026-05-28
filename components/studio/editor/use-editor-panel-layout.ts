'use client'

import { useCallback, useState } from 'react'
import { STORAGE_KEY_WIDTH } from '@/lib/workspace/types'

const DEFAULT_WIDTH = 400

function readStoredEditorWidth(): number {
    if (typeof window === 'undefined') return DEFAULT_WIDTH
    const storedWidth = localStorage.getItem(STORAGE_KEY_WIDTH)
    if (!storedWidth) return DEFAULT_WIDTH
    const parsed = Number.parseInt(storedWidth, 10)
    return Number.isNaN(parsed) ? DEFAULT_WIDTH : parsed
}

export function useEditorPanelLayout() {
    const [width, setWidth] = useState(readStoredEditorWidth)
    const hydrated = typeof window !== 'undefined'

    const onWidthChange = useCallback((next: number) => {
        setWidth(next)
        localStorage.setItem(STORAGE_KEY_WIDTH, String(next))
    }, [])

    return { width, hydrated, onWidthChange }
}
