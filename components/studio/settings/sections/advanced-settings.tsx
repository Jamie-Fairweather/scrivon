'use client'

import { isTauri } from '@/lib/tauri/platform'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from '@/components/ui/number-field'
import { Switch } from '@/components/ui/switch'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

export function AdvancedSettings() {
    const { settings, updateSettings } = useAppSettings()
    const desktop = isTauri()

    return (
        <div className="space-y-6">
            <Field>
                <FieldLabel htmlFor="max-recent-folders">Recent folders limit</FieldLabel>
                <FieldDescription>Maximum number of recent workspace folders to remember.</FieldDescription>
                <NumberField
                    id="max-recent-folders"
                    value={settings.workspace.maxRecentFolders}
                    min={1}
                    max={50}
                    step={1}
                    onValueChange={(value) => {
                        if (value != null) {
                            updateSettings((current) => ({
                                ...current,
                                workspace: { ...current.workspace, maxRecentFolders: value },
                            }))
                        }
                    }}
                >
                    <NumberFieldGroup>
                        <NumberFieldDecrement />
                        <NumberFieldInput />
                        <NumberFieldIncrement />
                    </NumberFieldGroup>
                </NumberField>
            </Field>

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
