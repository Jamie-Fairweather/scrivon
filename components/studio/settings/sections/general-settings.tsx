'use client'

import { isTauri } from '@/lib/tauri/platform'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'

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
