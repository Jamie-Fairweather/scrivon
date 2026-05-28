import type { MutableRefObject } from 'react'

import type { WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

/** Assigns ref callbacks without triggering react-hooks/immutability on the coordinator object. */
export function registerCoordinatorRefs(
    refs: WorkspaceCoordinatorRefs,
    handlers: Partial<{ [K in keyof WorkspaceCoordinatorRefs]: WorkspaceCoordinatorRefs[K]['current'] }>
) {
    for (const key of Object.keys(handlers) as (keyof WorkspaceCoordinatorRefs)[]) {
        const handler = handlers[key]
        if (handler !== undefined) {
            ;(refs[key] as MutableRefObject<typeof handler>).current = handler
        }
    }
}
