'use client'

import { notifyError, notifySuccess } from '@/lib/notify'
import { readSettingsExport, settingsExportText } from '@/lib/settings/settings-transfer'
import { pickJsonSavePath, readChosenJsonFile } from '@/lib/settings/transfer-files'
import { writeTextFileAtPath } from '@/lib/tauri/dialog'
import { getBaseName } from '@/lib/tauri/fs'
import { isTauri } from '@/lib/tauri/platform'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'

/** Export settings and Import settings: all settings and export profiles, to and from a file. */
export function SettingsBackup() {
    const { settings, updateSettings } = useAppSettings()
    if (!isTauri()) return null

    const exportSettings = async () => {
        try {
            const path = await pickJsonSavePath('Export settings', 'Scrivon settings.json')
            if (!path) return
            await writeTextFileAtPath(path, settingsExportText(settings))
            notifySuccess('Settings exported', { description: `Saved as ${getBaseName(path)}.` })
        } catch (err) {
            notifyError("Couldn't export settings", err)
        }
    }

    const importSettings = async () => {
        try {
            const text = await readChosenJsonFile('Import settings')
            if (text === null) return
            const imported = readSettingsExport(text)
            updateSettings(() => imported)
            notifySuccess('Settings imported')
        } catch (err) {
            notifyError("Couldn't import settings", err)
        }
    }

    return (
        <Field>
            <FieldLabel>Settings file</FieldLabel>
            <FieldDescription>Save all settings and export profiles to a file, to keep a backup or move them to another computer.</FieldDescription>
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void exportSettings()}>
                    Export settings…
                </Button>
                <AlertDialog>
                    <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>Import settings…</AlertDialogTrigger>
                    <AlertDialogPopup>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Import settings?</AlertDialogTitle>
                            <AlertDialogDescription>
                                All your settings and export profiles are replaced by the ones in the file. To keep a copy of them, export your
                                settings first.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogClose render={<Button type="button" variant="outline" />}>Cancel</AlertDialogClose>
                            <AlertDialogClose render={<Button type="button" />} onClick={() => void importSettings()}>
                                Choose file…
                            </AlertDialogClose>
                        </AlertDialogFooter>
                    </AlertDialogPopup>
                </AlertDialog>
            </div>
        </Field>
    )
}
