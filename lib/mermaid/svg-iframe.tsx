'use client'

import { memo, useCallback } from 'react'
import { measureSvgContentBounds, type SvgContentBounds } from '@/lib/mermaid/svg-bounds'

export function svgIframeDocument(svg: string, offsetX = 0, offsetY = 0): string {
    const clip = offsetX !== 0 || offsetY !== 0
    const clipWrapper = clip
        ? `<div style="width:100%;height:100%;overflow:hidden"><div style="transform:translate(${-offsetX}px,${-offsetY}px)">${svg}</div></div>`
        : svg

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
body{display:block;line-height:0}
svg{display:block;max-width:none;overflow:visible;vertical-align:top}
</style></head><body>${clipWrapper}</body></html>`
}

type DiagramIframeProps = {
    svg: string
    width: number
    height: number
    bounds: SvgContentBounds | null
    onBoundsMeasured?: (bounds: SvgContentBounds) => void
}

export const DiagramIframe = memo(function DiagramIframe({ svg, width, height, bounds, onBoundsMeasured }: DiagramIframeProps) {
    const offsetX = bounds?.offsetX ?? 0
    const offsetY = bounds?.offsetY ?? 0
    const displayWidth = bounds?.width ?? width
    const displayHeight = bounds?.height ?? height

    const handleLoad = useCallback(
        (e: React.SyntheticEvent<HTMLIFrameElement>) => {
            if (bounds) return
            const doc = e.currentTarget.contentDocument
            const svgEl = doc?.querySelector('svg')
            if (!svgEl) return
            const measured = measureSvgContentBounds(svgEl)
            if (measured) onBoundsMeasured?.(measured)
        },
        [bounds, onBoundsMeasured]
    )

    return (
        <iframe
            title="Diagram preview"
            className="pointer-events-none overflow-hidden border-0 bg-transparent"
            sandbox=""
            srcDoc={svgIframeDocument(svg, offsetX, offsetY)}
            onLoad={handleLoad}
            style={{
                width: displayWidth,
                height: displayHeight,
                background: 'transparent',
                colorScheme: 'normal',
                overflow: 'hidden',
            }}
        />
    )
})
