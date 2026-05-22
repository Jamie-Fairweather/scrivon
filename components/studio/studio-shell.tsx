'use client'

import { DeleteConfirmProvider } from '@/components/studio/delete-confirm-provider'
import { NamePromptProvider } from '@/components/studio/name-prompt-provider'
import { StudioLayout } from '@/components/studio/studio-layout'
import { StudioMenuBar } from '@/components/studio/studio-menu-bar'
import { WelcomeScreen } from '@/components/studio/welcome-screen'
import { WorkspaceProvider, useWorkspaceSession } from '@/components/studio/workspace-provider'

function StudioRouter() {
    const { hydrated, workspaceRoot } = useWorkspaceSession()

    if (!hydrated) {
        return <div className="fixed inset-0 bg-background" />
    }

    if (!workspaceRoot) {
        return (
            <div className="fixed inset-0 flex flex-col bg-background">
                <StudioMenuBar />
                <WelcomeScreen />
            </div>
        )
    }

    return (
        <div className="fixed inset-0 flex flex-col bg-background">
            <StudioMenuBar />
            <StudioLayout />
        </div>
    )
}

export function StudioShell() {
    return (
        <WorkspaceProvider>
            <NamePromptProvider>
                <DeleteConfirmProvider>
                    <StudioRouter />
                </DeleteConfirmProvider>
            </NamePromptProvider>
        </WorkspaceProvider>
    )
}
