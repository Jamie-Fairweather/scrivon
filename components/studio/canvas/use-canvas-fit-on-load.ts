'use client'

import { useLayoutEffect, useRef, type MutableRefObject } from 'react'

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
 * Fits the canvas when a fit request id changes (e.g. new file opened). A request that can't fit
 * yet (no diagram, or the canvas has no size) stays open, so a later render can still fit it.
 */
export function useCanvasFitOnRequest(
    canvasFitRequestId: number,
    dimensions: { width: number; height: number } | null,
    fitToView: (width: number, height: number) => boolean,
    lastHandledFitRequestRef: MutableRefObject<number>
) {
    useLayoutEffect(() => {
        if (canvasFitRequestId === 0 || canvasFitRequestId === lastHandledFitRequestRef.current) return
        if (!dimensions) return

        return runFitWithRetry(() => {
            if (!fitToView(dimensions.width, dimensions.height)) return false
            lastHandledFitRequestRef.current = canvasFitRequestId
            return true
        })
    }, [canvasFitRequestId, dimensions, fitToView, lastHandledFitRequestRef])
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
