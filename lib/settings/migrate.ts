import { isAppThemeId, parseStoredTheme } from '@/lib/theme/catalog'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import type { AppSettings, EditorLineNumbers, EditorWordWrap, KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'
import { STORAGE_AUTOSAVE, STORAGE_KEY_WIDTH, STORAGE_LAYOUT_EDITOR, STORAGE_LAYOUT_EXPLORER, STORAGE_MERMAID_THEME } from '@/lib/workspace/types'

type LegacyStorageReader = (key: string) => string | null

function readBoolean(value: string | null, defaultValue: boolean): boolean {
    if (value === null) return defaultValue
    return value !== 'false'
}

function readNumber(value: string | null, defaultValue: number, min: number, max: number): number {
    if (value === null) return defaultValue
    const parsed = Number.parseInt(value, 10)
    if (Number.isNaN(parsed)) return defaultValue
    return Math.min(max, Math.max(min, parsed))
}

function normalizeChord(raw: unknown): KeybindChord | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    if (typeof value.key !== 'string' || value.key.length === 0) return null

    return {
        key: value.key,
        ctrl: value.ctrl === true ? true : undefined,
        meta: value.meta === true ? true : undefined,
        shift: value.shift === true ? true : undefined,
        alt: value.alt === true ? true : undefined,
    }
}

function normalizeKeybinds(raw: unknown, defaults: KeybindBindings): KeybindBindings {
    if (!raw || typeof raw !== 'object') return defaults

    const source = raw as Record<string, unknown>
    const next = { ...defaults }

    for (const actionId of Object.keys(defaults) as KeybindActionId[]) {
        const chords = source[actionId]
        if (!Array.isArray(chords)) continue
        const normalized = chords.map(normalizeChord).filter((chord): chord is KeybindChord => chord !== null)
        next[actionId] = normalized
    }

    return next
}

function normalizeWordWrap(value: unknown): EditorWordWrap {
    if (value === 'on' || value === 'off' || value === 'wordWrapColumn') return value
    return 'on'
}

function normalizeLineNumbers(value: unknown): EditorLineNumbers {
    if (value === 'on' || value === 'off' || value === 'relative') return value
    return 'on'
}

export function migrateLegacySettings(read: LegacyStorageReader, isMac = isMacPlatform()): AppSettings {
    const defaults = createDefaultSettings(isMac)
    const themeRaw = read(STORAGE_MERMAID_THEME)
    const themeId = themeRaw && isAppThemeId(themeRaw) ? parseStoredTheme(themeRaw) : defaults.theme.id

    return {
        ...defaults,
        autosave: {
            enabled: readBoolean(read(STORAGE_AUTOSAVE), defaults.autosave.enabled),
            delayMs: defaults.autosave.delayMs,
        },
        theme: { id: themeId },
        layout: {
            explorerOpen: readBoolean(read(STORAGE_LAYOUT_EXPLORER), defaults.layout.explorerOpen),
            editorOpen: readBoolean(read(STORAGE_LAYOUT_EDITOR), defaults.layout.editorOpen),
            editorWidth: readNumber(read(STORAGE_KEY_WIDTH), defaults.layout.editorWidth, 280, 2000),
            restorePanelsOnOpen: defaults.layout.restorePanelsOnOpen,
        },
        keybinds: defaults.keybinds,
    }
}

export function mergeStoredSettings(raw: unknown, isMac = isMacPlatform()): AppSettings {
    const defaults = createDefaultSettings(isMac)
    if (!raw || typeof raw !== 'object') return defaults

    const source = raw as Partial<AppSettings>
    const themeId = source.theme?.id && isAppThemeId(source.theme.id) ? source.theme.id : defaults.theme.id

    return {
        autosave: {
            enabled: typeof source.autosave?.enabled === 'boolean' ? source.autosave.enabled : defaults.autosave.enabled,
            delayMs:
                typeof source.autosave?.delayMs === 'number' ? Math.min(5000, Math.max(200, source.autosave.delayMs)) : defaults.autosave.delayMs,
        },
        theme: { id: themeId },
        layout: {
            explorerOpen: typeof source.layout?.explorerOpen === 'boolean' ? source.layout.explorerOpen : defaults.layout.explorerOpen,
            editorOpen: typeof source.layout?.editorOpen === 'boolean' ? source.layout.editorOpen : defaults.layout.editorOpen,
            editorWidth:
                typeof source.layout?.editorWidth === 'number'
                    ? Math.min(2000, Math.max(280, source.layout.editorWidth))
                    : defaults.layout.editorWidth,
            restorePanelsOnOpen:
                typeof source.layout?.restorePanelsOnOpen === 'boolean' ? source.layout.restorePanelsOnOpen : defaults.layout.restorePanelsOnOpen,
        },
        editor: {
            fontSize: typeof source.editor?.fontSize === 'number' ? Math.min(32, Math.max(8, source.editor.fontSize)) : defaults.editor.fontSize,
            tabSize: typeof source.editor?.tabSize === 'number' ? Math.min(8, Math.max(1, source.editor.tabSize)) : defaults.editor.tabSize,
            wordWrap: normalizeWordWrap(source.editor?.wordWrap),
            lineNumbers: normalizeLineNumbers(source.editor?.lineNumbers),
            minimap: typeof source.editor?.minimap === 'boolean' ? source.editor.minimap : defaults.editor.minimap,
        },
        workspace: {
            maxRecentFolders:
                typeof source.workspace?.maxRecentFolders === 'number'
                    ? Math.min(50, Math.max(1, source.workspace.maxRecentFolders))
                    : defaults.workspace.maxRecentFolders,
        },
        updates: {
            checkOnLaunch: typeof source.updates?.checkOnLaunch === 'boolean' ? source.updates.checkOnLaunch : defaults.updates.checkOnLaunch,
        },
        keybinds: normalizeKeybinds(source.keybinds, defaults.keybinds),
    }
}

export function dualWriteLegacyTheme(themeId: AppSettings['theme']['id']): void {
    try {
        localStorage.setItem(STORAGE_MERMAID_THEME, themeId)
    } catch {
        // private browsing / quota
    }
}

export function dualWriteLegacyLayout(layout: AppSettings['layout']): void {
    try {
        localStorage.setItem(STORAGE_LAYOUT_EXPLORER, String(layout.explorerOpen))
        localStorage.setItem(STORAGE_LAYOUT_EDITOR, String(layout.editorOpen))
        localStorage.setItem(STORAGE_KEY_WIDTH, String(layout.editorWidth))
    } catch {
        // private browsing / quota
    }
}

export function dualWriteLegacyAutosave(enabled: boolean): void {
    try {
        localStorage.setItem(STORAGE_AUTOSAVE, String(enabled))
    } catch {
        // private browsing / quota
    }
}
