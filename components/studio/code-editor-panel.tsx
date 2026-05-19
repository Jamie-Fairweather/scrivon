'use client'

import dynamic from 'next/dynamic'
import { useCallback, useRef } from 'react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { Button } from '@/components/ui/button'
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

const MIN_WIDTH = 280
const MAX_WIDTH_RATIO = 0.6

type CodeEditorPanelProps = {
    source: string
    onSourceChange: (value: string) => void
    width: number
    onWidthChange: (width: number) => void
    collapsed: boolean
    onCollapsedChange: (collapsed: boolean) => void
}

function clampWidth(width: number) {
    const maxWidth = typeof window !== 'undefined' ? window.innerWidth * MAX_WIDTH_RATIO : 800
    return Math.min(maxWidth, Math.max(MIN_WIDTH, width))
}

export function CodeEditorPanel({ source, onSourceChange, width, onWidthChange, collapsed, onCollapsedChange }: CodeEditorPanelProps) {
    const resizeStart = useRef({ x: 0, width: 0 })

    const onResizePointerDown = useCallback(
        (e: React.PointerEvent) => {
            e.preventDefault()
            resizeStart.current = { x: e.clientX, width }
            e.currentTarget.setPointerCapture(e.pointerId)

            const onMove = (moveEvent: PointerEvent) => {
                const delta = moveEvent.clientX - resizeStart.current.x
                onWidthChange(clampWidth(resizeStart.current.width + delta))
            }

            const onUp = () => {
                window.removeEventListener('pointermove', onMove)
                window.removeEventListener('pointerup', onUp)
            }

            window.addEventListener('pointermove', onMove)
            window.addEventListener('pointerup', onUp)
        },
        [width, onWidthChange]
    )

    if (collapsed) {
        return (
            <Button
                variant="outline"
                size="icon"
                className="fixed top-3 left-3 z-20 shadow-md"
                onClick={() => onCollapsedChange(false)}
                aria-label="Expand editor"
            >
                <PanelLeft className="size-4" />
            </Button>
        )
    }

    return (
        <>
            <div className="fixed top-0 left-0 z-10 flex h-full flex-col border-r border-border bg-code shadow-lg" style={{ width }}>
                <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-2">
                    <Button variant="ghost" size="icon-sm" onClick={() => onCollapsedChange(true)} aria-label="Collapse editor">
                        <PanelLeftClose className="size-4" />
                    </Button>
                </div>

                <div className="min-h-0 flex-1">
                    <MonacoEditor
                        height="100%"
                        language="plaintext"
                        theme="vs-dark"
                        value={source}
                        onChange={(value) => onSourceChange(value ?? '')}
                        options={{
                            minimap: { enabled: false },
                            fontFamily: 'var(--font-mono), monospace',
                            wordWrap: 'on',
                            automaticLayout: true,
                            padding: { top: 12 },
                            scrollBeyondLastLine: false,
                            fontSize: 13,
                            lineNumbers: 'on',
                            renderLineHighlight: 'all',
                            tabSize: 2,
                        }}
                    />
                </div>

                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize editor"
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-ring/30 active:bg-ring/50"
                    onPointerDown={onResizePointerDown}
                />
            </div>
        </>
    )
}
