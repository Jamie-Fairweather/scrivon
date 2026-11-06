import { toastManager } from '@/components/ui/toast'

/**
 * Shared, non-blocking user feedback.
 *
 * Use these instead of `console.error` (invisible to users) or native message boxes
 * (blocking, and they lose context) whenever an action succeeds or fails.
 */

export type NotifyAction = {
    label: string
    onClick: () => void
}

export type NotifyOptions = {
    /** Reusing an id replaces the existing toast instead of stacking a new one. */
    id?: string
    description?: string
    /** Milliseconds before auto-dismiss. 0 keeps the toast until dismissed. */
    timeout?: number
    action?: NotifyAction
}

const ERROR_TIMEOUT_MS = 10_000
const DEFAULT_TIMEOUT_MS = 4_000

/** Turns anything thrown (Error, Tauri string error, unknown) into a readable sentence. */
export function errorMessage(err: unknown, fallback = 'Something went wrong.'): string {
    if (err instanceof Error && err.message.trim()) return err.message
    if (typeof err === 'string' && err.trim()) return err
    if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as { message?: unknown }).message
        if (typeof message === 'string' && message.trim()) return message
    }
    return fallback
}

function add(type: 'error' | 'success' | 'info' | 'warning', title: string, options: NotifyOptions = {}): string {
    const { id, description, timeout, action } = options
    const toastOptions = {
        type,
        title,
        description,
        timeout: timeout ?? (type === 'error' || type === 'warning' ? ERROR_TIMEOUT_MS : DEFAULT_TIMEOUT_MS),
        priority: type === 'error' || type === 'warning' ? ('high' as const) : ('low' as const),
        actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
    }
    if (id) {
        toastManager.close(id)
        return toastManager.add({ id, ...toastOptions })
    }
    return toastManager.add(toastOptions)
}

/** Shows an error toast. `err` becomes the description unless `options.description` is given. */
export function notifyError(title: string, err?: unknown, options: NotifyOptions = {}): string {
    const description = options.description ?? (err === undefined ? undefined : errorMessage(err))
    if (err !== undefined) console.error(title, err)
    return add('error', title, { ...options, description })
}

export function notifyWarning(title: string, options: NotifyOptions = {}): string {
    return add('warning', title, options)
}

export function notifySuccess(title: string, options: NotifyOptions = {}): string {
    return add('success', title, options)
}

export function notifyInfo(title: string, options: NotifyOptions = {}): string {
    return add('info', title, options)
}

export function dismissNotification(id: string): void {
    toastManager.close(id)
}
