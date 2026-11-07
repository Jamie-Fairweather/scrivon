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

const SECTIONS = Object.keys(SECTION_LABELS) as SettingsSection[]

export function getSettingsSectionLabel(section: SettingsSection): string {
    return SECTION_LABELS[section]
}

type SettingsNavProps = {
    activeSection: SettingsSection
    onSectionChange: (section: SettingsSection) => void
    /** Id of the element that shows the chosen section. */
    panelId?: string
}

export function SettingsNav({ activeSection, onSectionChange, panelId }: SettingsNavProps) {
    return (
        <nav aria-label="Settings sections" className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border pr-3">
            {SECTIONS.map((section) => (
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
