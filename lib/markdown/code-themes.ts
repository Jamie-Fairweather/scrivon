import type { BundledTheme } from 'shiki'

/**
 * The code colour themes export offers, light ones first. `background` and `text` are the plain
 * colours Word code blocks use (hex without `#`): the theme's own, as the PDF draws it, except
 * GitHub's, which keep the code-block colours of GitHub's site.
 */
export const EXPORT_CODE_THEMES = [
    { id: 'github-light', label: 'GitHub Light', background: 'F6F8FA', text: '24292F' },
    { id: 'one-light', label: 'One Light', background: 'FAFAFA', text: '383A42' },
    { id: 'solarized-light', label: 'Solarized Light', background: 'FDF6E3', text: '657B83' },
    { id: 'catppuccin-latte', label: 'Catppuccin Latte (light)', background: 'EFF1F5', text: '4C4F69' },
    { id: 'github-dark', label: 'GitHub Dark', background: '0D1117', text: 'E6EDF3' },
    { id: 'one-dark-pro', label: 'One Dark', background: '282C34', text: 'ABB2BF' },
    { id: 'solarized-dark', label: 'Solarized Dark', background: '002B36', text: '839496' },
    { id: 'catppuccin-mocha', label: 'Catppuccin Mocha (dark)', background: '1E1E2E', text: 'CDD6F4' },
    { id: 'tokyo-night', label: 'Tokyo Night (dark)', background: '1A1B26', text: 'A9B1D6' },
    { id: 'nord', label: 'Nord (dark)', background: '2E3440', text: 'D8DEE9' },
    { id: 'dracula', label: 'Dracula (dark)', background: '282A36', text: 'F8F8F2' },
] as const satisfies readonly { id: BundledTheme; label: string; background: string; text: string }[]

/** A code colour theme export offers. */
export type ShikiTheme = (typeof EXPORT_CODE_THEMES)[number]['id']

/** The theme's Word code-block colours; GitHub Light's for a theme this version doesn't know. */
export function exportCodeTheme(id: ShikiTheme): (typeof EXPORT_CODE_THEMES)[number] {
    return EXPORT_CODE_THEMES.find((theme) => theme.id === id) ?? EXPORT_CODE_THEMES[0]
}
