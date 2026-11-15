'use client'

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
    AlertDialog,
    AlertDialogClose,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogPopup,
    AlertDialogTitle,
    AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AppearanceSettings } from '@/components/studio/settings/sections/appearance-settings'
import { AdvancedSettings } from '@/components/studio/settings/sections/advanced-settings'
import { EditorSettings } from '@/components/studio/settings/sections/editor-settings'
import { GeneralSettings } from '@/components/studio/settings/sections/general-settings'
import { KeyboardSettings } from '@/components/studio/settings/sections/keyboard-settings'
import { PdfExportSettings } from '@/components/studio/settings/sections/pdf-export-settings'
import { getSettingsSectionLabel, SettingsNav } from '@/components/studio/settings/settings-nav'
import { searchSettings, type SettingsSearchEntry } from '@/components/studio/settings/settings-search'
import { describeSearchResults, revealSetting, SettingsSearchResults } from '@/components/studio/settings/settings-search-results'
import { DialogErrorBoundary } from '@/components/studio/shell/dialog-error-boundary'
import { useAppSettings, type SettingsSection } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { notifyError } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'

function SettingsSectionPanel({ section }: { section: SettingsSection }) {
    switch (section) {
        case 'general':
            return <GeneralSettings />
        case 'appearance':
            return <AppearanceSettings />
        case 'editor':
            return <EditorSettings />
        case 'pdf-export':
            return <PdfExportSettings />
        case 'keyboard':
            return <KeyboardSettings />
        case 'advanced':
            return <AdvancedSettings />
    }
}

/** Shown in place of a section that failed to draw (most likely because of a bad saved setting). */
function SectionCrashNotice({ section }: { section: SettingsSection }) {
    return (
        <div role="alert" className="text-sm">
            <p className="font-medium">Couldn&apos;t show this section</p>
            <p className="mt-1 text-muted-foreground">
                {section === 'pdf-export'
                    ? "Something went wrong while drawing it. The other sections still work. Restore defaults keeps your export profiles, so it won't fix this one."
                    : 'Something went wrong while drawing it. The other sections still work, and Restore defaults can put its settings back.'}
            </p>
        </div>
    )
}

/**
 * Settings, drawn from the root layout outside the studio's own error screens. A section that fails to draw
 * shows a notice in its place, so the other sections and Restore defaults (which can fix a bad saved setting)
 * still work. Anything else that fails closes Settings with a notice rather than replacing the whole window
 * (and the editor's unsaved text).
 */
export function SettingsDialog() {
    const { settingsOpen, closeSettings, setActiveSection } = useAppSettings()

    return (
        <DialogErrorBoundary
            open={settingsOpen}
            onCrash={(error) => {
                closeSettings()
                // Settings reopens on the last section; start from General, in case that section is what broke.
                setActiveSection('general')
                notifyError("Couldn't show Settings", error, {
                    description: "Something went wrong while drawing it. Your open files weren't affected.",
                })
            }}
        >
            <SettingsDialogContent />
        </DialogErrorBoundary>
    )
}

function SettingsDialogContent() {
    const { settingsOpen, closeSettings, activeSection, setActiveSection, resetAllSettings } = useAppSettings()
    const panelId = useId()
    const titleId = useId()
    // Bumped by Restore defaults, so a section that failed to draw tries again with the restored settings.
    const [resetCount, setResetCount] = useState(0)
    const [query, setQuery] = useState('')
    // Opening Settings again starts on the last section, not the last search.
    const [wasOpen, setWasOpen] = useState(settingsOpen)
    if (wasOpen !== settingsOpen) {
        setWasOpen(settingsOpen)
        if (settingsOpen) setQuery('')
    }
    const results = useMemo(() => searchSettings(query, { desktop: isTauri() }), [query])
    const searching = query.trim() !== ''
    // The setting a search result was picked for, shown once its section has drawn.
    const revealRef = useRef<SettingsSearchEntry | null>(null)
    const searchBoxRef = useRef<HTMLInputElement>(null)

    const showSection = (section: SettingsSection) => {
        setQuery('')
        setActiveSection(section)
    }

    const showSetting = (entry: SettingsSearchEntry) => {
        revealRef.current = entry
        showSection(entry.section)
    }

    useEffect(() => {
        const entry = revealRef.current
        const panel = document.getElementById(panelId)
        if (!entry || searching || !panel) return
        revealRef.current = null
        revealSetting(panel, entry)
    }, [searching, activeSection, panelId])

    const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && results[0]) {
            event.preventDefault()
            showSetting(results[0])
        }
        // Down arrow goes to the results, so they're a key away rather than past the section list.
        if (event.key === 'ArrowDown' && searching) {
            const firstResult = document.getElementById(panelId)?.querySelector<HTMLElement>('li button')
            if (firstResult) {
                event.preventDefault()
                firstResult.focus()
            }
        }
        // Clear the search first; Esc in an empty box closes Settings as usual.
        if (event.key === 'Escape' && query) {
            event.stopPropagation()
            setQuery('')
        }
    }

    return (
        <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
            {/* The popup takes the height and only the section content scrolls, so the header and footer always fit
                and no scroll area sits inside another. The viewport keeps the title bar and 1rem above it, 1rem below. */}
            <DialogPopup className="h-[min(48rem,calc(100dvh-var(--titlebar-height)-2rem))] max-w-3xl" bottomStickOnMobile={false}>
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>Changes save automatically.</DialogDescription>
                </DialogHeader>
                {/* data-slot keeps the header and footer spacing a DialogPanel gets. */}
                <div data-slot="dialog-panel" className="flex min-h-0 flex-1 gap-4 px-6 py-1">
                    <div className="flex w-40 shrink-0 flex-col gap-2 border-r border-border pr-3">
                        <Input
                            ref={searchBoxRef}
                            type="search"
                            size="sm"
                            placeholder="Search settings"
                            aria-label="Search settings"
                            aria-controls={panelId}
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            onKeyDown={onSearchKeyDown}
                        />
                        {/* Always here, outside the results that come and go, so screen readers notice each new count. */}
                        <p role="status" className="sr-only">
                            {searching ? describeSearchResults(query, results) : ''}
                        </p>
                        <SettingsNav activeSection={searching ? null : activeSection} onSectionChange={showSection} panelId={panelId} />
                    </div>
                    {/* Keyed by section, so each one opens at the top. The scrolling element is a named region,
                        so its tab stop says which section it holds. */}
                    <ScrollArea
                        key={searching ? 'search' : activeSection}
                        className="min-h-0 min-w-0 flex-1"
                        scrollFade
                        scrollbarGutter
                        viewportProps={{ id: panelId, role: 'region', 'aria-labelledby': titleId }}
                    >
                        <h3 id={titleId} className="mb-4 text-base font-semibold">
                            {searching ? 'Search results' : getSettingsSectionLabel(activeSection)}
                        </h3>
                        {searching ? (
                            <SettingsSearchResults
                                query={query}
                                results={results}
                                onPick={showSetting}
                                onUpFromFirst={() => searchBoxRef.current?.focus()}
                            />
                        ) : (
                            // Inside the keyed scroll area, so picking another section tries afresh.
                            <DialogErrorBoundary key={resetCount} open={settingsOpen} fallback={<SectionCrashNotice section={activeSection} />}>
                                <SettingsSectionPanel section={activeSection} />
                            </DialogErrorBoundary>
                        )}
                    </ScrollArea>
                </div>
                {/* sm: so it replaces the footer's own sm:justify-end; narrow windows keep the stacked full-width buttons. */}
                <DialogFooter variant="bare" className="sm:items-center sm:justify-between">
                    <AlertDialog>
                        <AlertDialogTrigger render={<Button type="button" variant="outline" />}>Restore defaults</AlertDialogTrigger>
                        <AlertDialogPopup>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Restore all settings?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Theme, layout, editor, autosave, keyboard shortcut and advanced settings go back to their defaults. Your export
                                    profiles and the words you added to the dictionary are kept. This cannot be undone.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogClose render={<Button type="button" variant="outline" />}>Cancel</AlertDialogClose>
                                <AlertDialogClose
                                    render={<Button type="button" variant="destructive" />}
                                    onClick={() => {
                                        resetAllSettings()
                                        setResetCount((count) => count + 1)
                                    }}
                                >
                                    Restore defaults
                                </AlertDialogClose>
                            </AlertDialogFooter>
                        </AlertDialogPopup>
                    </AlertDialog>
                    <Button type="button" onClick={closeSettings}>
                        Done
                    </Button>
                </DialogFooter>
            </DialogPopup>
        </Dialog>
    )
}
