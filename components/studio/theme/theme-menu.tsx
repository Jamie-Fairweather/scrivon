'use client'

import { useAppTheme } from '@/components/theme/app-theme-provider'
import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS, getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'
import { MenuCheckboxItem, MenuGroup, MenuSub, MenuSubPopup, MenuSubTrigger } from '@/components/ui/menu'

function ThemeSwatch({ id }: { id: AppThemeId }) {
    const colors = getDiagramColors(id)
    return (
        <span className="flex shrink-0 items-center gap-1" aria-hidden>
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.bg }} />
            <span className="size-3 rounded-full border border-border/60" style={{ backgroundColor: colors.accent ?? colors.fg }} />
        </span>
    )
}

function ThemeMenuItems({ ids }: { ids: AppThemeId[] }) {
    const { themeId, setThemeId } = useAppTheme()

    return (
        <>
            {ids.map((id) => (
                <MenuCheckboxItem key={id} checked={themeId === id} onCheckedChange={() => setThemeId(id)} className="gap-2">
                    <ThemeSwatch id={id} />
                    <span className="truncate">{APP_THEME_LABELS[id]}</span>
                </MenuCheckboxItem>
            ))}
        </>
    )
}

export function ThemeMenu() {
    return (
        <MenuSub>
            <MenuSubTrigger>Theme</MenuSubTrigger>
            <MenuSubPopup className="max-h-96 min-w-52 overflow-y-auto">
                <MenuGroup>
                    <MenuSub>
                        <MenuSubTrigger>Dark</MenuSubTrigger>
                        <MenuSubPopup className="min-w-52">
                            <MenuGroup>
                                <ThemeMenuItems ids={APP_DARK_THEME_IDS} />
                            </MenuGroup>
                        </MenuSubPopup>
                    </MenuSub>
                    <MenuSub>
                        <MenuSubTrigger>Light</MenuSubTrigger>
                        <MenuSubPopup className="min-w-52">
                            <MenuGroup>
                                <ThemeMenuItems ids={APP_LIGHT_THEME_IDS} />
                            </MenuGroup>
                        </MenuSubPopup>
                    </MenuSub>
                </MenuGroup>
            </MenuSubPopup>
        </MenuSub>
    )
}
