'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createDefaultKeybinds, createDefaultSettings } from '@/lib/settings/defaults'
import { wouldChordConflict } from '@/lib/settings/conflicts'
import { isMacPlatform } from '@/lib/settings/chord-utils'
import { KEYBIND_ACTIONS } from '@/lib/settings/keybind-registry'
import { loadSettings, saveSettings } from '@/lib/settings/storage'
import type { AppSettings, KeybindActionId, KeybindChord } from '@/lib/settings/types'

export type SettingsSection = 'general' | 'appearance' | 'editor' | 'keyboard' | 'advanced'

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
    setKeybindChords: (actionId: KeybindActionId, chords: KeybindChord[]) => string | null
    resetKeybind: (actionId: KeybindActionId) => void
    resetAllKeybinds: () => void
    resetAllSettings: () => void
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

function clampAutosaveDelay(delayMs: number): number {
    return Math.min(5000, Math.max(200, delayMs))
}

export function SettingsProvider({ children }: { children: ReactNode }) {
    const [settings, setSettingsState] = useState<AppSettings>(() => loadSettings())
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [activeSection, setActiveSection] = useState<SettingsSection>('general')

    const persist = useCallback((next: AppSettings) => {
        setSettingsState(next)
        saveSettings(next)
    }, [])

    const updateSettings = useCallback((patch: Partial<AppSettings> | ((current: AppSettings) => AppSettings)) => {
        setSettingsState((current) => {
            const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch }
            saveSettings(next)
            return next
        })
    }, [])

    const openSettings = useCallback((section: SettingsSection = 'general') => {
        setActiveSection(section)
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
        (actionId: KeybindActionId, chords: KeybindChord[]): string | null => {
            for (const chord of chords) {
                const conflict = wouldChordConflict(settings.keybinds, actionId, chord)
                if (conflict) {
                    const label = KEYBIND_ACTIONS.find((action) => action.id === conflict)?.label ?? conflict
                    return `Already assigned to ${label}`
                }
            }

            updateSettings((current) => ({
                ...current,
                keybinds: { ...current.keybinds, [actionId]: chords },
            }))
            return null
        },
        [settings.keybinds, updateSettings]
    )

    const resetKeybind = useCallback(
        (actionId: KeybindActionId) => {
            const defaults = createDefaultKeybinds(isMacPlatform())
            updateSettings((current) => ({
                ...current,
                keybinds: { ...current.keybinds, [actionId]: defaults[actionId] ?? [] },
            }))
        },
        [updateSettings]
    )

    const resetAllKeybinds = useCallback(() => {
        updateSettings((current) => ({
            ...current,
            keybinds: createDefaultKeybinds(isMacPlatform()),
        }))
    }, [updateSettings])

    const resetAllSettings = useCallback(() => {
        persist(createDefaultSettings(isMacPlatform()))
    }, [persist])

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
