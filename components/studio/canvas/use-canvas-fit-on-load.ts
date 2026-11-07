'use client'

import { useLayoutEffect, useRef } from 'react'

type FitAttempt = () => boolean

function runFitWithRetry(attemptFit: FitAttempt): (() => void) | void {
    if (attemptFit()) return

    let innerId = 0
    const outerId = requestAnimationFrame(() => {
        if (attemptFit()) return
        innerId = requestAnimationFrame(attemptFit)
    })

    return () => {
        cancelAnimationFrame(outerId)
        if (innerId) cancelAnimationFrame(innerId)
    }
}

/**
 * Fits the canvas when a fit request id changes (e.g. new file opened). A request belongs to the
 * view showing when it came in. One that can't fit yet (no diagram, or the canvas has no size)
 * stays open while that view shows, so a later render can still fit it; switching to another view
 * drops it, so it never resets that view's zoom. Requests made before the canvas mounted (while a
 * Markdown tab showed, say) are left alone, so coming back to a diagram keeps its zoom; a newly
 * opened one is fitted on first view instead.
 */
export function useCanvasFitOnRequest(
    canvasFitRequestId: number,
    viewKey: string | null,
    dimensions: { width: number; height: number } | null,
    fitToView: (width: number, height: number) => boolean
) {
    const lastHandledFitRequestRef = useRef(canvasFitRequestId)
    const openRequestRef = useRef<{ id: number; viewKey: string | null } | null>(null)

    useLayoutEffect(() => {
        if (canvasFitRequestId === lastHandledFitRequestRef.current) return
        if (openRequestRef.current?.id !== canvasFitRequestId) openRequestRef.current = { id: canvasFitRequestId, viewKey }
        if (openRequestRef.current.viewKey !== viewKey) {
            lastHandledFitRequestRef.current = canvasFitRequestId
            return
        }
        if (!dimensions) return

        return runFitWithRetry(() => {
            if (!fitToView(dimensions.width, dimensions.height)) return false
            lastHandledFitRequestRef.current = canvasFitRequestId
            return true
        })
    }, [canvasFitRequestId, viewKey, dimensions, fitToView])
}

/** Fits the canvas once per tab when a diagram first appears without saved view state. */
export function useCanvasFitOnFirstView(
    dimensions: { width: number; height: number } | null,
    svgForDisplay: string | null,
    activeTabId: string | null,
    hasViewStateForTab: (tabId: string) => boolean,
    fitToView: (width: number, height: number) => boolean
) {
    const fittedTabIdsRef = useRef(new Set<string>())

    useLayoutEffect(() => {
        if (!dimensions || !svgForDisplay || !activeTabId) return
        if (hasViewStateForTab(activeTabId)) return
        if (fittedTabIdsRef.current.has(activeTabId)) return

        return runFitWithRetry(() => {
            if (fitToView(dimensions.width, dimensions.height)) {
                fittedTabIdsRef.current.add(activeTabId)
                return true
            }
            return false
        })
    }, [dimensions, svgForDisplay, activeTabId, fitToView, hasViewStateForTab])
}
