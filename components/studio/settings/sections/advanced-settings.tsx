'use client'

import { isTauri } from '@/lib/tauri/platform'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

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

            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Restore panel layout</FieldLabel>
                        <FieldDescription>Remember explorer and editor visibility when reopening the app.</FieldDescription>
                    </div>
                    <Switch
                        checked={settings.layout.restorePanelsOnOpen}
                        onCheckedChange={(checked) =>
                            updateSettings((current) => ({
                                ...current,
                                layout: { ...current.layout, restorePanelsOnOpen: checked === true },
                            }))
                        }
                    />
                </div>
            </Field>

            {desktop ? (
                <Field>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <FieldLabel>Check for updates on launch</FieldLabel>
                            <FieldDescription>Automatically check for app updates after startup.</FieldDescription>
                        </div>
                        <Switch
                            checked={settings.updates.checkOnLaunch}
                            onCheckedChange={(checked) =>
                                updateSettings((current) => ({
                                    ...current,
                                    updates: { ...current.updates, checkOnLaunch: checked === true },
                                }))
                            }
                        />
                    </div>
                </Field>
            ) : null}
        </div>
    )
}
