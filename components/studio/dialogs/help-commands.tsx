'use client'

import { useMemo, useState } from 'react'
import { useAppUpdate } from '@/components/studio/app-update-provider'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { AboutDialog } from '@/components/studio/dialogs/about-dialog'
import { OpenSourceLicensesDialog } from '@/components/studio/dialogs/open-source-licenses-dialog'
import { APP_NAME } from '@/lib/app-branding'
import { isTauri } from '@/lib/tauri/platform'

/** The Help menu's commands (About, Licences, Check for Updates), which the palette can run too. Renders their dialogs. */
export function HelpCommands() {
    const [aboutOpen, setAboutOpen] = useState(false)
    const [licensesOpen, setLicensesOpen] = useState(false)
    const { checkForUpdates } = useAppUpdate()
    // Only the desktop app updates itself.
    const desktop = isTauri()

    const commands = useMemo<AppCommand[]>(
        () => [
            { id: 'about', label: `About ${APP_NAME}…`, keywords: 'about version help', run: () => setAboutOpen(true) },
            {
                id: 'licences',
                label: 'Licences…',
                keywords: 'licences licenses open source third party legal help',
                run: () => setLicensesOpen(true),
            },
            ...(desktop
                ? [
                      {
                          id: 'check-for-updates',
                          label: 'Check for Updates…',
                          keywords: 'update upgrade new version release help',
                          // Always on: a check run while another is going joins it and gets its answer.
                          run: checkForUpdates,
                      },
                  ]
                : []),
        ],
        [desktop, checkForUpdates]
    )
    useRegisterCommands(commands)

    return (
        <>
            <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} onOpenLicenses={() => setLicensesOpen(true)} />
            <OpenSourceLicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
        </>
    )
}
