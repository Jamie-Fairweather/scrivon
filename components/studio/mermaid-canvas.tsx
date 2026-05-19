'use client'

import { memo, useEffect, useMemo, useRef } from 'react'
import { renderMermaidSVG } from 'beautiful-mermaid'
import { Card, CardPanel } from '@/components/ui/card'
import { usePanZoom } from '@/components/studio/use-pan-zoom'

type MermaidCanvasProps = {
    source: string
}

const DiagramSvg = memo(function DiagramSvg({ svg }: { svg: string }) {
    return <div className="pointer-events-none select-none [&_svg]:max-w-none" dangerouslySetInnerHTML={{ __html: svg }} />
})

const DiagramError = memo(function DiagramError({ message }: { message: string }) {
    return (
        <Card className="pointer-events-none max-w-md select-none">
            <CardPanel className="p-4">
                <p className="mb-2 font-medium text-destructive">Diagram error</p>
                <pre className="overflow-auto text-sm whitespace-pre-wrap text-muted-foreground">{message}</pre>
            </CardPanel>
        </Card>
    )
})

export function MermaidCanvas({ source }: MermaidCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const transformRef = useRef<HTMLDivElement>(null)
    const { reset, refreshBaseSize, handlers } = usePanZoom(containerRef, transformRef)

    const { svg, error } = useMemo(() => {
        try {
            return {
                svg: renderMermaidSVG(source, {
                    bg: 'var(--background)',
                    fg: 'var(--foreground)',
                    transparent: true,
                }),
                error: null as string | null,
            }
        } catch (err) {
            return {
                svg: null,
                error: err instanceof Error ? err.message : String(err),
            }
        }
    }, [source])

    useEffect(() => {
        if (!svg) return
        refreshBaseSize()
    }, [svg, refreshBaseSize])

    return (
        <div ref={containerRef} className="fixed inset-0 z-0 cursor-grab touch-none bg-background select-none" onDoubleClick={reset} {...handlers}>
            <div
                className="pointer-events-none absolute inset-0 opacity-30"
                style={{
                    backgroundImage: 'radial-gradient(circle, var(--muted-foreground) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                }}
            />

            <div ref={transformRef} className="absolute inset-0 flex items-center justify-center">
                {error ? <DiagramError message={error} /> : svg ? <DiagramSvg svg={svg} /> : null}
            </div>
        </div>
    )
}
