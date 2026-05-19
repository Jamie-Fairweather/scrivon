'use client'

import { memo, useEffect, useRef, useState } from 'react'
import { renderMermaidSVG, THEMES, type RenderOptions } from 'beautiful-mermaid'
import { Card, CardPanel } from '@/components/ui/card'
import { getSvgDimensions, usePanZoom } from '@/components/studio/use-pan-zoom'
import { cn } from '@/lib/utils'

type MermaidCanvasProps = {
    source: string
    className?: string
}

const RENDER_OPTIONS: RenderOptions = {
    ...THEMES['zinc-dark'],
    transparent: true,
}

function svgIframeDocument(svg: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
body{display:block;line-height:0}
svg{display:block;max-width:none;overflow:hidden;vertical-align:top}
</style></head><body>${svg}</body></html>`
}

function scheduleIdleRender(run: () => void): () => void {
    if (typeof requestIdleCallback !== 'undefined') {
        const id = requestIdleCallback(run, { timeout: 100 })
        return () => cancelIdleCallback(id)
    }
    const id = window.setTimeout(run, 0)
    return () => clearTimeout(id)
}

const DiagramIframe = memo(function DiagramIframe({ svg, width, height }: { svg: string; width: number; height: number }) {
    return (
        <iframe
            title="Diagram preview"
            className="pointer-events-none overflow-hidden border-0 bg-transparent"
            sandbox=""
            srcDoc={svgIframeDocument(svg)}
            style={{ width, height, background: 'transparent', colorScheme: 'normal', overflow: 'hidden' }}
        />
    )
})

const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card className="pointer-events-none max-w-md select-none">
            <CardPanel className="p-4">
                {/* <p className="mb-2 font-medium text-destructive">Diagram error</p> */}
                <pre className="overflow-auto text-sm whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

export function MermaidCanvas({ source, className }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const svgCacheRef = useRef(new Map<string, string>())
    const { reset, handlers } = usePanZoom(containerRef, transformRef)

    const [displaySvg, setDisplaySvg] = useState<string | null>(() => svgCacheRef.current.get(source) ?? null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setError(null)

        const cached = svgCacheRef.current.get(source)
        if (cached) {
            setDisplaySvg(cached)
        }

        let cancelled = false
        const cancelIdle = scheduleIdleRender(() => {
            if (cancelled) return
            try {
                const svg = renderMermaidSVG(source, RENDER_OPTIONS)
                if (cancelled) return
                svgCacheRef.current.set(source, svg)
                setDisplaySvg(svg)
                setError(null)
            } catch (err) {
                if (cancelled) return
                setError(err instanceof Error ? err.message : String(err))
            }
        })

        return () => {
            cancelled = true
            cancelIdle()
        }
    }, [source])

    const dimensions = displaySvg ? getSvgDimensions(displaySvg) : null

    return (
        <div
            ref={containerRef}
            className={cn('relative isolate min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background select-none', className)}
            onDoubleClick={reset}
            {...handlers}
        >
            <div
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                    backgroundImage: 'radial-gradient(circle, var(--muted-foreground) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                }}
            />

            <div ref={transformRef} className="absolute inset-0 flex items-center justify-center">
                {error ? (
                    <DiagramError message={error} />
                ) : displaySvg && dimensions ? (
                    <DiagramIframe svg={displaySvg} width={dimensions.width} height={dimensions.height} />
                ) : null}
            </div>
        </div>
    )
}
