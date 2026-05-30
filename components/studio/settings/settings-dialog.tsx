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
import { SettingsNav } from '@/components/studio/settings/settings-nav'
import { useAppSettings, type SettingsSection } from '@/components/studio/settings/settings-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

function SettingsSectionPanel({ section }: { section: SettingsSection }) {
    switch (section) {
        case 'general':
            return <GeneralSettings />
        case 'appearance':
            return <AppearanceSettings />
        case 'editor':
            return <EditorSettings />
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
            <DialogPopup className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                </DialogHeader>
                <DialogPanel className="pt-0" scrollFade={false}>
                    <div className="flex h-[28rem] min-h-0 gap-4">
                        <SettingsNav activeSection={activeSection} onSectionChange={setActiveSection} />
                        <ScrollArea className="min-h-0 min-w-0 flex-1" scrollFade scrollbarGutter>
                            <SettingsSectionPanel section={activeSection} />
                        </ScrollArea>
                    </div>
                </DialogPanel>
                <DialogFooter variant="bare" className="items-center justify-between">
                    <AlertDialog>
                        <AlertDialogTrigger render={<Button type="button" variant="outline" />}>Restore defaults</AlertDialogTrigger>
                        <AlertDialogPopup>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Restore all settings?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This resets preferences and keyboard shortcuts to factory defaults. This cannot be undone.
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
