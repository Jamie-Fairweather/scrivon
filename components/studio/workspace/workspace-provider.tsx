'use client'

import { useMemo, type ReactNode } from 'react'
import { CanvasFitProvider } from '@/components/studio/workspace/canvas-fit-context'
import { DocumentSaveProvider } from '@/components/studio/workspace/document-save-context'
import { DocumentTabsProvider, useDocumentTabsState } from '@/components/studio/workspace/document-tabs-context'
import { StudioLayoutProvider } from '@/components/studio/workspace/studio-layout-context'
import { WorkspaceSessionProvider, useWorkspaceSession } from '@/components/studio/workspace/workspace-session-context'
import { createWorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

export { useCanvasFit } from '@/components/studio/workspace/canvas-fit-context'
export { useDocumentSave } from '@/components/studio/workspace/document-save-context'
export { useDocumentTabs } from '@/components/studio/workspace/document-tabs-context'
export { useStudioLayout } from '@/components/studio/workspace/studio-layout-context'
export { useWorkspaceSession } from '@/components/studio/workspace/workspace-session-context'

export function WorkspaceProvider({ children }: { children: ReactNode }) {
    const coordinator = useMemo(() => createWorkspaceCoordinatorRefs(), [])
    const tabsState = useDocumentTabsState()

    return (
        <WorkspaceSessionProvider coordinator={coordinator}>
            <WorkspaceInner coordinator={coordinator} tabsState={tabsState}>
                {children}
            </WorkspaceInner>
        </WorkspaceSessionProvider>
    )
}

function WorkspaceInner({
    children,
    coordinator,
    tabsState,
}: {
    children: ReactNode
    coordinator: ReturnType<typeof createWorkspaceCoordinatorRefs>
    tabsState: ReturnType<typeof useDocumentTabsState>
}) {
    const { workspaceRoot } = useWorkspaceSession()

    return (
        <DocumentTabsProvider coordinator={coordinator} workspaceRoot={workspaceRoot} tabsState={tabsState}>
            <DocumentSaveProvider coordinator={coordinator} tabsRef={tabsState.tabsRef} setTabs={tabsState.setTabs}>
                <StudioLayoutProvider>
                    <CanvasFitProvider coordinator={coordinator}>{children}</CanvasFitProvider>
                </StudioLayoutProvider>
            </DocumentSaveProvider>
        </DocumentTabsProvider>
    )
}
