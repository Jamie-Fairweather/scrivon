'use client'

import { CheckIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS, getDiagramColors, isAppThemeId, type AppThemeId } from '@/lib/theme/catalog'
import { FOLLOW_SYSTEM, type ThemeChoice } from '@/lib/settings/types'
import { useAppSettings } from '@/components/studio/settings/settings-provider'
import { SwitchSetting } from '@/components/studio/settings/switch-setting'
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

function ThemeOptions({ ids }: { ids: AppThemeId[] }) {
    return (
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
    )
}

/** A titled list of themes. Given a choice, the list is a choice of its own; without one, it's part of an outer choice. */
function ThemeGroup({ title, ids, choice }: { title: string; ids: AppThemeId[]; choice?: ThemeRadioGroupProps }) {
    const headingId = useId()
    const content = (
        <>
            <h4 id={headingId} className="text-sm font-medium text-foreground">
                {title}
            </h4>
            <ThemeOptions ids={ids} />
        </>
    )

    if (!choice) {
        return (
            <div role="group" aria-labelledby={headingId} className="space-y-2">
                {content}
            </div>
        )
    }
    return (
        <ThemeRadioGroup aria-labelledby={headingId} className="space-y-2" {...choice}>
            {content}
        </ThemeRadioGroup>
    )
}

type ThemeRadioGroupProps = {
    value: ThemeChoice
    onPick: (id: AppThemeId) => void
}

type ThemeRadioGroupRootProps = ThemeRadioGroupProps & {
    children: ReactNode
    className?: string
    'aria-label'?: string
    'aria-labelledby'?: string
}

/** One choice of theme: a radio group over the theme options inside it. */
function ThemeRadioGroup({ value, onPick, children, ...props }: ThemeRadioGroupRootProps) {
    return (
        <RadioGroupPrimitive
            value={value}
            onValueChange={(next) => {
                if (isAppThemeId(next)) onPick(next)
            }}
            {...props}
        >
            {children}
        </RadioGroupPrimitive>
    )
}

export function AppearanceSettings() {
    const { settings, setThemeId, setFollowSystem, setSystemThemeId } = useAppSettings()
    const theme = settings.theme
    const followSystem = theme.id === FOLLOW_SYSTEM

    return (
        <div className="space-y-6">
            <SwitchSetting
                label="Follow Windows"
                description="Use one theme when Windows is in light mode and another when it's in dark mode."
                checked={followSystem}
                onChange={setFollowSystem}
            />

            {followSystem ? (
                <>
                    <ThemeGroup title="When Windows is dark" ids={APP_DARK_THEME_IDS} choice={{ value: theme.dark, onPick: setSystemThemeId }} />
                    <ThemeGroup title="When Windows is light" ids={APP_LIGHT_THEME_IDS} choice={{ value: theme.light, onPick: setSystemThemeId }} />
                </>
            ) : (
                // One choice across both lists, so screen readers announce which theme is selected.
                <ThemeRadioGroup aria-label="Theme" className="space-y-6" value={theme.id} onPick={setThemeId}>
                    <ThemeGroup title="Dark themes" ids={APP_DARK_THEME_IDS} />
                    <ThemeGroup title="Light themes" ids={APP_LIGHT_THEME_IDS} />
                </ThemeRadioGroup>
            )}
        </div>
    )
}
