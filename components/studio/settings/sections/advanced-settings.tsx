'use client'

import { isTauri } from '@/lib/tauri/platform'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { SettingsBackup } from '@/components/studio/settings/settings-backup'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
import { useSharedUpdateCheck } from '@/components/studio/shared-update-check'
import { Button } from '@/components/ui/button'

export function AdvancedSettings() {
    const { settings, updateSettings } = useAppSettings()
    const updateCheck = useSharedUpdateCheck()
    const desktop = isTauri()

    return (
        <div className="space-y-6">
            <NumberSetting
                id="max-recent-folders"
                label="Recent folders limit"
                description="Maximum number of recent workspace folders to remember."
                value={settings.workspace.maxRecentFolders}
                min={1}
                max={50}
                step={1}
                onChange={(maxRecentFolders) =>
                    updateSettings((current) => ({
                        ...current,
                        workspace: { ...current.workspace, maxRecentFolders },
                    }))
                }
            />

            {desktop ? (
                <SwitchSetting
                    label="Reopen last folder on startup"
                    description="Open the folder and files you had open when Scrivon last closed."
                    checked={settings.workspace.reopenLastFolder}
                    onChange={(reopenLastFolder) =>
                        updateSettings((current) => ({
                            ...current,
                            workspace: { ...current.workspace, reopenLastFolder },
                        }))
                    }
                />
            ) : null}

            <SwitchSetting
                label="Restore panel layout"
                description="Remember explorer and editor visibility when reopening the app."
                checked={settings.layout.restorePanelsOnOpen}
                onChange={(restorePanelsOnOpen) =>
                    updateSettings((current) => ({
                        ...current,
                        layout: { ...current.layout, restorePanelsOnOpen },
                    }))
                }
            />

            {desktop ? (
                <>
                    <SwitchSetting
                        label="Check for updates automatically"
                        description="Look for a new version shortly after startup, then every few hours."
                        checked={settings.updates.checkOnLaunch}
                        onChange={(checkOnLaunch) =>
                            updateSettings((current) => ({
                                ...current,
                                updates: { ...current.updates, checkOnLaunch },
                            }))
                        }
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={updateCheck.checking}
                        disabled={!updateCheck.check}
                        onClick={() => void updateCheck.check?.()}
                    >
                        Check for updates now
                    </Button>
                </>
            ) : null}

            <SettingsBackup />
        </div>
    )
}
