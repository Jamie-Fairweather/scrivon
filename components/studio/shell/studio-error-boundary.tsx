'use client'

import { Component, useEffect, useState, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { TITLEBAR_ABOVE_DIALOGS_CLASS, WindowTitlebarControls } from '@/components/studio/shell/window-titlebar-controls'
import { Button } from '@/components/ui/button'
import { APP_NAME } from '@/lib/app-branding'
import { APP_VERSION } from '@/lib/legal/app-version'
import { errorMessage } from '@/lib/notify'
import { isTauri } from '@/lib/tauri/platform'
import { clearWorkspaceStore } from '@/lib/tauri/store'
import { cn } from '@/lib/utils'

export type StudioErrorFallbackProps = {
    error: Error
    /** Plain-text report (message, stacks, version) for "Copy error details". */
    details: string
    /** Clears the error and renders the children again. */
    reset: () => void
}

type StudioErrorBoundaryProps = {
    children: ReactNode
    /** Rendered as a component (so it may use hooks) in place of the children after an error. */
    fallback: ComponentType<StudioErrorFallbackProps>
}

type StudioErrorBoundaryState = {
    error: Error | null
    componentStack: string
}

function toError(value: unknown): Error {
    if (value instanceof Error) return value
    return new Error(typeof value === 'string' ? value : 'Unknown error')
}

export function formatErrorDetails(error: Error, componentStack = ''): string {
    return [
        `${APP_NAME} ${APP_VERSION}`,
        `${error.name}: ${error.message}`,
        error.stack ?? '',
        componentStack ? `Component stack:${componentStack}` : '',
    ]
        .filter(Boolean)
        .join('\n\n')
}

/** Catches render errors below it so one broken view can't blank the whole frameless window. */
export class StudioErrorBoundary extends Component<StudioErrorBoundaryProps, StudioErrorBoundaryState> {
    state: StudioErrorBoundaryState = { error: null, componentStack: '' }

    static getDerivedStateFromError(error: unknown): Partial<StudioErrorBoundaryState> {
        return { error: toError(error) }
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        console.error(`${APP_NAME} hit an error while rendering:`, error, info.componentStack)
        this.setState({ componentStack: info.componentStack ?? '' })
    }

    reset = () => {
        this.setState({ error: null, componentStack: '' })
    }

    render() {
        const { error, componentStack } = this.state
        if (!error) return this.props.children
        const Fallback = this.props.fallback
        return <Fallback error={error} details={formatErrorDetails(error, componentStack)} reset={this.reset} />
    }
}

/** How long "Copied" or "Couldn't copy" shows before the button reads "Copy error details" again. */
const COPY_STATUS_MS = 2000

export function CopyErrorDetailsButton({ details }: { details: string }) {
    const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

    useEffect(() => {
        if (status === 'idle') return
        const timer = setTimeout(() => setStatus('idle'), COPY_STATUS_MS)
        return () => clearTimeout(timer)
    }, [status])

    const copy = async () => {
        try {
            // Missing where the page isn't allowed to use the clipboard.
            if (!navigator.clipboard?.writeText) throw new Error('No clipboard')
            await navigator.clipboard.writeText(details)
            setStatus('copied')
        } catch {
            setStatus('failed')
        }
    }

    return (
        <Button type="button" variant="ghost" onClick={() => void copy()}>
            {status === 'copied' ? 'Copied' : status === 'failed' ? "Couldn't copy" : 'Copy error details'}
        </Button>
    )
}

export const RESET_WORKSPACE_LABEL = 'Reset recent folders and tabs'

/**
 * Why "Reset recent folders and tabs" didn't work, shown on the screen itself: the last-resort screen has
 * no notifications to show it in.
 */
export function ResetWorkspaceFailedNote({ message }: { message: string }) {
    return (
        <p role="alert" className="w-full text-sm break-words text-destructive-foreground">
            Couldn&apos;t reset recent folders and tabs. {message}
        </p>
    )
}

/**
 * Empties the stored recent folders and open tabs (workspace.json), then reloads: a way out when something
 * kept there makes the app fail every time it starts. Returns the reason when it couldn't be emptied.
 */
export async function resetWorkspaceAndReload(): Promise<string | null> {
    try {
        await clearWorkspaceStore()
    } catch (err) {
        console.warn("Couldn't reset workspace.json", err)
        return errorMessage(err)
    }
    window.location.reload()
    return null
}

/**
 * Full-window error screen with its own title bar, so the window can still be moved,
 * minimised and closed when the normal UI failed to render. `children` are the action buttons.
 */
export function StudioCrashScreen({ error, children }: { error: Error; children: ReactNode }) {
    const desktop = isTauri()

    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <header
                className={cn(
                    'flex h-[var(--titlebar-height)] shrink-0 items-center border-b border-border bg-background select-none',
                    TITLEBAR_ABOVE_DIALOGS_CLASS
                )}
            >
                <span className="shrink-0 px-3 text-xs text-muted-foreground">{APP_NAME}</span>
                <div className="min-h-0 min-w-0 flex-1 self-stretch" data-tauri-drag-region={desktop ? true : undefined} />
                {desktop && <WindowTitlebarControls />}
            </header>
            <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6">
                <div role="alert" className="my-auto flex w-full max-w-lg flex-col items-center gap-3 text-center">
                    <h1 className="text-lg font-semibold">{APP_NAME} ran into a problem</h1>
                    <p className="text-sm break-words text-muted-foreground">{error.message || 'Unknown error'}</p>
                    <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>
                </div>
            </div>
        </div>
    )
}

/**
 * Last-resort fallback: nothing else is available, so all it can do is reload, after emptying the recent
 * folders and tabs if something kept there is what keeps failing.
 */
export function StudioReloadFallback({ error, details }: StudioErrorFallbackProps) {
    const [resetting, setResetting] = useState(false)
    const [resetFailed, setResetFailed] = useState<string | null>(null)

    const reset = async () => {
        setResetting(true)
        setResetFailed(null)
        const problem = await resetWorkspaceAndReload()
        if (problem === null) return
        setResetting(false)
        setResetFailed(problem)
    }

    return (
        <StudioCrashScreen error={error}>
            {resetFailed !== null ? <ResetWorkspaceFailedNote message={resetFailed} /> : null}
            <Button type="button" disabled={resetting} onClick={() => window.location.reload()}>
                Reload
            </Button>
            {isTauri() ? (
                <Button type="button" variant="outline" disabled={resetting} onClick={() => void reset()}>
                    {resetting ? 'Resetting…' : RESET_WORKSPACE_LABEL}
                </Button>
            ) : null}
            <CopyErrorDetailsButton details={details} />
        </StudioCrashScreen>
    )
}
