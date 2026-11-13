import { KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import { APP_DARK_THEME_IDS, APP_LIGHT_THEME_IDS, APP_THEME_LABELS } from '@/lib/theme/catalog'
import type { SettingsSection } from '@/components/studio/settings/settings-provider'

/** One setting that Settings search can find. */
export type SettingsSearchEntry = {
    section: SettingsSection
    /** The setting's label, exactly as its section shows it. */
    label: string
    /** The titled group it sits in, for labels used more than once in a section (Header and Footer). */
    group?: string
    /** Other words people might search for. */
    keywords?: string
    /** Only shown in the desktop app. */
    desktopOnly?: boolean
}

/** The Header and Footer groups have the same rows. */
function headerFooterEntries(group: 'Header' | 'Footer'): SettingsSearchEntry[] {
    const lower = group.toLowerCase()
    const row = (label: string, keywords?: string): SettingsSearchEntry => ({ section: 'pdf-export', group, label, keywords })
    return [
        row(`Show ${lower}`),
        ...(group === 'Footer' ? [row('Page numbers', 'count custom text'), row('Number pages from the body', 'start first title contents')] : []),
        row('Left image', 'logo picture'),
        row('Left text', 'title author date'),
        row('Right image', 'logo picture'),
        // The footer's right-hand text is its page numbers.
        ...(group === 'Header' ? [row('Right text', 'title author date')] : []),
        row('Background colour', 'color fill'),
        row('Font colour', 'color text'),
        row('Height (mm)', 'size'),
        row('Gap to content (mm)', 'space spacing'),
        row('Ignore margins', 'bleed edge'),
        row('Hide on', 'first pages title contents toc'),
    ]
}

/**
 * Every setting search can find, in the order the sections show them. A new setting needs a row
 * here to be found. A test checks each row here is in its section, and each labelled setting in a
 * section has a row here.
 */
const SETTINGS_SEARCH_ENTRIES: SettingsSearchEntry[] = [
    { section: 'general', label: 'Autosave', keywords: 'save automatically' },
    { section: 'general', label: 'Autosave delay (ms)', keywords: 'wait time' },

    { section: 'appearance', label: 'Follow Windows', keywords: 'system light dark mode theme' },
    // No group: the theme lists have different titles when Follow Windows is on.
    ...APP_DARK_THEME_IDS.map((id): SettingsSearchEntry => ({
        section: 'appearance',
        label: APP_THEME_LABELS[id],
        keywords: 'theme dark',
    })),
    ...APP_LIGHT_THEME_IDS.map((id): SettingsSearchEntry => ({
        section: 'appearance',
        label: APP_THEME_LABELS[id],
        keywords: 'theme light',
    })),

    { section: 'editor', label: 'Font size', keywords: 'text zoom' },
    { section: 'editor', label: 'Tab size', keywords: 'indent spaces' },
    { section: 'editor', label: 'Word wrap', keywords: 'wrap column lines' },
    { section: 'editor', label: 'Line numbers', keywords: 'gutter relative' },
    { section: 'editor', label: 'Minimap', keywords: 'overview scroll' },
    { section: 'editor', label: 'Tab key moves focus', keywords: 'indent keyboard' },
    { section: 'editor', label: 'Status bar', keywords: 'line column word count' },
    { section: 'editor', label: 'Scroll with the preview', keywords: 'sync together' },
    { section: 'editor', label: 'Double-click the preview to jump to the editor', keywords: 'sync source line cursor' },
    { section: 'editor', label: 'Editor width', keywords: 'pane panel size reset' },
    { section: 'editor', group: 'Spelling', label: 'Check spelling', keywords: 'spellcheck mistakes underline' },
    { section: 'editor', group: 'Spelling', label: 'Spelling language', keywords: 'spellcheck dictionary english' },
    { section: 'editor', group: 'Spelling', label: 'Your dictionary', keywords: 'spellcheck words added remove' },

    { section: 'pdf-export', label: 'Default export profile', keywords: 'pdf word new duplicate delete' },
    { section: 'pdf-export', label: 'Profile name', keywords: 'rename' },
    { section: 'pdf-export', group: 'Page', label: 'Page size', keywords: 'a4 letter paper' },
    { section: 'pdf-export', group: 'Page', label: 'Orientation', keywords: 'portrait landscape' },
    ...(['top', 'right', 'bottom', 'left'] as const).map((side): SettingsSearchEntry => ({
        section: 'pdf-export',
        group: 'Page',
        label: `Margin ${side} (mm)`,
    })),
    { section: 'pdf-export', group: 'Text', label: 'Heading font', keywords: 'typeface' },
    { section: 'pdf-export', group: 'Text', label: 'Body font', keywords: 'typeface' },
    { section: 'pdf-export', group: 'Text', label: 'Monospace font', keywords: 'code typeface' },
    { section: 'pdf-export', group: 'Text', label: 'Body size (pt)', keywords: 'font text' },
    { section: 'pdf-export', group: 'Text', label: 'Line height', keywords: 'spacing' },
    { section: 'pdf-export', group: 'Text', label: 'Justify body text', keywords: 'align' },
    { section: 'pdf-export', group: 'Colours', label: 'Brand colour', keywords: 'color accent' },
    { section: 'pdf-export', group: 'Colours', label: 'Link colour (optional)', keywords: 'color' },
    { section: 'pdf-export', group: 'Title page', label: 'Include a title page', keywords: 'cover' },
    { section: 'pdf-export', group: 'Title page', label: 'Cover image', keywords: 'logo picture' },
    { section: 'pdf-export', group: 'Title page', label: 'Cover image ignores margins', keywords: 'bleed banner' },
    { section: 'pdf-export', group: 'Table of contents', label: 'Include a table of contents', keywords: 'toc' },
    { section: 'pdf-export', group: 'Table of contents', label: 'TOC depth', keywords: 'contents headings levels' },
    { section: 'pdf-export', group: 'Table of contents', label: 'Exclude H1 from TOC', keywords: 'contents headings' },
    ...headerFooterEntries('Header'),
    ...headerFooterEntries('Footer'),
    { section: 'pdf-export', group: 'Content', label: 'New page from heading', keywords: 'break' },
    { section: 'pdf-export', group: 'Content', label: 'Code theme', keywords: 'syntax highlighting' },
    { section: 'pdf-export', group: 'Content', label: 'Diagram theme', keywords: 'mermaid' },
    { section: 'pdf-export', group: 'Content', label: 'Watermark', keywords: 'draft' },

    ...KEYBIND_ACTIONS.map((action): SettingsSearchEntry => ({ section: 'keyboard', label: action.label, keywords: 'shortcut keybinding key' })),

    { section: 'advanced', label: 'Recent folders limit', keywords: 'workspace history' },
    { section: 'advanced', label: 'Reopen last folder on startup', keywords: 'workspace restore session files', desktopOnly: true },
    { section: 'advanced', label: 'Restore panel layout', keywords: 'explorer editor reopen' },
    { section: 'advanced', label: 'Check for updates automatically', keywords: 'startup launch new version check now', desktopOnly: true },
    { section: 'advanced', label: 'Settings file', keywords: 'backup export import profiles', desktopOnly: true },
]

/** Every setting search can find, leaving out the desktop app's own outside it. */
export function settingsSearchEntries({ desktop }: { desktop: boolean }): SettingsSearchEntry[] {
    return desktop ? SETTINGS_SEARCH_ENTRIES : SETTINGS_SEARCH_ENTRIES.filter((entry) => !entry.desktopOnly)
}

/** Lower-case words, split on anything that isn't a letter or digit. */
function wordsOf(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
}

/**
 * Settings whose label, group or keywords have a word starting with each word searched for, in any
 * order. Labels that start with the search come first; otherwise they keep the order Settings shows them in.
 */
export function searchSettings(query: string, { desktop }: { desktop: boolean }): SettingsSearchEntry[] {
    const queryWords = wordsOf(query)
    if (queryWords.length === 0) return []
    const phrase = queryWords.join(' ')

    const matches = settingsSearchEntries({ desktop }).filter((entry) => {
        const words = wordsOf(`${entry.label} ${entry.group ?? ''} ${entry.keywords ?? ''}`)
        return queryWords.every((queryWord) => words.some((word) => word.startsWith(queryWord)))
    })
    const startsWithSearch = (entry: SettingsSearchEntry) => wordsOf(entry.label).join(' ').startsWith(phrase)
    return [...matches.filter(startsWithSearch), ...matches.filter((entry) => !startsWithSearch(entry))]
}
