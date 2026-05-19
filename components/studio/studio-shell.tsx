'use client'

import { StudioLayout } from '@/components/studio/studio-layout'
import { WelcomeScreen } from '@/components/studio/welcome-screen'
import { WorkspaceProvider, useWorkspace } from '@/components/studio/workspace-provider'

function StudioRouter() {
    const { hydrated, workspaceRoot } = useWorkspace()

    if (!hydrated) {
        return <div className="fixed inset-0 bg-background" />
    }

    if (!workspaceRoot) {
        return (
            <div className="fixed inset-0 flex flex-col bg-background">
                <WelcomeScreen />
            </div>
        )
    }

    return <StudioLayout />
}

export function StudioShell() {
    return (
        <WorkspaceProvider>
            <StudioRouter />
        </WorkspaceProvider>
    )
}
