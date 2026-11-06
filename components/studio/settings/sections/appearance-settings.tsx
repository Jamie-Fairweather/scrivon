'use client'

import { CheckIcon } from 'lucide-react'
import { useId } from 'react'
import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS, getDiagramColors, isAppThemeId, type AppThemeId } from '@/lib/theme/catalog'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { RadioGroupPrimitive, RadioPrimitive } from '@/components/ui/radio-group'

function ThemeSwatch({ id }: { id: AppThemeId }) {
    const colors = getDiagramColors(id)
    return (
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.bg }} />
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.accent ?? colors.fg }} />
        </span>
    )
}

function ThemeGroup({ title, ids }: { title: string; ids: AppThemeId[] }) {
    const headingId = useId()

    return (
        <div role="group" aria-labelledby={headingId} className="space-y-2">
            <h3 id={headingId} className="text-sm font-medium text-foreground">
                {title}
            </h3>
            <div className="grid gap-1">
                {ids.map((id) => (
                    <RadioPrimitive.Root
                        key={id}
                        value={id}
                        className="flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors outline-none
                            not-data-checked:hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-accent
                            data-checked:font-medium data-checked:text-accent-foreground"
                    >
                        <ThemeSwatch id={id} />
                        <span>{APP_THEME_LABELS[id]}</span>
                        <RadioPrimitive.Indicator className="ms-auto flex" aria-hidden>
                            <CheckIcon className="size-4" />
                        </RadioPrimitive.Indicator>
                    </RadioPrimitive.Root>
                ))}
            </div>
        </div>
    )
}

export function AppearanceSettings() {
    const { settings, setThemeId } = useAppSettings()

    // One choice across both lists, so screen readers announce which theme is selected.
    return (
        <RadioGroupPrimitive
            aria-label="Theme"
            value={settings.theme.id}
            onValueChange={(value) => {
                if (typeof value === 'string' && isAppThemeId(value)) setThemeId(value)
            }}
            className="space-y-6"
        >
            <ThemeGroup title="Dark themes" ids={APP_DARK_THEME_IDS} />
            <ThemeGroup title="Light themes" ids={APP_LIGHT_THEME_IDS} />
        </RadioGroupPrimitive>
    )
}
