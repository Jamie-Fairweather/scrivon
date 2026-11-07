'use client'

import { useAppTheme } from '@/components/theme/app-theme-provider'
import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS, getDiagramColors, isAppThemeId, type AppThemeId } from '@/lib/theme/catalog'
import { MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger } from '@/components/ui/menu'

function ThemeSwatch({ id }: { id: AppThemeId }) {
    const colors = getDiagramColors(id)
    return (
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.bg }} />
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.accent ?? colors.fg }} />
        </span>
    )
}

function ThemeMenuGroup({ label, ids }: { label: string; ids: AppThemeId[] }) {
    return (
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
    )
}

/** Options > Theme: one list of every theme, grouped Dark / Light, picked as a single choice. */
export function ThemeMenu() {
    const { themeId, setThemeId } = useAppTheme()

    return (
        <MenuSub>
            <MenuSubTrigger>Theme</MenuSubTrigger>
            <MenuSubPopup className="max-h-96 min-w-52 overflow-y-auto">
                <MenuRadioGroup
                    value={themeId}
                    onValueChange={(value: unknown) => {
                        if (typeof value === 'string' && isAppThemeId(value)) setThemeId(value)
                    }}
                >
                    <ThemeMenuGroup label="Dark" ids={APP_DARK_THEME_IDS} />
                    <MenuSeparator />
                    <ThemeMenuGroup label="Light" ids={APP_LIGHT_THEME_IDS} />
                </MenuRadioGroup>
            </MenuSubPopup>
        </MenuSub>
    )
}
