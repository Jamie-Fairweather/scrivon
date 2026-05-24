/**
 * App-owned theme registry. Palette values for mermaid-* themes were originally
 * from beautiful-mermaid (src/theme.ts); maintained here for easy edits.
 */
import { hexColorMix } from '@/lib/theme/color-mix'
import type { AppThemeDefinition } from '@/lib/theme/types'

const SCRIVON_DARK_BG = hexColorMix('#ffffff', '#0a0a0a', 5)

export const APP_THEMES = {
    'scrivon-light': {
        label: 'Scrivon Light',
        kind: 'light',
        colors: { bg: '#ffffff', fg: '#262626' },
    },
    'scrivon-dark': {
        label: 'Scrivon Dark',
        kind: 'dark',
        colors: { bg: SCRIVON_DARK_BG, fg: '#f5f5f5' },
    },
    'zinc-light': {
        label: 'Zinc Light',
        kind: 'light',
        colors: { bg: '#FFFFFF', fg: '#27272A' },
    },
    'zinc-dark': {
        label: 'Zinc Dark',
        kind: 'dark',
        colors: { bg: '#18181B', fg: '#FAFAFA' },
    },
    'tokyo-night': {
        label: 'Tokyo Night',
        kind: 'dark',
        colors: {
            bg: '#1a1b26',
            fg: '#a9b1d6',
            line: '#3d59a1',
            accent: '#7aa2f7',
            muted: '#565f89',
        },
    },
    'tokyo-night-storm': {
        label: 'Tokyo Storm',
        kind: 'dark',
        colors: {
            bg: '#24283b',
            fg: '#a9b1d6',
            line: '#3d59a1',
            accent: '#7aa2f7',
            muted: '#565f89',
        },
    },
    'tokyo-night-light': {
        label: 'Tokyo Light',
        kind: 'light',
        colors: {
            bg: '#d5d6db',
            fg: '#343b58',
            line: '#34548a',
            accent: '#34548a',
            muted: '#9699a3',
        },
    },
    'catppuccin-mocha': {
        label: 'Catppuccin Mocha',
        kind: 'dark',
        colors: {
            bg: '#1e1e2e',
            fg: '#cdd6f4',
            line: '#585b70',
            accent: '#cba6f7',
            muted: '#6c7086',
        },
    },
    'catppuccin-latte': {
        label: 'Catppuccin Latte',
        kind: 'light',
        colors: {
            bg: '#eff1f5',
            fg: '#4c4f69',
            line: '#9ca0b0',
            accent: '#8839ef',
            muted: '#9ca0b0',
        },
    },
    nord: {
        label: 'Nord',
        kind: 'dark',
        colors: {
            bg: '#2e3440',
            fg: '#d8dee9',
            line: '#4c566a',
            accent: '#88c0d0',
            muted: '#616e88',
        },
    },
    'nord-light': {
        label: 'Nord Light',
        kind: 'light',
        colors: {
            bg: '#eceff4',
            fg: '#2e3440',
            line: '#aab1c0',
            accent: '#5e81ac',
            muted: '#7b88a1',
        },
    },
    dracula: {
        label: 'Dracula',
        kind: 'dark',
        colors: {
            bg: '#282a36',
            fg: '#f8f8f2',
            line: '#6272a4',
            accent: '#bd93f9',
            muted: '#6272a4',
        },
    },
    'github-light': {
        label: 'GitHub Light',
        kind: 'light',
        colors: {
            bg: '#ffffff',
            fg: '#1f2328',
            line: '#d1d9e0',
            accent: '#0969da',
            muted: '#59636e',
        },
    },
    'github-dark': {
        label: 'GitHub Dark',
        kind: 'dark',
        colors: {
            bg: '#0d1117',
            fg: '#e6edf3',
            line: '#3d444d',
            accent: '#4493f8',
            muted: '#9198a1',
        },
    },
    'solarized-light': {
        label: 'Solarized Light',
        kind: 'light',
        colors: {
            bg: '#fdf6e3',
            fg: '#657b83',
            line: '#93a1a1',
            accent: '#268bd2',
            muted: '#93a1a1',
        },
    },
    'solarized-dark': {
        label: 'Solarized Dark',
        kind: 'dark',
        colors: {
            bg: '#002b36',
            fg: '#839496',
            line: '#586e75',
            accent: '#268bd2',
            muted: '#586e75',
        },
    },
    'one-dark': {
        label: 'One Dark',
        kind: 'dark',
        colors: {
            bg: '#282c34',
            fg: '#abb2bf',
            line: '#4b5263',
            accent: '#c678dd',
            muted: '#5c6370',
        },
    },
} as const satisfies Record<string, AppThemeDefinition>

export type AppThemeId = keyof typeof APP_THEMES
