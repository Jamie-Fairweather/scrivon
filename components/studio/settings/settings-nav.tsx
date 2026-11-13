'use client'

import { cn } from '@/lib/utils'
import type { SettingsSection } from '@/components/studio/settings/settings-provider'

const SECTION_LABELS: Record<SettingsSection, string> = {
    general: 'General',
    appearance: 'Appearance',
    editor: 'Editor',
    'pdf-export': 'Document export',
    keyboard: 'Keyboard',
    advanced: 'Advanced',
}

/** Every section, in the order the nav shows them. */
export const SETTINGS_SECTIONS = Object.keys(SECTION_LABELS) as SettingsSection[]

export function getSettingsSectionLabel(section: SettingsSection): string {
    return SECTION_LABELS[section]
}

/** Whether a saved string is still a section's name. */
export function isSettingsSection(value: string): value is SettingsSection {
    return Object.hasOwn(SECTION_LABELS, value)
}

type SettingsNavProps = {
    /** Null while search results show instead of a section. */
    activeSection: SettingsSection | null
    onSectionChange: (section: SettingsSection) => void
    /** Id of the element that shows the chosen section. */
    panelId?: string
}

export function SettingsNav({ activeSection, onSectionChange, panelId }: SettingsNavProps) {
    return (
        <nav aria-label="Settings sections" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {SETTINGS_SECTIONS.map((section) => (
                <button
                    key={section}
                    type="button"
                    aria-current={activeSection === section ? 'page' : undefined}
                    aria-controls={panelId}
                    onClick={() => onSectionChange(section)}
                    className={cn(
                        'rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                        activeSection === section
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    )}
                >
                    {SECTION_LABELS[section]}
                </button>
            ))}
        </nav>
    )
}
