'use client'

import { useMemo } from 'react'
import type { AppCommand } from '@/components/studio/commands/app-command'
import { useRegisterCommands } from '@/components/studio/commands/command-registry'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import type { AppSettings } from '@/lib/settings/types'

/** The parts of the settings these switches read. Only focus mode of the layout: dragging the editor's edge changes the rest. */
type SwitchedSettings = Pick<AppSettings, 'statusBar' | 'spellcheck' | 'editor'> & { layout: Pick<AppSettings['layout'], 'focusMode'> }

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
        // Focus mode hides it, so there it reads as off, and switching it on leaves focus mode to show it.
        isOn: (s) => s.statusBar.visible && !s.layout.focusMode,
        set: (s, visible) => ({
            ...s,
            statusBar: { ...s.statusBar, visible },
            layout: visible ? { ...s.layout, focusMode: false } : s.layout,
        }),
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
        keywords: 'double click preview jump source line cursor markdown diagram mermaid canvas node link state participant message',
        isOn: (s) => s.editor.jumpFromPreview,
        set: (s, jumpFromPreview) => ({ ...s, editor: { ...s.editor, jumpFromPreview } }),
    },
    {
        id: 'toggle-check-links',
        label: 'Check Links',
        keywords: 'broken links images anchors headings paths missing underline markdown',
        isOn: (s) => s.editor.checkLinks,
        set: (s, checkLinks) => ({ ...s, editor: { ...s.editor, checkLinks } }),
    },
    {
        id: 'toggle-dim-other-paragraphs',
        label: 'Dim Other Paragraphs',
        keywords: 'focus fade paragraph current writing highlight',
        isOn: (s) => s.editor.dimOtherParagraphs,
        set: (s, dimOtherParagraphs) => ({ ...s, editor: { ...s.editor, dimOtherParagraphs } }),
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
    const focusMode = settings.layout.focusMode
    // Only the parts the switches read, so changing another setting doesn't rebuild them.
    const commands = useMemo(
        () => buildSettingSwitchCommands({ statusBar, spellcheck, editor, layout: { focusMode } }, updateSettings),
        [statusBar, spellcheck, editor, focusMode, updateSettings]
    )
    useRegisterCommands(commands)
}
