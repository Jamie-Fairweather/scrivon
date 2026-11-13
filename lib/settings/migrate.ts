import { isAppThemeId } from '@/lib/theme/catalog'
import { createDefaultSettings } from '@/lib/settings/defaults'
import { chordListsEqual, chordsEqual, isAllowedChord, isMacPlatform, isModifierKey, isUnnamedKey } from '@/lib/settings/chord-utils'
import { normalizePdfExportSettings } from '@/lib/settings/pdf-export-normalize'
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

/** A stored whole-number setting, rounded and kept in range (older versions could save 2.5). */
function readWholeNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, Math.round(value)))
}

function normalizeChord(raw: unknown): KeybindChord | null {
    if (!raw || typeof raw !== 'object') return null
    const value = raw as Record<string, unknown>
    // A modifier on its own, or a key that couldn't be named (IME "Process", "Dead"), was never a real choice.
    if (typeof value.key !== 'string' || value.key.length === 0 || isModifierKey(value.key) || isUnnamedKey(value.key)) return null

    return {
        key: value.key,
        ctrl: value.ctrl === true ? true : undefined,
        meta: value.meta === true ? true : undefined,
        shift: value.shift === true ? true : undefined,
        alt: value.alt === true ? true : undefined,
    }
}

/**
 * Reads stored shortcuts on top of the current defaults. Only the actions the user changed are
 * stored (see keybindOverrides), so a new or changed default reaches everyone who kept the old one.
 * Older versions stored the whole keymap: entries that equal the default count as unchanged.
 * When a default uses a chord the user gave to another action, the user's choice wins and the
 * default is dropped, so two actions never silently share a chord.
 */
function normalizeKeybinds(raw: unknown, defaults: KeybindBindings): KeybindBindings {
    if (!raw || typeof raw !== 'object') return defaults

    const source = raw as Record<string, unknown>
    const next = { ...defaults }
    const changed = new Set<KeybindActionId>()

    for (const actionId of Object.keys(defaults) as KeybindActionId[]) {
        const chords = source[actionId]
        if (!Array.isArray(chords)) continue
        const readable = chords.map(normalizeChord).filter((chord): chord is KeybindChord => chord !== null)
        // Drop chords that would break typing or Tab (plain letters, Tab, Enter…), which older versions could save.
        const allowed = readable.filter(isAllowedChord)
        // Nothing readable (an unknown format) or nothing allowed: keep the default rather than leaving
        // the action unassigned. Below, it is still dropped if another action has that chord.
        if (chords.length > 0 && allowed.length === 0) continue
        if (chordListsEqual(allowed, defaults[actionId])) continue
        next[actionId] = allowed
        changed.add(actionId)
    }

    const taken = [...changed].flatMap((actionId) => next[actionId])
    for (const actionId of Object.keys(defaults) as KeybindActionId[]) {
        if (changed.has(actionId)) continue
        next[actionId] = next[actionId].filter((chord) => !taken.some((userChord) => chordsEqual(userChord, chord)))
    }

    return next
}

/** The action's default chords that no other action has right now. */
function freeDefaultChords(keybinds: KeybindBindings, defaults: KeybindBindings, actionId: KeybindActionId): KeybindChord[] {
    const others = (Object.keys(defaults) as KeybindActionId[]).filter((id) => id !== actionId)
    return defaults[actionId].filter((chord) => !others.some((id) => (keybinds[id] ?? []).some((held) => chordsEqual(held, chord))))
}

/**
 * The shortcuts to save: only actions the user changed, with [] for one the user cleared.
 * Actions left out load with their current default. An action on its default less a chord
 * another action has (dropped when loading) is not a change: saving it as [] would leave it
 * unassigned for good, even once that chord is free again.
 */
export function keybindOverrides(keybinds: KeybindBindings, defaults: KeybindBindings): Partial<KeybindBindings> {
    const overrides: Partial<KeybindBindings> = {}
    for (const actionId of Object.keys(defaults) as KeybindActionId[]) {
        const chords = keybinds[actionId] ?? []
        if (chordListsEqual(chords, defaults[actionId]) || chordListsEqual(chords, freeDefaultChords(keybinds, defaults, actionId))) continue
        overrides[actionId] = chords
    }
    return overrides
}

/** The shortcuts that saved changes stand for: the defaults with the changes on top, as loading reads them. */
export function keybindsFromOverrides(overrides: Partial<KeybindBindings>, defaults: KeybindBindings): KeybindBindings {
    return normalizeKeybinds(overrides, defaults)
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
    // No theme saved yet: the default follows the OS light or dark setting, like the boot script.
    const themeId = themeRaw && isAppThemeId(themeRaw) ? themeRaw : defaults.theme.id

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
    // A theme this version doesn't know (saved by a newer one) also follows the OS, like the boot script.
    const themeId = source.theme?.id && isAppThemeId(source.theme.id) ? source.theme.id : defaults.theme.id

    return {
        autosave: {
            enabled: typeof source.autosave?.enabled === 'boolean' ? source.autosave.enabled : defaults.autosave.enabled,
            delayMs: readWholeNumber(source.autosave?.delayMs, defaults.autosave.delayMs, 200, 5000),
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
            fontSize: readWholeNumber(source.editor?.fontSize, defaults.editor.fontSize, 8, 32),
            tabSize: readWholeNumber(source.editor?.tabSize, defaults.editor.tabSize, 1, 8),
            wordWrap: normalizeWordWrap(source.editor?.wordWrap),
            wordWrapColumn: readWholeNumber(source.editor?.wordWrapColumn, defaults.editor.wordWrapColumn, 20, 200),
            lineNumbers: normalizeLineNumbers(source.editor?.lineNumbers),
            minimap: typeof source.editor?.minimap === 'boolean' ? source.editor.minimap : defaults.editor.minimap,
            tabMovesFocus: typeof source.editor?.tabMovesFocus === 'boolean' ? source.editor.tabMovesFocus : defaults.editor.tabMovesFocus,
        },
        workspace: {
            maxRecentFolders: readWholeNumber(source.workspace?.maxRecentFolders, defaults.workspace.maxRecentFolders, 1, 50),
        },
        updates: {
            checkOnLaunch: typeof source.updates?.checkOnLaunch === 'boolean' ? source.updates.checkOnLaunch : defaults.updates.checkOnLaunch,
        },
        statusBar: {
            visible: typeof source.statusBar?.visible === 'boolean' ? source.statusBar.visible : defaults.statusBar.visible,
        },
        pdfExport: normalizePdfExportSettings(source.pdfExport),
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
