'use client'

import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS, getDiagramColors, type AppThemeId } from '@/lib/theme/catalog'
import { useAppSettings } from '@/components/studio/settings/settings-provider'

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
    const { settings, setThemeId } = useAppSettings()

    return (
        <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <div className="grid gap-1">
                {ids.map((id) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => setThemeId(id)}
                        className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                            settings.theme.id === id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'
                        }`}
                    >
                        <ThemeSwatch id={id} />
                        <span>{APP_THEME_LABELS[id]}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}

export function AppearanceSettings() {
    return (
        <div className="space-y-6">
            <ThemeGroup title="Dark themes" ids={APP_DARK_THEME_IDS} />
            <ThemeGroup title="Light themes" ids={APP_LIGHT_THEME_IDS} />
        </div>
    )
}
