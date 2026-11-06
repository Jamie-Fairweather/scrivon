'use client'

import { useState } from 'react'
import { useWindowCloseHandler } from '@/components/studio/hooks/use-window-close'
import { CopyErrorDetailsButton, StudioCrashScreen, type StudioErrorFallbackProps } from '@/components/studio/shell/studio-error-boundary'
import { useDocumentSave } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'

/**
 * Shown when the studio UI crashed but the workspace providers are still alive, so the open
 * files' unsaved text is still in memory: save it before reloading, and keep save-on-close working.
 */
export function StudioRecoveryScreen({ error, details, reset }: StudioErrorFallbackProps) {
    const { flushAllSaves } = useDocumentSave()
    const [saving, setSaving] = useState(false)
    const [saveFailed, setSaveFailed] = useState(false)

    useWindowCloseHandler()

    const saveAndReload = async () => {
        setSaving(true)
        const saved = await flushAllSaves().catch(() => false)
        if (saved) {
            window.location.reload()
            return
        }
        setSaving(false)
        setSaveFailed(true)
    }

    return (
        <StudioCrashScreen error={error}>
            {saveFailed ? (
                <p className="w-full text-sm text-destructive-foreground">
                    Some open files couldn&apos;t be saved. Reloading now will lose their unsaved changes.
                </p>
            ) : null}
            <Button type="button" disabled={saving} onClick={() => void saveAndReload()}>
                {saving ? 'Saving…' : saveFailed ? 'Try saving again' : 'Save and reload'}
            </Button>
            {saveFailed ? (
                <Button type="button" variant="destructive-outline" disabled={saving} onClick={() => window.location.reload()}>
                    Reload without saving
                </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={saving} onClick={reset}>
                Try again
            </Button>
            <CopyErrorDetailsButton details={details} />
        </StudioCrashScreen>
    )
}
