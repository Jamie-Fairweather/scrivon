'use client'

import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify'
import { importedProfileName } from '@/lib/settings/pdf-export-profiles'
import type { PdfExportProfile } from '@/lib/settings/pdf-export-types'
import { profileExportText, profileFileName, readProfileExport, type LeftOutImage } from '@/lib/settings/profile-transfer'
import { pickJsonSavePath, readChosenJsonFile } from '@/lib/settings/transfer-files'
import { writeTextFileAtPath } from '@/lib/tauri/dialog'
import { getBaseName } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { Button } from '@/components/ui/button'

function describeLeftOut(leftOut: LeftOutImage[]): string {
    return leftOut.map(({ slot, reason }) => `${slot}: ${reason}`).join(' ')
}

type ProfileFileButtonsProps = {
    /** The profile Export saves. */
    profile: PdfExportProfile
    /** Every profile, to say what name an imported one gets. */
    profiles: readonly PdfExportProfile[]
    /** Adds the imported profile (renamed on a clash, see importPdfExportProfile). */
    onImport: (profile: PdfExportProfile) => void
}

/** Export and Import for one export profile, so a team can share a template. Images go inside the file. */
export function ProfileFileButtons({ profile, profiles, onImport }: ProfileFileButtonsProps) {
    if (!isTauri()) return null

    const exportProfile = async () => {
        try {
            const path = await pickJsonSavePath('Export profile', profileFileName(profile.name))
            if (!path) return
            const { text, leftOut } = await profileExportText(profile)
            await writeTextFileAtPath(path, text)
            if (leftOut.length > 0) notifyWarning('Profile exported without some images', { description: describeLeftOut(leftOut) })
            else notifySuccess('Profile exported', { description: `Saved as ${getBaseName(path)}.` })
        } catch (err) {
            notifyError("Couldn't export the profile", err)
        }
    }

    const importProfile = async () => {
        try {
            const text = await readChosenJsonFile('Import profile')
            if (text === null) return
            const { profile: imported, leftOut } = await readProfileExport(text)
            const added = `Added as "${importedProfileName(profiles, imported.name)}".`
            onImport(imported)
            if (leftOut.length > 0) notifyWarning('Profile imported without some images', { description: `${added} ${describeLeftOut(leftOut)}` })
            else notifySuccess('Profile imported', { description: added })
        } catch (err) {
            notifyError("Couldn't import the profile", err)
        }
    }

    return (
        <>
            <Button type="button" variant="outline" size="sm" title="Save this profile to a file, to share it" onClick={() => void exportProfile()}>
                Export profile…
            </Button>
            <Button type="button" variant="outline" size="sm" title="Add a profile from a file" onClick={() => void importProfile()}>
                Import profile…
            </Button>
        </>
    )
}
