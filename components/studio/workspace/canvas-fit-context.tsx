'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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

export function CanvasFitProvider({
    children,
    coordinator,
}: {
    children: ReactNode
    coordinator?: WorkspaceCoordinatorRefs
}) {
    const [canvasFitRequestId, setCanvasFitRequestId] = useState(0)

    const requestCanvasFit = useCallback(() => {
        setCanvasFitRequestId((id) => id + 1)
    }, [])

    useEffect(() => {
        if (coordinator) coordinator.requestCanvasFit.current = requestCanvasFit
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
