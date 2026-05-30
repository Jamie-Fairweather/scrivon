'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { CommandPaletteProvider } from '@/components/studio/command-palette/command-palette-provider'
import { CanvasFitProvider } from '@/components/studio/workspace/canvas-fit-context'
import { DocumentSaveProvider } from '@/components/studio/workspace/document-save-context'
import { DocumentTabsProvider, useDocumentTabsState } from '@/components/studio/workspace/document-tabs-context'
import { StudioLayoutProvider } from '@/components/studio/workspace/studio-layout-context'
import { WorkspaceSessionProvider, useWorkspaceSession } from '@/components/studio/workspace/workspace-session-context'
import { createWorkspaceCoordinatorRefs, type WorkspaceCoordinatorRefs } from '@/components/studio/workspace/workspace-coordinator'

const CoordinatorContext = createContext<WorkspaceCoordinatorRefs | null>(null)

export function useWorkspaceCoordinator(): WorkspaceCoordinatorRefs {
    const ctx = useContext(CoordinatorContext)
    if (!ctx) throw new Error('useWorkspaceCoordinator must be used within WorkspaceProvider')
    return ctx
}

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
                    <CanvasFitProvider coordinator={coordinator}>
                        <CoordinatorContext.Provider value={coordinator}>
                            <CommandPaletteProvider coordinator={coordinator}>{children}</CommandPaletteProvider>
                        </CoordinatorContext.Provider>
                    </CanvasFitProvider>
                </StudioLayoutProvider>
            </DocumentSaveProvider>
        </DocumentTabsProvider>
    )
}
