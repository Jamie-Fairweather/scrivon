'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { AppSettings } from '@/lib/settings/types'

/** The parts of the settings these switches read. */
type SwitchedSettings = Pick<AppSettings, 'statusBar' | 'spellcheck' | 'editor'>

type SettingSwitch = {
    id: string
    label: string
    keywords: string
    isOn: (settings: SwitchedSettings) => boolean
    /** The settings with this one set to `on`. */
    set: (settings: AppSettings, on: boolean) => AppSettings
}

const SWITCHES: SettingSwitch[] = [
    {
        id: 'toggle-status-bar',
        label: 'Status Bar',
        keywords: 'line column word count save state bottom',
        isOn: (s) => s.statusBar.visible,
        set: (s, visible) => ({ ...s, statusBar: { ...s.statusBar, visible } }),
    },
    {
        id: 'toggle-spellcheck',
        label: 'Spell Check',
        keywords: 'spelling spellcheck mistakes dictionary underline',
        isOn: (s) => s.spellcheck.enabled,
        set: (s, enabled) => ({ ...s, spellcheck: { ...s.spellcheck, enabled } }),
    },
    {
        id: 'toggle-scroll-sync',
        label: 'Scroll Editor with Preview',
        keywords: 'scroll sync together markdown',
        isOn: (s) => s.editor.scrollSync,
        set: (s, scrollSync) => ({ ...s, editor: { ...s.editor, scrollSync } }),
    },
    {
        id: 'toggle-jump-from-preview',
        label: 'Jump to Editor on Double-Click',
        keywords: 'double click preview jump source line cursor markdown',
        isOn: (s) => s.editor.jumpFromPreview,
        set: (s, jumpFromPreview) => ({ ...s, editor: { ...s.editor, jumpFromPreview } }),
    },
]

/** On/off settings that are handy to flip without opening Settings. */
export function buildSettingSwitchCommands(
    settings: SwitchedSettings,
    updateSettings: (change: (current: AppSettings) => AppSettings) => void
): AppCommand[] {
    return SWITCHES.map(({ id, label, keywords, isOn, set }) => ({
        id,
        label,
        keywords,
        checked: isOn(settings),
        // Flips the saved value, so a second quick press always undoes the first.
        run: () => updateSettings((current) => set(current, !isOn(current))),
    }))
}

export function useSettingSwitchCommands(): void {
    const { settings, updateSettings } = useAppSettings()
    const { statusBar, spellcheck, editor } = settings
    // Only the parts the switches read, so changing another setting doesn't rebuild them.
    const commands = useMemo(
        () => buildSettingSwitchCommands({ statusBar, spellcheck, editor }, updateSettings),
        [statusBar, spellcheck, editor, updateSettings]
    )
    useRegisterCommands(commands)
}
