'use client'

import { useLayoutEffect, type MutableRefObject } from 'react'

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

/** Fits the canvas when a fit request id changes (e.g. new file opened). */
export function useCanvasFitOnRequest(
    canvasFitRequestId: number,
    activeTabId: string | null,
    source: string,
    dimensions: { width: number; height: number } | null,
    fitToView: (width: number, height: number) => boolean,
    lastHandledFitRequestRef: MutableRefObject<number>
) {
    useLayoutEffect(() => {
        if (canvasFitRequestId === 0 || canvasFitRequestId === lastHandledFitRequestRef.current) return
        if (!dimensions) return

        const fitRequest = { requestId: canvasFitRequestId, tabId: activeTabId, source }

        const attemptFit = () => {
            if (fitRequest.requestId !== canvasFitRequestId) return false
            if (fitRequest.tabId !== activeTabId || fitRequest.source !== source) return false
            return fitToView(dimensions.width, dimensions.height)
        }

        const markHandledIfFit = (): boolean => {
            if (!attemptFit()) return false
            lastHandledFitRequestRef.current = canvasFitRequestId
            return true
        }

        if (markHandledIfFit()) return

        return runFitWithRetry(markHandledIfFit)
    }, [canvasFitRequestId, activeTabId, source, dimensions, fitToView, lastHandledFitRequestRef])
}

/** Fits the canvas the first time a tab shows a diagram without saved view state. */
export function useCanvasFitOnFirstView(
    dimensions: { width: number; height: number } | null,
    svgForDisplay: string | null,
    activeTabId: string | null,
    hasViewStateForTab: (tabId: string) => boolean,
    fitToView: (width: number, height: number) => boolean
) {
    useLayoutEffect(() => {
        if (!dimensions || !svgForDisplay || !activeTabId) return
        if (hasViewStateForTab(activeTabId)) return

        return runFitWithRetry(() => fitToView(dimensions.width, dimensions.height))
    }, [dimensions, svgForDisplay, activeTabId, fitToView, hasViewStateForTab])
}
