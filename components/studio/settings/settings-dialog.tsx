'use client'

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
import { SettingsNav } from '@/components/studio/settings/settings-nav'
import { useAppSettings, type SettingsSection } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

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

export function SettingsDialog() {
    const { settingsOpen, closeSettings, activeSection, setActiveSection, resetAllSettings } = useAppSettings()

    return (
        <Dialog open={settingsOpen} onOpenChange={(open) => !open && closeSettings()}>
            {/* The popup takes the height (2rem is the viewport's padding) and only the section content
                scrolls, so the header and footer always fit and no scroll area sits inside another. */}
            <DialogPopup className="h-[min(48rem,calc(100dvh-2rem))] max-w-3xl" bottomStickOnMobile={false}>
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                </DialogHeader>
                {/* data-slot keeps the header and footer spacing a DialogPanel gets. */}
                <div data-slot="dialog-panel" className="flex min-h-0 flex-1 gap-4 px-6 py-1">
                    <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} />
                    <ScrollArea className="min-h-0 min-w-0 flex-1" scrollFade scrollbarGutter>
                        <SettingsSectionPanel section={activeSection} />
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
                                <AlertDialogClose render={<Button type="button" variant="destructive" />} onClick={() => resetAllSettings()}>
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
