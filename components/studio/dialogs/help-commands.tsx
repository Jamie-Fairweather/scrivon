'use client'

import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useMemo, useState } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { AboutDialog } from '@/components/studio/dialogs/about-dialog'
import { OpenSourceLicensesDialog } from '@/components/studio/dialogs/open-source-licenses-dialog'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { APP_NAME } from '@/lib/app-branding'
import { formatDiagnosticInfo, getSystemInfo, newIssueUrl } from '@/lib/diagnostics/diagnostic-info'
import { notifyError, notifySuccess } from '@/lib/notify'
import type { AppSettings } from '@/lib/settings/types'
import { isTauri } from '@/lib/tauri/platform'

async function diagnosticInfo(settings: AppSettings): Promise<string> {
    return formatDiagnosticInfo({ system: await getSystemInfo(), settings })
}

async function copyDiagnosticInfo(settings: AppSettings): Promise<void> {
    try {
        await navigator.clipboard.writeText(await diagnosticInfo(settings))
        notifySuccess('Diagnostic info copied', { description: 'Paste it into your bug report.' })
    } catch (err) {
        notifyError("Couldn't copy the diagnostic info", err)
    }
}

async function openLogsFolder(): Promise<void> {
    try {
        await invoke('open_logs_folder')
    } catch (err) {
        notifyError("Couldn't open the logs folder", err)
    }
}

/** Opens a new GitHub issue with the diagnostic info filled in. In the app's window, window.open would open a popup of the app. */
async function reportIssue(settings: AppSettings): Promise<void> {
    const url = newIssueUrl(await diagnosticInfo(settings))
    if (!isTauri()) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return
    }
    try {
        await openUrl(url)
    } catch (err) {
        notifyError("Couldn't open the issue page", err)
    }
}

/** The Help menu's commands, which the palette can run too. Renders the About and Licences dialogs. */
export function HelpCommands() {
    const { settings } = useAppSettings()
    const [aboutOpen, setAboutOpen] = useState(false)
    const [licensesOpen, setLicensesOpen] = useState(false)

    const commands = useMemo<AppCommand[]>(
        () => [
            {
                id: 'report-issue',
                label: 'Report an Issue',
                keywords: 'report issue bug problem feedback github help',
                run: () => reportIssue(settings),
            },
            {
                id: 'copy-diagnostic-info',
                label: 'Copy Diagnostic Info',
                keywords: 'copy diagnostic diagnostics system info version bug report help',
                run: () => copyDiagnosticInfo(settings),
            },
            {
                id: 'open-logs-folder',
                label: 'Open Logs Folder',
                keywords: 'open logs log file folder crash diagnostics help',
                disabled: !isTauri(),
                disabledReason: 'Desktop only',
                run: openLogsFolder,
            },
            { id: 'about', label: `About ${APP_NAME}…`, keywords: 'about version help', run: () => setAboutOpen(true) },
            {
                id: 'licences',
                label: 'Licences…',
                keywords: 'licences licenses open source third party legal help',
                run: () => setLicensesOpen(true),
            },
        ],
        [settings]
    )
    useRegisterCommands(commands)

    return (
        <>
            <AboutDialog
                open={aboutOpen}
                onOpenChange={setAboutOpen}
                onOpenLicenses={() => setLicensesOpen(true)}
                onCopyDiagnosticInfo={() => void copyDiagnosticInfo(settings)}
            />
            <OpenSourceLicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
        </>
    )
}
