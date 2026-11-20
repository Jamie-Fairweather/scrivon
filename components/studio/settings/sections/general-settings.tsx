'use client'

import { isTauri } from '@/lib/tauri/platform'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
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
import { notifyError, notifySuccess } from '@/lib/notify'
import { deleteAllFileHistory } from '@/lib/tauri/file-history'
import { isTauri } from '@/lib/tauri/platform'

/** File history on or off, and Delete All File History (after a confirm). Only the desktop app keeps it. */
function FileHistorySettings() {
    const { settings, setFileHistoryEnabled } = useAppSettings()

    const deleteHistory = async () => {
        try {
            await deleteAllFileHistory()
            notifySuccess('File history deleted')
        } catch (err) {
            notifyError("Couldn't delete the file history", err)
        }
    }

    return (
        <div className="space-y-3">
            <SwitchSetting
                label="File history"
                description="Keep a copy of each version you save, in Scrivon's own data folder, so File → Show File History… can show what changed and put an earlier version back. Up to 50 versions per file, for 30 days."
                checked={settings.fileHistory.enabled}
                onChange={setFileHistoryEnabled}
            />
            <AlertDialog>
                <AlertDialogTrigger render={<Button type="button" variant="outline" size="sm" />}>Delete All File History…</AlertDialogTrigger>
                <AlertDialogPopup>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete all file history?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Every version Scrivon kept of every file is deleted, and can&apos;t be brought back. Your files themselves are left as
                            they are.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogClose render={<Button type="button" variant="outline" />}>Cancel</AlertDialogClose>
                        <AlertDialogClose render={<Button type="button" variant="destructive" />} onClick={() => void deleteHistory()}>
                            Delete All
                        </AlertDialogClose>
                    </AlertDialogFooter>
                </AlertDialogPopup>
            </AlertDialog>
        </div>
    )
}

export function GeneralSettings() {
    const { settings, setAutosaveEnabled, setAutosaveDelayMs, updateSettings } = useAppSettings()

    return (
        <div className="space-y-6">
            <SwitchSetting
                label="Autosave"
                description="Automatically save changes after a short delay."
                checked={settings.autosave.enabled}
                onChange={setAutosaveEnabled}
            />

            <NumberSetting
                id="autosave-delay"
                label="Autosave delay (ms)"
                description="How long to wait after edits before saving (200–5000)."
                value={settings.autosave.delayMs}
                min={200}
                max={5000}
                step={100}
                disabled={!settings.autosave.enabled}
                onChange={setAutosaveDelayMs}
            />

            {isTauri() ? <FileHistorySettings /> : null}
            {isTauri() ? (
                <SwitchSetting
                    label="Show git changes in the explorer"
                    description="In a git repository, mark the files you have changed since the last commit, and the folders they are in."
                    checked={settings.workspace.showGitChanges}
                    onChange={(showGitChanges) =>
                        updateSettings((current) => ({
                            ...current,
                            workspace: { ...current.workspace, showGitChanges },
                        }))
                    }
                />
            ) : null}
        </div>
    )
}
