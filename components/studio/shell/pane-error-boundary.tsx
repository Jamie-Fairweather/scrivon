'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Card, CardPanel } from '@/components/ui/card'
import { logError } from '@/lib/diagnostics/app-log'
import { errorMessage } from '@/lib/notify'
import { cn } from '@/lib/utils'

type PaneErrorBoundaryProps = {
    children: ReactNode
    /** After a crash, the children are drawn again once one of these changes (compared with Object.is). */
    resetKeys: readonly unknown[]
    /** Drawn in place of the children after a crash. */
    fallback: (error: Error) => ReactNode
}

type PaneErrorBoundaryState = {
    error: Error | null
    resetKeys: readonly unknown[]
}

function toError(value: unknown): Error {
    if (value instanceof Error) return value
    return new Error(typeof value === 'string' ? value : 'Unknown error')
}

function keysChanged(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]))
}

/**
 * Catches a render error in one pane (the preview), so the editor, tabs and explorer stay usable instead of the
 * whole window going to the recovery screen, which would show the same broken document again after a retry or a
 * reload. It tries again once `resetKeys` change, such as when the document is edited or another tab is shown.
 */
export class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
    state: PaneErrorBoundaryState = { error: null, resetKeys: this.props.resetKeys }

    static getDerivedStateFromError(error: unknown): Partial<PaneErrorBoundaryState> {
        return { error: toError(error) }
    }

    static getDerivedStateFromProps(props: PaneErrorBoundaryProps, state: PaneErrorBoundaryState): Partial<PaneErrorBoundaryState> | null {
        if (!keysChanged(props.resetKeys, state.resetKeys)) return null
        return { error: null, resetKeys: props.resetKeys }
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        console.error('A pane hit an error while rendering:', error, info.componentStack)
        logError('A pane hit an error while rendering', error)
    }

    render() {
        return this.state.error ? this.props.fallback(this.state.error) : this.props.children
    }
}

type PaneCrashNoticeProps = {
    title: string
    error: Error
    /** What the user can do to try again. */
    hint: string
    className?: string
}

/** What a pane shows in place of what crashed, laid out like the preview's empty state. */
export function PaneCrashNotice({ title, error, hint, className }: PaneCrashNoticeProps) {
    return (
        <div className={cn('flex min-h-full items-center justify-center p-4', className)}>
            <Card className="w-full max-w-md">
                <CardPanel className="space-y-1 p-4 text-center">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs break-words text-muted-foreground">{errorMessage(error)}</p>
                    <p className="text-sm text-muted-foreground">{hint}</p>
                </CardPanel>
            </Card>
        </div>
    )
}
