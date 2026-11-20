'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { registerCoordinatorRefs } from '@/components/studio/workspace/register-coordinator-refs'
import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

type CanvasFitContextValue = {
    canvasFitRequestId: number
    requestCanvasFit: () => void
}

const CanvasFitContext = createContext<CanvasFitContextValue | null>(null)

export function useCanvasFit(): CanvasFitContextValue {
    const ctx = useContext(CanvasFitContext)
    if (!ctx) throw new Error('useCanvasFit must be used within WorkspaceProvider')
    return ctx
}

export function CanvasFitProvider({ children, coordinator }: { children: ReactNode; coordinator?: WorkspaceCoordinatorRefs }) {
    const [canvasFitRequestId, setCanvasFitRequestId] = useState(0)

    const requestCanvasFit = useCallback(() => {
        setCanvasFitRequestId((id) => id + 1)
    }, [])

    useEffect(() => {
        if (coordinator) registerCoordinatorRefs(coordinator, { requestCanvasFit })
    }, [coordinator, requestCanvasFit])

    const value = useMemo(
        () => ({
            canvasFitRequestId,
            requestCanvasFit,
        }),
        [canvasFitRequestId, requestCanvasFit]
    )

    return <CanvasFitContext.Provider value={value}>{children}</CanvasFitContext.Provider>
}

/**
 * One editor group's share of the fit requests: Fit Diagram from the menu or the palette, and a file just opened,
 * fit the focused group's diagram only, not the other group's.
 */
export function GroupCanvasFitProvider({ focused, children }: { focused: boolean; children: ReactNode }) {
    const app = useContext(CanvasFitContext)
    const appRequestId = app?.canvasFitRequestId ?? 0
    const [seen, setSeen] = useState({ app: appRequestId, own: 0 })
    let own = seen.own
    if (seen.app !== appRequestId) {
        own = focused ? seen.own + 1 : seen.own
        setSeen({ app: appRequestId, own })
    }
    const requestCanvasFit = app?.requestCanvasFit
    const value = useMemo(() => (requestCanvasFit ? { canvasFitRequestId: own, requestCanvasFit } : null), [own, requestCanvasFit])
    if (!value) return children
    return <CanvasFitContext.Provider value={value}>{children}</CanvasFitContext.Provider>
}
