'use client'

import { memo, useCallback, useEffect, useId, useRef, useState } from 'react'
import { getSvgDimensions } from '@/lib/mermaid/svg-dimensions'

export function svgIframeDocument(svg: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
body{display:block;line-height:0}
svg{display:block;max-width:none;overflow:visible;vertical-align:top}
</style></head><body>${svg}</body></html>`
}

/**
 * The frames run with no scripts and an opaque origin, so nothing in a diagram can reach the app.
 * Never add allow-scripts: together with allow-same-origin it removes the sandbox entirely. The
 * opaque origin also means the app can't read a frame's document (contentDocument is null), so
 * nothing here relies on it. The frame's load event, which still fires, is all this uses.
 */
export const DIAGRAM_IFRAME_SANDBOX = ''

type DiagramIframeProps = {
    svg: string
    /** What screen readers announce for the diagram, e.g. "Diagram: flow.mmd". */
    label?: string
    /** A longer description screen readers read after the label, e.g. from the diagram's accDescr. */
    description?: string
}

const DEFAULT_LABEL = 'Mermaid diagram'

/** Longest a new diagram waits for its frame's load event before it is shown anyway. */
export const SWAP_FALLBACK_MS = 500

type Frame = { svg: string; id: number }
type Frames = { shown: Frame; incoming: Frame | null; nextId: number }

/**
 * Isolated iframe preview, which keeps Mermaid's &lt;style&gt; out of the app document. A new diagram
 * loads in a hidden second frame and takes over once it has loaded and painted, so edits never
 * flash a blank frame. Between edits there is only one frame.
 */
export const DiagramIframe = memo(function DiagramIframe({ svg, label = DEFAULT_LABEL, description }: DiagramIframeProps) {
    const [frames, setFrames] = useState<Frames>(() => ({ shown: { svg, id: 0 }, incoming: null, nextId: 1 }))
    const paintRequestRef = useRef(0)
    const descriptionId = useId()

    // Follow the svg prop while rendering: start loading a new diagram, or drop one that was
    // replaced before it loaded (including going back to the diagram already shown).
    let current = frames
    if (svg === frames.shown.svg) {
        if (frames.incoming) current = { ...frames, incoming: null }
    } else if (frames.incoming?.svg !== svg) {
        current = { ...frames, incoming: { svg, id: frames.nextId }, nextId: frames.nextId + 1 }
    }
    if (current !== frames) setFrames(current)

    const show = useCallback((id: number) => {
        setFrames((prev) => (prev.incoming?.id === id ? { ...prev, shown: prev.incoming, incoming: null } : prev))
    }, [])

    // Two animation frames after load, the new frame has painted, so swapping can't show a blank one.
    const onIncomingLoad = useCallback(
        (id: number) => {
            cancelAnimationFrame(paintRequestRef.current)
            paintRequestRef.current = requestAnimationFrame(() => {
                paintRequestRef.current = requestAnimationFrame(() => show(id))
            })
        },
        [show]
    )

    const incomingId = current.incoming?.id
    useEffect(() => {
        if (incomingId === undefined) return
        const timer = setTimeout(() => show(incomingId), SWAP_FALLBACK_MS)
        return () => clearTimeout(timer)
    }, [incomingId, show])

    useEffect(() => () => cancelAnimationFrame(paintRequestRef.current), [])

    const shownDims = getSvgDimensions(current.shown.svg)
    if (!shownDims) return null

    return (
        // One named image for assistive tech. The frames inside are only how it is drawn, so they are
        // hidden from screen readers and kept out of the Tab order, the loading one included.
        <div
            role="img"
            aria-label={label}
            aria-describedby={description ? descriptionId : undefined}
            className="relative overflow-hidden"
            style={{ width: shownDims.width, height: shownDims.height }}
        >
            {description ? (
                <span id={descriptionId} hidden>
                    {description}
                </span>
            ) : null}
            {[current.shown, current.incoming].map((frame) => {
                if (!frame) return null
                const dims = getSvgDimensions(frame.svg)
                if (!dims) return null
                const isShown = frame === current.shown

                return (
                    <iframe
                        key={frame.id}
                        title="Diagram preview"
                        className="pointer-events-none absolute top-0 left-0 overflow-hidden border-0 bg-transparent"
                        sandbox={DIAGRAM_IFRAME_SANDBOX}
                        tabIndex={-1}
                        aria-hidden
                        inert
                        srcDoc={svgIframeDocument(frame.svg)}
                        onLoad={isShown ? undefined : () => onIncomingLoad(frame.id)}
                        style={{
                            width: dims.width,
                            height: dims.height,
                            background: 'transparent',
                            colorScheme: 'normal',
                            overflow: 'hidden',
                            opacity: isShown ? 1 : 0,
                            zIndex: isShown ? 1 : 0,
                        }}
                    />
                )
            })}
        </div>
    )
})
