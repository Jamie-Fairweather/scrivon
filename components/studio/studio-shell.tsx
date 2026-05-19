'use client'

import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_DIAGRAM } from '@/lib/default-diagram'
import { MermaidCanvas } from '@/components/studio/mermaid-canvas'
import { CodeEditorPanel } from '@/components/studio/code-editor-panel'

const STORAGE_KEY_WIDTH = 'mermaid-studio-editor-width'
const STORAGE_KEY_COLLAPSED = 'mermaid-studio-editor-collapsed'
const DEFAULT_WIDTH = 400

export function StudioShell() {
    const [source, setSource] = useState(DEFAULT_DIAGRAM)
    const [editorWidth, setEditorWidth] = useState(DEFAULT_WIDTH)
    const [editorCollapsed, setEditorCollapsed] = useState(false)
    const [hydrated, setHydrated] = useState(false)

    useEffect(() => {
        const storedWidth = localStorage.getItem(STORAGE_KEY_WIDTH)
        const storedCollapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED)
        if (storedWidth) {
            const parsed = Number.parseInt(storedWidth, 10)
            if (!Number.isNaN(parsed)) setEditorWidth(parsed)
        }
        if (storedCollapsed === 'true') setEditorCollapsed(true)
        setHydrated(true)
    }, [])

    const onWidthChange = useCallback((width: number) => {
        setEditorWidth(width)
        localStorage.setItem(STORAGE_KEY_WIDTH, String(width))
    }, [])

    const onCollapsedChange = useCallback((collapsed: boolean) => {
        setEditorCollapsed(collapsed)
        localStorage.setItem(STORAGE_KEY_COLLAPSED, String(collapsed))
    }, [])

    if (!hydrated) {
        return <div className="fixed inset-0 bg-background" />
    }

    return (
        <div className="fixed inset-0 overflow-hidden">
            <MermaidCanvas source={source} />
            <CodeEditorPanel
                source={source}
                onSourceChange={setSource}
                width={editorWidth}
                onWidthChange={onWidthChange}
                collapsed={editorCollapsed}
                onCollapsedChange={onCollapsedChange}
            />
        </div>
    )
}
