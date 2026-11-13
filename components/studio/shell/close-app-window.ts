import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Closes the window, for the title bar's close button and File > Exit. The window asks about unsaved
 * changes before it goes.
 */
export function closeAppWindow(flushPendingSettings: () => void): void {
    // The window may go without a pagehide, so write a settings change that is still waiting first.
    flushPendingSettings()
    void getCurrentWindow().close()
}
