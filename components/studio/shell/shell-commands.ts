'use client'

import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { useWorkspaceSession } from '@/components/studio/workspace/workspace-provider'
import { isMacPlatform } from '@/lib/settings/chord-utils'

export function buildSettingsCommand(openSettings: () => void): AppCommand {
    return {
        id: 'open-settings',
        label: 'Settings…',
        keywords: 'open settings preferences options',
        keybind: 'settings.open',
        run: () => openSettings(),
    }
}

export type ExitCommandContext = {
    isDesktop: boolean
    isMac: boolean
    exitApp: () => void
}

export function buildExitCommand(ctx: ExitCommandContext): AppCommand {
    return {
        id: 'exit',
        label: 'Exit',
        keywords: 'exit quit close window app',
        // The system's own keys: the window handles them, not the app.
        keys: ctx.isMac ? { key: 'q', meta: true } : { key: 'F4', alt: true },
        disabled: !ctx.isDesktop,
        disabledReason: 'Desktop only',
        run: () => ctx.exitApp(),
    }
}

export function useSettingsCommand(): void {
    const { openSettings } = useAppSettings()
    const commands = useMemo(() => [buildSettingsCommand(openSettings)], [openSettings])
    useRegisterCommands(commands)
}

export function useExitCommand(): void {
    const { isDesktop } = useWorkspaceSession()
    const { flushPendingSettings } = useAppSettings()

    // As the title bar's close button: the window asks about unsaved changes before it goes.
    const exitApp = useCallback(() => {
        // The window may go without a pagehide, so write a settings change that is still waiting first.
        flushPendingSettings()
        void getCurrentWindow().close()
    }, [flushPendingSettings])

    const commands = useMemo(() => [buildExitCommand({ isDesktop, isMac: isMacPlatform(), exitApp })], [isDesktop, exitApp])
    useRegisterCommands(commands)
}
