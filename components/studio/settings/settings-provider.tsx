'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { notifyWarning } from '@/lib/notify'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import { describeDisallowedChord, describeEditorChordClash, wouldChordConflict } from '@/lib/settings/conflicts'
import { chordsEqual, isMacPlatform } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'
import { getKeybindActionMeta } from '@/lib/settings/keybind-registry'
import { loadSettingsWithRecovery, saveSettings, type SettingsRecovery } from '@/lib/settings/storage'
import type { AppSettings, KeybindActionId, KeybindChord } from '@/lib/settings/types'

/** Why a shortcut change was refused. */
export type KeybindRefusal = {
    message: string
    /** Set when other actions already use these chords: reassignKeybind can move them here instead. */
    reassign?: KeybindChord[]
}

export type SettingsSection = 'general' | 'appearance' | 'editor' | 'pdf-export' | 'keyboard' | 'advanced'

type AppSettingsContextValue = {
    settings: AppSettings
    settingsOpen: boolean
    activeSection: SettingsSection
    setActiveSection: (section: SettingsSection) => void
    openSettings: (section?: SettingsSection) => void
    closeSettings: () => void
    updateSettings: (patch: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) => void
    setThemeId: (id: AppSettings['theme']['id']) => void
    setAutosaveEnabled: (enabled: boolean) => void
    setAutosaveDelayMs: (delayMs: number) => void
    setLayoutExplorerOpen: (open: boolean) => void
    setLayoutEditorOpen: (open: boolean) => void
    setEditorWidth: (width: number) => void
    resetEditorWidth: () => void
    setKeybindChords: (actionId: KeybindActionId, chords: KeybindChord[]) => KeybindRefusal | null
    /** Puts the default back; returns why it can't when another action uses that chord. */
    resetKeybind: (actionId: KeybindActionId) => KeybindRefusal | null
    /** Gives these chords to actionId and takes them off every other action. */
    reassignKeybind: (actionId: KeybindActionId, chords: KeybindChord[]) => KeybindRefusal | null
    resetAllKeybinds: () => void
    resetAllSettings: () => void
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

function clampAutosaveDelay(delayMs: number): number {
    return Math.min(5000, Math.max(200, Math.round(delayMs)))
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [loaded] = useState(loadSettingsWithRecovery)
    const [settings, setSettingsState] = useState<AppSettings>(loaded.settings)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [activeSection, setActiveSection] = useState<SettingsSection>('general')
    // Latest settings, updated straight away so back-to-back updates build on each other.
    // React may defer a state updater until render, so the next value is never read out of one.
    const settingsRef = useRef(settings)

    const persist = useCallback((next: AppSettings) => {
        settingsRef.current = next
        setSettingsState(next)
        saveSettings(next)
    }, [])

    const updateSettings = useCallback(
        (patch: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) => {
            const current = settingsRef.current
            persist(typeof patch === 'function' ? patch(current) : { ...current, ...patch })
        },
        [persist]
    )

    // Tell the user when saved settings were unreadable, instead of quietly changing them.
    useEffect(() => {
        if (!loaded.recovery) return
        notifyWarning('Settings could not be read', { id: 'settings-recovered', description: RECOVERY_NOTICES[loaded.recovery], timeout: 0 })
    }, [loaded])

    // Without a section, reopen on the one last used rather than jumping back to General.
    const openSettings = useCallback((section?: SettingsSection) => {
        if (section) setActiveSection(section)
        setSettingsOpen(true)
    }, [])

    const closeSettings = useCallback(() => {
        setSettingsOpen(false)
    }, [])

    const setThemeId = useCallback(
        (id: AppSettings['theme']['id']) => {
            updateSettings((current) => ({ ...current, theme: { id } }))
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

    const setLayoutEditorOpen = useCallback(
        (open: boolean) => {
            updateSettings((current) => ({ ...current, layout: { ...current.layout, editorOpen: open } }))
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

    const setKeybindChords = useCallback(
        (actionId: KeybindActionId, chords: KeybindChord[]): KeybindRefusal | null => {
            const unusable = describeUnusableChords(chords)
            if (unusable) return { message: unusable }

            for (const chord of chords) {
                const conflict = wouldChordConflict(settingsRef.current.keybinds, actionId, chord)
                if (conflict) return { message: `${formatChord(chord)} is already assigned to ${actionLabel(conflict)}`, reassign: chords }
            }

            updateSettings((current) => ({
                ...current,
                keybinds: { ...current.keybinds, [actionId]: chords },
            }))
            return null
        },
        [updateSettings]
    )

    const resetKeybind = useCallback(
        (actionId: KeybindActionId): KeybindRefusal | null => {
            const defaults = createDefaultKeybinds(isMacPlatform())[actionId] ?? []
            // Never put a default back on top of a chord another action now uses.
            for (const chord of defaults) {
                const conflict = wouldChordConflict(settingsRef.current.keybinds, actionId, chord)
                if (conflict) return { message: `${formatChord(chord)} is already assigned to ${actionLabel(conflict)}`, reassign: defaults }
            }

            updateSettings((current) => ({
                ...current,
                keybinds: { ...current.keybinds, [actionId]: defaults },
            }))
            return null
        },
        [updateSettings]
    )

    const reassignKeybind = useCallback(
        (actionId: KeybindActionId, chords: KeybindChord[]): KeybindRefusal | null => {
            const unusable = describeUnusableChords(chords)
            if (unusable) return { message: unusable }

            updateSettings((current) => {
                const keybinds = { ...current.keybinds }
                for (const id of Object.keys(keybinds) as KeybindActionId[]) {
                    if (id !== actionId && keybinds[id])
                        keybinds[id] = keybinds[id].filter((existing) => !chords.some((chord) => chordsEqual(existing, chord)))
                }
                keybinds[actionId] = chords
                return { ...current, keybinds }
            })
            return null
        },
        [updateSettings]
    )

    const resetAllKeybinds = useCallback(() => {
        updateSettings((current) => ({
            ...current,
            keybinds: createDefaultKeybinds(isMacPlatform()),
        }))
    }, [updateSettings])

    // Export profiles are the user's own work (logos, headers, fonts), not preferences, so they're kept.
    const resetAllSettings = useCallback(() => {
        updateSettings((current) => ({ ...createDefaultSettings(isMacPlatform()), pdfExport: current.pdfExport }))
    }, [updateSettings])

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
            setAutosaveEnabled,
            setAutosaveDelayMs,
            setLayoutExplorerOpen,
            setLayoutEditorOpen,
            setEditorWidth,
            resetEditorWidth,
            setKeybindChords,
            resetKeybind,
            reassignKeybind,
            resetAllKeybinds,
            resetAllSettings,
        }),
        [
            settings,
            settingsOpen,
            activeSection,
            openSettings,
            closeSettings,
            updateSettings,
            setThemeId,
            setAutosaveEnabled,
            setAutosaveDelayMs,
            setLayoutExplorerOpen,
            setLayoutEditorOpen,
            setEditorWidth,
            resetEditorWidth,
            setKeybindChords,
            resetKeybind,
            reassignKeybind,
            resetAllKeybinds,
            resetAllSettings,
        ]
    )

    return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings(): AppSettingsContextValue {
    const ctx = useContext(AppSettingsContext)
    if (!ctx) throw new Error('useAppSettings must be used within SettingsProvider')
    return ctx
}
