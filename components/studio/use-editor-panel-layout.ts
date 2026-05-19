'use client'

import { useCallback, useEffect, useState } from 'react'
import { STORAGE_KEY_COLLAPSED, STORAGE_KEY_WIDTH } from '@/lib/workspace/types'

const DEFAULT_WIDTH = 400

export function useEditorPanelLayout() {
    const [width, setWidth] = useState(DEFAULT_WIDTH)
    const [collapsed, setCollapsed] = useState(false)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        const storedWidth = localStorage.getItem(STORAGE_KEY_WIDTH)
        const storedCollapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED)
        if (storedWidth) {
            const parsed = Number.parseInt(storedWidth, 10)
            if (!Number.isNaN(parsed)) setWidth(parsed)
        }
        if (storedCollapsed === 'true') setCollapsed(true)
        setHydrated(true)
    }, [])

    const onWidthChange = useCallback((next: number) => {
        setWidth(next)
        localStorage.setItem(STORAGE_KEY_WIDTH, String(next))
    }, [])

    const onCollapsedChange = useCallback((next: boolean) => {
        setCollapsed(next)
        localStorage.setItem(STORAGE_KEY_COLLAPSED, String(next))
    }, [])

    return { width, collapsed, hydrated, onWidthChange, onCollapsedChange }
}
