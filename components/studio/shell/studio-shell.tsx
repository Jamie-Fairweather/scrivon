'use client'

import { AppUpdater } from '@/components/studio/app-updater'
import { DeleteConfirmProvider } from '@/components/studio/dialogs/delete-confirm-provider'
import { NamePromptProvider } from '@/components/studio/dialogs/name-prompt-provider'
import { StudioLayout } from '@/components/studio/shell/studio-layout'
import { StudioMenuBar } from '@/components/studio/shell/studio-menu-bar'
import { WelcomeScreen } from '@/components/studio/shell/welcome-screen'
import { WorkspaceProvider, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

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
                    <AppUpdater />
                    <StudioRouter />
                </DeleteConfirmProvider>
            </NamePromptProvider>
        </WorkspaceProvider>
    )
}
