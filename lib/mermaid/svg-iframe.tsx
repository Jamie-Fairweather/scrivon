'use client'

import { memo } from 'react'

export function svgIframeDocument(svg: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
body{display:block;line-height:0}
svg{display:block;max-width:none;overflow:visible;vertical-align:top}
</style></head><body>${svg}</body></html>`
}

export const DiagramIframe = memo(function DiagramIframe({
    svg,
    width,
    height,
}: {
    svg: string
    width: number
    height: number
}) {
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
