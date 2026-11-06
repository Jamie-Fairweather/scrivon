'use client'

import { AppUpdateProvider } from '@/components/studio/app-update-provider'
import { DeleteConfirmProvider } from '@/components/studio/dialogs/delete-confirm-provider'
import { NamePromptProvider } from '@/components/studio/dialogs/name-prompt-provider'
import { StudioErrorBoundary, StudioReloadFallback } from '@/components/studio/shell/studio-error-boundary'
import { StudioLayout } from '@/components/studio/shell/studio-layout'
import { StudioMenuBar } from '@/components/studio/shell/studio-menu-bar'
import { StudioRecoveryScreen } from '@/components/studio/shell/studio-recovery-screen'
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
    // Outer boundary: a provider crashed, so all that is left to do is reload.
    // Inner boundary: the UI crashed but the providers (and unsaved text) are alive, so save first.
    return (
        <StudioErrorBoundary fallback={StudioReloadFallback}>
            <WorkspaceProvider>
                <NamePromptProvider>
                    <DeleteConfirmProvider>
                        <AppUpdateProvider>
                            <StudioErrorBoundary fallback={StudioRecoveryScreen}>
                                <StudioRouter />
                            </StudioErrorBoundary>
                        </AppUpdateProvider>
                    </DeleteConfirmProvider>
                </NamePromptProvider>
            </WorkspaceProvider>
        </StudioErrorBoundary>
    )
}
