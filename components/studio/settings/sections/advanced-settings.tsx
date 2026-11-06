'use client'

import { isTauri } from '@/lib/tauri/platform'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'

export function AdvancedSettings() {
    const { settings, updateSettings } = useAppSettings()
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
                <SwitchSetting
                    label="Check for updates on launch"
                    description="Automatically check for app updates after startup."
                    checked={settings.updates.checkOnLaunch}
                    onChange={(checkOnLaunch) =>
                        updateSettings((current) => ({
                            ...current,
                            updates: { ...current.updates, checkOnLaunch },
                        }))
                    }
                />
            ) : null}
        </div>
    )
}
