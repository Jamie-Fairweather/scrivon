'use client'

import { useId, useState } from 'react'
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
import { DialogErrorBoundary } from '@/components/studio/shell/dialog-error-boundary'
import { useAppSettings, type SettingsSection } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { notifyError } from '@/lib/notify'

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

    return (
        <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
            {/* The popup takes the height and only the section content scrolls, so the header and footer always fit
                and no scroll area sits inside another. The viewport keeps the title bar and 1rem above it, 1rem below. */}
            <DialogPopup className="h-[min(48rem,calc(100dvh-var(--titlebar-height)-2rem))] max-w-3xl" bottomStickOnMobile={false}>
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                </DialogHeader>
                {/* data-slot keeps the header and footer spacing a DialogPanel gets. */}
                <div data-slot="dialog-panel" className="flex min-h-0 flex-1 gap-4 px-6 py-1">
                    <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} panelId={panelId} />
                    {/* Keyed by section, so each one opens at the top. The scrolling element is a named region,
                        so its tab stop says which section it holds. */}
                    <ScrollArea
                        key={activeSection}
                        className="min-h-0 min-w-0 flex-1"
                        scrollFade
                        scrollbarGutter
                        viewportProps={{ id: panelId, role: 'region', 'aria-labelledby': titleId }}
                    >
                        <h3 id={titleId} className="mb-4 text-base font-semibold">
                            {getSettingsSectionLabel(activeSection)}
                        </h3>
                        {/* Inside the keyed scroll area, so picking another section tries afresh. */}
                        <DialogErrorBoundary key={resetCount} open={settingsOpen} fallback={<SectionCrashNotice section={activeSection} />}>
                            <SettingsSectionPanel section={activeSection} />
                        </DialogErrorBoundary>
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
                                    Theme, layout, editor, autosave, keyboard shortcut and advanced settings go back to their defaults. Your document
                                    export profiles are kept. This cannot be undone.
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
