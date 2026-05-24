import { toastManager } from '@/components/ui/toast'
import { APP_UPDATE_TOAST_VARIANT } from '@/lib/updater/update-toast-data'

export { APP_UPDATE_TOAST_VARIANT, isAppUpdateToastData, type AppUpdateToastData } from '@/lib/updater/update-toast-data'

export const UPDATE_TOAST_ID = 'app-update'

export function showUpdateAvailableToast(version: string, onView: () => void): void {
    toastManager.add({
        id: UPDATE_TOAST_ID,
        type: 'info',
        title: `Update available: v${version}`,
        // description: `Version ${version} is ready to install.`,
        timeout: 0,
        data: {
            variant: APP_UPDATE_TOAST_VARIANT,
            onView,
        },
    })
}

export function dismissUpdateToast(): void {
    toastManager.close(UPDATE_TOAST_ID)
}
