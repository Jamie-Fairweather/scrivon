'use client'

import { AppUpdateProvider } from '@/components/studio/app-update-provider'
import { DeleteConfirmProvider } from '@/components/studio/dialogs/delete-confirm-provider'
import { NamePromptProvider } from '@/components/studio/dialogs/name-prompt-provider'
import { StudioErrorBoundary, StudioReloadFallback } from '@/components/studio/shell/studio-error-boundary'
import { StudioLayout } from '@/components/studio/shell/studio-layout'
import { StudioMenuBar } from '@/components/studio/shell/studio-menu-bar'
import { StudioRecoveryScreen } from '@/components/studio/shell/studio-recovery-screen'
import { NativeWindowTitle } from '@/components/studio/shell/use-native-window-title'
import { WelcomeScreen } from '@/components/studio/shell/welcome-screen'
import { WorkspaceProvider, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'

function StudioRouter() {
    const { hydrated, workspaceRoot } = useWorkspaceSession()

    if (!hydrated) {
        return <div className="fixed inset-0 bg-background" />
    }

    if (!workspaceRoot) {
        return (
            <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
                <StudioMenuBar />
                <WelcomeScreen />
            </div>
        )
    }

    return (
        <div className="relative flex h-dvh flex-col overflow-hidden bg-background">
            <StudioMenuBar />
            <StudioLayout />
        </div>
    )
}

export function StudioShell() {
    // Outer boundary: a workspace provider crashed, so all that is left to do is reload.
    // Inner boundary: the UI crashed but the workspace (and unsaved text) is alive, so save first.
    // It sits right inside WorkspaceProvider so it also covers the dialogs the providers below
    // render next to their children (name prompt, delete confirm, update notes).
    return (
        <StudioErrorBoundary fallback={StudioReloadFallback}>
            <WorkspaceProvider>
                <StudioErrorBoundary fallback={StudioRecoveryScreen}>
                    <NamePromptProvider>
                        <DeleteConfirmProvider>
                            <AppUpdateProvider>
                                <NativeWindowTitle />
                                <StudioRouter />
                            </AppUpdateProvider>
                        </DeleteConfirmProvider>
                    </NamePromptProvider>
                </StudioErrorBoundary>
            </WorkspaceProvider>
        </StudioErrorBoundary>
    )
}
