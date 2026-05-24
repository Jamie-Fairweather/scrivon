export const APP_UPDATE_TOAST_VARIANT = 'app-update' as const

export type AppUpdateToastData = {
    variant: typeof APP_UPDATE_TOAST_VARIANT
    onView: () => void
}

export function isAppUpdateToastData(data: unknown): data is AppUpdateToastData {
    return (
        typeof data === 'object' &&
        data !== null &&
        'variant' in data &&
        (data as AppUpdateToastData).variant === APP_UPDATE_TOAST_VARIANT &&
        typeof (data as AppUpdateToastData).onView === 'function'
    )
}
