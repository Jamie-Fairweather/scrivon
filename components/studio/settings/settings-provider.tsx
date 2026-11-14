'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { isSettingsSection } from '@/components/studio/settings/settings-nav'
import { notifyWarning } from '@/lib/notify'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import { describeDisallowedChord, describeEditorChordClash, wouldChordConflict } from '@/lib/settings/conflicts'
import { chordsEqual, isMacPlatform } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'
import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'
import { keybindOverrides, keybindsFromOverrides } from '@/lib/settings/migrate'
import { loadSettingsWithRecovery, saveSettings, type SettingsRecovery } from '@/lib/settings/storage'
import type { AppSettings, KeybindActionId, KeybindBindings, KeybindChord } from '@/lib/settings/types'
import { adoptExportImages } from '@/lib/tauri/export-image-access'
import type { AppThemeId } from '@/lib/theme/catalog'
import { systemPrefersDark, withFollowSystem, withSystemTheme } from '@/lib/theme/system-theme'

/** Why a shortcut change was refused. */
export type KeybindRefusal = {
    message: string
    /** Set when other actions already use these chords: reassignKeybind can move them here instead. */
    reassign?: KeybindChord[]
}

export type SettingsSection = 'general' | 'appearance' | 'editor' | 'pdf-export' | 'keyboard' | 'advanced'

/** Where the section Settings last showed is kept, so it opens there again after a restart. Not a setting, so not reset or exported. */
export const SETTINGS_SECTION_STORAGE_KEY = 'scrivon-settings-section'

function loadLastSection(): SettingsSection {
    try {
        const saved = localStorage.getItem(SETTINGS_SECTION_STORAGE_KEY)
        if (saved && isSettingsSection(saved)) return saved
    } catch {
        // storage blocked
    }
    return 'general'
}

function saveLastSection(section: SettingsSection): void {
    try {
        localStorage.setItem(SETTINGS_SECTION_STORAGE_KEY, section)
    } catch {
        // storage blocked or full; it only matters until the app closes
    }
}

type AppSettingsContextValue = {
    settings: AppSettings
    settingsOpen: boolean
    activeSection: SettingsSection
    setActiveSection: (section: SettingsSection) => void
    openSettings: (section?: SettingsSection) => void
    closeSettings: () => void
    updateSettings: (patch: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) => void
    /** Uses this theme all the time (leaves System mode). */
    setThemeId: (id: AppThemeId) => void
    /** Turns following the Windows light/dark setting on or off. On keeps the current theme as the pick for its kind; off keeps the theme on screen. */
    setFollowSystem: (on: boolean) => void
    /** Sets the theme System mode uses when Windows is light (a light theme) or dark (a dark theme). */
    setSystemThemeId: (id: AppThemeId) => void
    setAutosaveEnabled: (enabled: boolean) => void
    setAutosaveDelayMs: (delayMs: number) => void
    setLayoutExplorerOpen: (open: boolean) => void
    setEditorWidth: (width: number) => void
    resetEditorWidth: () => void
    setKeybindChords: (actionId: KeybindActionId, chords: KeybindChord[]) => KeybindRefusal | null
    /** Puts the default back; returns why it can't when another action uses that chord. */
    resetKeybind: (actionId: KeybindActionId) => KeybindRefusal | null
    /** Gives these chords to actionId and takes them off every other action. */
    reassignKeybind: (actionId: KeybindActionId, chords: KeybindChord[]) => KeybindRefusal | null
    resetAllKeybinds: () => void
    resetAllSettings: () => void
    /** Writes a change that is still waiting to be saved now (the end of a burst is saved shortly after it). */
    flushPendingSettings: () => void
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

function actionLabel(actionId: KeybindActionId): string {
    return getKeybindActionMeta(actionId)?.label ?? actionId
}

const RECOVERY_NOTICES: Record<Exclude<SettingsRecovery, null>, string> = {
    backup: 'The last working copy was restored, so your most recent changes may be missing.',
    reset: 'Most settings were reset to their defaults. Your theme and layout were kept.',
}

/** Why one of these chords can't be an app shortcut at all, whatever else uses it. */
function describeUnusableChords(chords: KeybindChord[]): string | null {
    for (const chord of chords) {
        const problem = describeDisallowedChord(chord) ?? describeEditorChordClash(chord)
        if (problem) return problem
    }
    return null
}

/** How long after the last of a burst of changes it is written. Dragging a colour or holding an arrow key changes settings many times a second. */
const SAVE_DELAY_MS = 300

function clampAutosaveDelay(delayMs: number): number {
    return Math.min(5000, Math.max(200, Math.round(delayMs)))
}

/** With Restore panel layout off, every start shows the panels as on a first launch: explorer, editor and preview, no outline. */
function withStartupLayout(settings: AppSettings): AppSettings {
    if (settings.layout.restorePanelsOnOpen) return settings
    const { explorerOpen, editorOpen, previewOpen, outlineOpen } = createDefaultSettings(isMacPlatform()).layout
    return { ...settings, layout: { ...settings.layout, explorerOpen, editorOpen, previewOpen, outlineOpen } }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [loaded] = useState(loadSettingsWithRecovery)
    const [settings, setSettingsState] = useState<AppSettings>(() => withStartupLayout(loaded.settings))
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [activeSection, setActiveSectionState] = useState<SettingsSection>(loadLastSection)
    // Latest settings, updated straight away so back-to-back updates build on each other.
    // React may defer a state updater until render, so the next value is never read out of one.
    const settingsRef = useRef(settings)
    // Saving writes every setting (export profiles too), so a burst of changes is written twice:
    // its first change at once, and its last one shortly after the burst ends.
    const pendingSaveRef = useRef<AppSettings | null>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const flushPendingSettings = useCallback(() => {
        if (saveTimerRef.current !== null) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
        }
        const pending = pendingSaveRef.current
        if (!pending) return
        pendingSaveRef.current = null
        saveSettings(pending)
    }, [])

    const persist = useCallback(
        (next: AppSettings) => {
            settingsRef.current = next
            setSettingsState(next)
            if (saveTimerRef.current === null) {
                // A change on its own (a theme or layout shortcut) is written straight away, so
                // closing the window right after can't lose it. Only the rest of a burst waits.
                saveSettings(next)
            } else {
                pendingSaveRef.current = next
                clearTimeout(saveTimerRef.current)
            }
            saveTimerRef.current = setTimeout(flushPendingSettings, SAVE_DELAY_MS)
        },
        [flushPendingSettings]
    )

    // Don't lose the last change when the page goes away (reload, close) or the app is hidden.
    useEffect(() => {
        const flushWhenHidden = () => {
            if (document.visibilityState === 'hidden') flushPendingSettings()
        }
        window.addEventListener('pagehide', flushPendingSettings)
        window.addEventListener('beforeunload', flushPendingSettings)
        document.addEventListener('visibilitychange', flushWhenHidden)
        return () => {
            window.removeEventListener('pagehide', flushPendingSettings)
            window.removeEventListener('beforeunload', flushPendingSettings)
            document.removeEventListener('visibilitychange', flushWhenHidden)
            flushPendingSettings()
        }
    }, [flushPendingSettings])

    const updateSettings = useCallback(
        (patch: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) => {
            const current = settingsRef.current
            const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch }
            // An update that hands back the same settings (zoom already at 200%) has nothing to save.
            if (next !== current) persist(next)
        },
        [persist]
    )

    // Tell the user when saved settings were unreadable, instead of quietly changing them.
    useEffect(() => {
        if (!loaded.recovery) return
        notifyWarning('Settings could not be read', { id: 'settings-recovered', description: RECOVERY_NOTICES[loaded.recovery], timeout: 0 })
    }, [loaded])

    // The export only reads images the user chose. Profiles saved before that check name images
    // the app has no record of, so hand them over; Rust takes them only the first time.
    useEffect(() => {
        void adoptExportImages(loaded.settings.pdfExport)
    }, [loaded])

    const setActiveSection = useCallback((section: SettingsSection) => {
        setActiveSectionState(section)
        saveLastSection(section)
    }, [])

    // Without a section, reopen on the one last used (even after a restart) rather than jumping back to General.
    const openSettings = useCallback(
        (section?: SettingsSection) => {
            if (section) setActiveSection(section)
            setSettingsOpen(true)
        },
        [setActiveSection]
    )

    // Changes made in Settings are written as it closes, not a moment later.
    const closeSettings = useCallback(() => {
        setSettingsOpen(false)
        flushPendingSettings()
    }, [flushPendingSettings])

    const setThemeId = useCallback(
        (id: AppThemeId) => {
            updateSettings((current) => ({ ...current, theme: { ...current.theme, id } }))
        },
        [updateSettings]
    )

    const setFollowSystem = useCallback(
        (on: boolean) => {
            updateSettings((current) => ({ ...current, theme: withFollowSystem(current.theme, on, systemPrefersDark()) }))
        },
        [updateSettings]
    )

    const setSystemThemeId = useCallback(
        (id: AppThemeId) => {
            updateSettings((current) => ({ ...current, theme: withSystemTheme(current.theme, id) }))
        },
        [updateSettings]
    )

    const setAutosaveEnabled = useCallback(
        (enabled: boolean) => {
            updateSettings((current) => ({ ...current, autosave: { ...current.autosave, enabled } }))
        },
        [updateSettings]
    )

    const setAutosaveDelayMs = useCallback(
        (delayMs: number) => {
            updateSettings((current) => ({
                ...current,
                autosave: { ...current.autosave, delayMs: clampAutosaveDelay(delayMs) },
            }))
        },
        [updateSettings]
    )

    const setLayoutExplorerOpen = useCallback(
        (open: boolean) => {
            updateSettings((current) => ({ ...current, layout: { ...current.layout, explorerOpen: open } }))
        },
        [updateSettings]
    )

    const setEditorWidth = useCallback(
        (width: number) => {
            updateSettings((current) => ({
                ...current,
                layout: { ...current.layout, editorWidth: Math.min(2000, Math.max(280, width)) },
            }))
        },
        [updateSettings]
    )

    const resetEditorWidth = useCallback(() => {
        updateSettings((current) => ({
            ...current,
            layout: { ...current.layout, editorWidth: createDefaultSettings(isMacPlatform()).layout.editorWidth },
        }))
    }, [updateSettings])

    /**
     * Changes shortcuts the way they're saved: as the user's changes on top of the defaults. An
     * action left on its default then gets a default chord back as soon as no other action has
     * it, as it would after a restart, instead of being saved as cleared.
     */
    const changeKeybinds = useCallback(
        (change: (overrides: Partial<KeybindBindings>) => Partial<KeybindBindings>) => {
            updateSettings((current) => {
                const defaults = createDefaultKeybinds(isMacPlatform())
                return { ...current, keybinds: keybindsFromOverrides(change(keybindOverrides(current.keybinds, defaults)), defaults) }
            })
        },
        [updateSettings]
    )

    const setKeybindChords = useCallback(
        (actionId: KeybindActionId, chords: KeybindChord[]): KeybindRefusal | null => {
            const unusable = describeUnusableChords(chords)
            if (unusable) return { message: unusable }

            for (const chord of chords) {
                const conflict = wouldChordConflict(settingsRef.current.keybinds, actionId, chord)
                if (conflict) return { message: `${formatChord(chord)} is already assigned to ${actionLabel(conflict)}`, reassign: chords }
            }

            changeKeybinds((overrides) => ({ ...overrides, [actionId]: chords }))
            return null
        },
        [changeKeybinds]
    )

    const resetKeybind = useCallback(
        (actionId: KeybindActionId): KeybindRefusal | null => {
            const defaults = createDefaultKeybinds(isMacPlatform())[actionId] ?? []
            // Never put a default back on top of a chord another action now uses.
            for (const chord of defaults) {
                const conflict = wouldChordConflict(settingsRef.current.keybinds, actionId, chord)
                if (conflict) return { message: `${formatChord(chord)} is already assigned to ${actionLabel(conflict)}`, reassign: defaults }
            }

            changeKeybinds((overrides) => {
                const next = { ...overrides }
                delete next[actionId]
                return next
            })
            return null
        },
        [changeKeybinds]
    )

    const reassignKeybind = useCallback(
        (actionId: KeybindActionId, chords: KeybindChord[]): KeybindRefusal | null => {
            const unusable = describeUnusableChords(chords)
            if (unusable) return { message: unusable }

            // Actions on their default lose the chord while it's taken; changed ones lose it for good.
            changeKeybinds((overrides) => {
                const next = { ...overrides }
                for (const id of Object.keys(next) as KeybindActionId[]) {
                    next[id] = next[id]?.filter((existing) => !chords.some((chord) => chordsEqual(existing, chord)))
                }
                next[actionId] = chords
                return next
            })
            return null
        },
        [changeKeybinds]
    )

    const resetAllKeybinds = useCallback(() => {
        updateSettings((current) => ({
            ...current,
            keybinds: createDefaultKeybinds(isMacPlatform()),
        }))
    }, [updateSettings])

    // Export profiles (logos, headers, fonts) and the words added to the dictionary are the user's own
    // work, not preferences, so they're kept.
    const resetAllSettings = useCallback(() => {
        updateSettings((current) => {
            const defaults = createDefaultSettings(isMacPlatform())
            return { ...defaults, pdfExport: current.pdfExport, spellcheck: { ...defaults.spellcheck, words: current.spellcheck.words } }
        })
        flushPendingSettings()
    }, [updateSettings, flushPendingSettings])

    const value = useMemo<AppSettingsContextValue>(
        () => ({
            settings,
            settingsOpen,
            activeSection,
            setActiveSection,
            openSettings,
            closeSettings,
            updateSettings,
            setThemeId,
            setFollowSystem,
            setSystemThemeId,
            setAutosaveEnabled,
            setAutosaveDelayMs,
            setLayoutExplorerOpen,
            setEditorWidth,
            resetEditorWidth,
            setKeybindChords,
            resetKeybind,
            reassignKeybind,
            resetAllKeybinds,
            resetAllSettings,
            flushPendingSettings,
        }),
        [
            settings,
            settingsOpen,
            activeSection,
            setActiveSection,
            openSettings,
            closeSettings,
            updateSettings,
            setThemeId,
            setFollowSystem,
            setSystemThemeId,
            setAutosaveEnabled,
            setAutosaveDelayMs,
            setLayoutExplorerOpen,
            setEditorWidth,
            resetEditorWidth,
            setKeybindChords,
            resetKeybind,
            reassignKeybind,
            resetAllKeybinds,
            resetAllSettings,
            flushPendingSettings,
        ]
    )

    return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings(): AppSettingsContextValue {
    const ctx = useContext(AppSettingsContext)
    if (!ctx) throw new Error('useAppSettings must be used within SettingsProvider')
    return ctx
}

const flushNothing = () => {}

/**
 * flushPendingSettings, for code that also runs outside a SettingsProvider: the last-resort error screen
 * (app/global-error.tsx) replaces the layout that holds it, and keeps its title bar. There it does nothing.
 */
export function useFlushPendingSettings(): () => void {
    return useContext(AppSettingsContext)?.flushPendingSettings ?? flushNothing
}
