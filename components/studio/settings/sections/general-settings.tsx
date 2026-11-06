'use client'

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { NumberSetting } from '@/components/studio/settings/number-setting'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

export function GeneralSettings() {
    const { settings, setAutosaveEnabled, setAutosaveDelayMs } = useAppSettings()

    return (
        <div className="space-y-6">
            <Field>
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <FieldLabel>Autosave</FieldLabel>
                        <FieldDescription>Automatically save changes after a short delay.</FieldDescription>
                    </div>
                    <Switch checked={settings.autosave.enabled} onCheckedChange={(checked) => setAutosaveEnabled(checked === true)} />
                </div>
            </Field>

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
        </div>
    )
}
