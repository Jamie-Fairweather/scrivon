'use client'

import { useMemo, useState } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { AboutDialog } from '@/components/studio/dialogs/about-dialog'
import { OpenSourceLicensesDialog } from '@/components/studio/dialogs/open-source-licenses-dialog'
import { APP_NAME } from '@/lib/app-branding'

/** The Help menu's About and Licences, which the palette can open too. Renders their dialogs. */
export function HelpCommands() {
    const [aboutOpen, setAboutOpen] = useState(false)
    const [licensesOpen, setLicensesOpen] = useState(false)

    const commands = useMemo<AppCommand[]>(
        () => [
            { id: 'about', label: `About ${APP_NAME}…`, keywords: 'about version help', run: () => setAboutOpen(true) },
            {
                id: 'licences',
                label: 'Licences…',
                keywords: 'licences licenses open source third party legal help',
                run: () => setLicensesOpen(true),
            },
        ],
        []
    )
    useRegisterCommands(commands)

    return (
        <>
            <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} onOpenLicenses={() => setLicensesOpen(true)} />
            <OpenSourceLicensesDialog open={licensesOpen} onOpenChange={setLicensesOpen} />
        </>
    )
}
