import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@/lib/tauri/platform'

/**
 * A file or folder Scrivon was asked to open from outside: double-clicked in File Explorer, opened with
 * "Open with", or named on the command line (src-tauri/src/launch_paths.rs). A file opens in a tab.
 */
export type LaunchPath = { path: string; isFolder: boolean }

/** Takes the files and folders waiting to be opened, oldest first. Each is handed out once. */
export async function takeLaunchPaths(): Promise<LaunchPath[]> {
    if (!isTauri()) return []
    return await invoke<LaunchPath[]>('take_launch_paths')
}

/** Calls `handler` each time another launch of Scrivon hands this one more to open. Resolves to the stop function. */
export async function onLaunchPaths(handler: () => void): Promise<() => void> {
    if (!isTauri()) return () => {}
    return await listen('launch-paths', () => handler())
}
