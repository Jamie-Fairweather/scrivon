'use client'

import type { ReactNode } from 'react'
import { AppUpdateProvider } from '@/components/studio/app-update-provider'
import { CommandPaletteProvider } from '@/components/studio/command-palette/command-palette-provider'
import { CommandRegistryProvider } from '@/components/studio/commands/command-registry'
import { DeleteConfirmProvider } from '@/components/studio/dialogs/delete-confirm-provider'
import { HelpCommands } from '@/components/studio/dialogs/help-commands'
import { MoveToProvider } from '@/components/studio/dialogs/move-to-provider'
import { NamePromptProvider } from '@/components/studio/dialogs/name-prompt-provider'
import { GlobalKeybindsProvider } from '@/components/studio/settings/global-keybinds-provider'
import { StudioCommands } from '@/components/studio/shell/studio-commands'
import { StudioErrorBoundary, StudioReloadFallback } from '@/components/studio/shell/studio-error-boundary'
import { StudioLayout } from '@/components/studio/shell/studio-layout'
import { StudioMenuBar } from '@/components/studio/shell/studio-menu-bar'
import { StudioRecoveryScreen } from '@/components/studio/shell/studio-recovery-screen'
import { NativeWindowTitle } from '@/components/studio/shell/use-native-window-title'
import { WelcomeScreen } from '@/components/studio/shell/welcome-screen'
import { WindowFileDrop } from '@/components/studio/shell/window-file-drop'
import { WorkspaceProvider, useWorkspaceCoordinator, useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { TooltipProvider } from '@/components/ui/tooltip'

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

/** The command palette and the app's keyboard shortcuts, which open it. */
function StudioPalette({ children }: { children: ReactNode }) {
    const coordinator = useWorkspaceCoordinator()
    return (
        <CommandPaletteProvider coordinator={coordinator}>
            <GlobalKeybindsProvider>{children}</GlobalKeybindsProvider>
        </CommandPaletteProvider>
    )
}

export function StudioShell() {
    // Outer boundary: a workspace provider crashed, so all that is left to do is reload.
    // Inner boundary: the UI crashed but the workspace (and unsaved text) is alive, so save first.
    // It sits right inside WorkspaceProvider so it also covers the dialogs the providers below
    // render next to their children (name prompt, delete confirm, update notes, the palette).
    return (
        <StudioErrorBoundary fallback={StudioReloadFallback}>
            <WorkspaceProvider>
                <StudioErrorBoundary fallback={StudioRecoveryScreen}>
                    {/* Every feature below can add commands; the palette and the menu bar show them. */}
                    <CommandRegistryProvider>
                        <NamePromptProvider>
                            <DeleteConfirmProvider>
                                <MoveToProvider>
                                    <AppUpdateProvider>
                                        {/* Below the providers above, so a command can use their dialogs and updates. */}
                                        <StudioPalette>
                                            {/* First, so these commands lead the palette's list. */}
                                            <StudioCommands />
                                            <HelpCommands />
                                            <NativeWindowTitle />
                                            <WindowFileDrop />
                                            {/* One shared delay: once a toolbar tooltip has shown, the next button's shows straight away. */}
                                            <TooltipProvider delay={400}>
                                                <StudioRouter />
                                            </TooltipProvider>
                                        </StudioPalette>
                                    </AppUpdateProvider>
                                </MoveToProvider>
                            </DeleteConfirmProvider>
                        </NamePromptProvider>
                    </CommandRegistryProvider>
                </StudioErrorBoundary>
            </WorkspaceProvider>
        </StudioErrorBoundary>
    )
}
