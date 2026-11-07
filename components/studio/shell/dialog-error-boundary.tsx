'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'

type DialogErrorBoundaryProps = {
    children: ReactNode
    /** Whether the dialog is open. After a crash, the dialog is drawn again once this changes (closed, or opened again). */
    open: boolean
    /** Called once for each crash, to close the dialog and tell the user. */
    onCrash: (error: Error) => void
}

type DialogErrorBoundaryState = {
    error: Error | null
    /** Whether the dialog was open when it crashed; null until the first render after the crash notes it. */
    openAtCrash: boolean | null
}

function toError(value: unknown): Error {
    if (value instanceof Error) return value
    return new Error(typeof value === 'string' ? value : 'Unknown error')
}

/**
 * Catches a render error in one dialog (Settings, the command palette), so the dialog closes with a notice
 * instead of the whole window going to a reload screen, which would lose edits not yet kept as a copy.
 * It draws nothing until the dialog is closed or opened again, which tries it afresh.
 */
export class DialogErrorBoundary extends Component<DialogErrorBoundaryProps, DialogErrorBoundaryState> {
    state: DialogErrorBoundaryState = { error: null, openAtCrash: null }

    static getDerivedStateFromError(error: unknown): Partial<DialogErrorBoundaryState> {
        return { error: toError(error), openAtCrash: null }
    }

    // Worked out while rendering rather than in componentDidUpdate, which also runs for the render that
    // caught the error: a dialog that crashed as it opened would be tried again at once and crash twice.
    static getDerivedStateFromProps(props: DialogErrorBoundaryProps, state: DialogErrorBoundaryState): Partial<DialogErrorBoundaryState> | null {
        if (!state.error) return null
        if (state.openAtCrash === null) return { openAtCrash: props.open }
        return props.open === state.openAtCrash ? null : { error: null, openAtCrash: null }
    }

    componentDidCatch(error: unknown, info: ErrorInfo) {
        console.error('A dialog hit an error while rendering:', error, info.componentStack)
        this.props.onCrash(toError(error))
    }

    render() {
        return this.state.error ? null : this.props.children
    }
}
