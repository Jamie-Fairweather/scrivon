'use client'

import { useAppSettings } from '@/components/studio/settings/settings-provider'
import {
    MenuCheckboxItem,
    MenuGroup,
    MenuGroupLabel,
    MenuRadioGroup,
    MenuRadioItem,
    MenuSeparator,
    MenuSub,
    MenuSubPopup,
    MenuSubTrigger,
} from '@/components/ui/menu'
import { FOLLOW_SYSTEM } from '@/lib/settings/types'
import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS, getDiagramColors, isAppThemeId, type AppThemeId } from '@/lib/theme/catalog'

function ThemeSwatch({ id }: { id: AppThemeId }) {
    const colors = getDiagramColors(id)
    return (
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.bg }} />
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.accent ?? colors.fg }} />
        </span>
    )
}

type ThemeMenuGroupProps = {
    label: string
    ids: AppThemeId[]
    value: string
    onPick: (id: AppThemeId) => void
}

function ThemeMenuGroup({ label, ids, value, onPick }: ThemeMenuGroupProps) {
    return (
        <MenuRadioGroup
            value={value}
            onValueChange={(next: unknown) => {
                if (isAppThemeId(next)) onPick(next)
            }}
        >
            <MenuGroup>
                <MenuGroupLabel>{label}</MenuGroupLabel>
                {ids.map((id) => (
                    <MenuRadioItem key={id} value={id}>
                        <span className="flex min-w-0 items-center gap-2">
                            <ThemeSwatch id={id} />
                            <span className="truncate">{APP_THEME_LABELS[id]}</span>
                        </span>
                    </MenuRadioItem>
                ))}
            </MenuGroup>
        </MenuRadioGroup>
    )
}

/**
 * Options > Theme: every theme, grouped Dark / Light. Picking one uses it all the time. With
 * Follow Windows on, one of each group is checked: the theme for when Windows is dark and the
 * one for when it's light.
 */
export function ThemeMenu() {
    const { settings, setThemeId, setFollowSystem, setSystemThemeId } = useAppSettings()
    const theme = settings.theme
    const followSystem = theme.id === FOLLOW_SYSTEM
    const pick = followSystem ? setSystemThemeId : setThemeId

    return (
        <MenuSub>
            <MenuSubTrigger>Theme</MenuSubTrigger>
            <MenuSubPopup className="max-h-96 min-w-52 overflow-y-auto">
                <MenuCheckboxItem checked={followSystem} onCheckedChange={(checked) => setFollowSystem(checked)}>
                    Follow Windows
                </MenuCheckboxItem>
                <MenuSeparator />
                <ThemeMenuGroup
                    label={followSystem ? 'When Windows is dark' : 'Dark'}
                    ids={APP_DARK_THEME_IDS}
                    value={followSystem ? theme.dark : theme.id}
                    onPick={pick}
                />
                <MenuSeparator />
                <ThemeMenuGroup
                    label={followSystem ? 'When Windows is light' : 'Light'}
                    ids={APP_LIGHT_THEME_IDS}
                    value={followSystem ? theme.light : theme.id}
                    onPick={pick}
                />
            </MenuSubPopup>
        </MenuSub>
    )
}
