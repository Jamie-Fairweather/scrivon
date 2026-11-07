'use client'

import { useState } from 'react'
import { useWindowCloseHandler } from '@/components/studio/hooks/use-window-close'
import {
    CopyErrorDetailsButton,
    RESET_WORKSPACE_LABEL,
    ResetWorkspaceFailedNote,
    resetWorkspaceAndReload,
    StudioCrashScreen,
    type StudioErrorFallbackProps,
} from '@/components/studio/shell/studio-error-boundary'
import { useDocumentSave } from '@/components/studio/workspace/workspace-provider'
import { Button } from '@/components/ui/button'
import { isTauri } from '@/lib/tauri/platform'

/**
 * Shown when the studio UI crashed but the workspace providers are still alive, so the open
 * files' unsaved text is still in memory: save it before reloading, and keep save-on-close working.
 */
export function StudioRecoveryScreen({ error, details, reset }: StudioErrorFallbackProps) {
    const { flushAllSaves } = useDocumentSave()
    const [busy, setBusy] = useState<'saving' | 'resetting' | null>(null)
    const [saveFailed, setSaveFailed] = useState(false)
    const [resetFailed, setResetFailed] = useState<string | null>(null)

    useWindowCloseHandler()

    /** Saves every open file; when one fails, says so and offers to reload without saving. */
    const saveAll = async (): Promise<boolean> => {
        const saved = await flushAllSaves().catch(() => false)
        if (!saved) {
            setBusy(null)
            setSaveFailed(true)
        }
        return saved
    }

    const saveAndReload = async () => {
        setBusy('saving')
        if (await saveAll()) window.location.reload()
    }

    // The open files are saved first, as for Save and reload: their tabs are part of what is forgotten.
    const saveAndReset = async () => {
        setBusy('resetting')
        setResetFailed(null)
        if (!(await saveAll())) return
        const problem = await resetWorkspaceAndReload()
        if (problem === null) return
        setBusy(null)
        setResetFailed(problem)
    }

    return (
        <StudioCrashScreen error={error}>
            {saveFailed ? (
                <p className="w-full text-sm text-destructive-foreground">
                    Some open files couldn&apos;t be saved. Reloading now will lose their unsaved changes.
                </p>
            ) : null}
            {resetFailed !== null ? <ResetWorkspaceFailedNote message={resetFailed} /> : null}
            <Button type="button" disabled={busy !== null} onClick={() => void saveAndReload()}>
                {busy === 'saving' ? 'Saving…' : saveFailed ? 'Try saving again' : 'Save and reload'}
            </Button>
            {saveFailed ? (
                <Button type="button" variant="destructive-outline" disabled={busy !== null} onClick={() => window.location.reload()}>
                    Reload without saving
                </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={busy !== null} onClick={reset}>
                Try again
            </Button>
            {isTauri() ? (
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void saveAndReset()}>
                    {busy === 'resetting' ? 'Resetting…' : RESET_WORKSPACE_LABEL}
                </Button>
            ) : null}
            <CopyErrorDetailsButton details={details} />
        </StudioCrashScreen>
    )
}
