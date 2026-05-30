'use client'

import { cn } from '@/lib/utils'
import type { SettingsSection } from '@/components/studio/settings/settings-provider'

const SECTIONS: { id: SettingsSection; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'editor', label: 'Editor' },
    { id: 'keyboard', label: 'Keyboard' },
    { id: 'advanced', label: 'Advanced' },
]

type SettingsNavProps = {
    activeSection: SettingsSection
    onSectionChange: (section: SettingsSection) => void
}

export function SettingsNav({ activeSection, onSectionChange }: SettingsNavProps) {
    return (
        <nav aria-label="Settings sections" className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-border pr-3">
            {SECTIONS.map((section) => (
                <button
                    key={section.id}
                    type="button"
                    onClick={() => onSectionChange(section.id)}
                    className={cn(
                        'rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                        activeSection === section.id
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    )}
                >
                    {section.label}
                </button>
            ))}
        </nav>
    )
}
