import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'

export async function allowWorkspacePath(path: string): Promise<void> {
    if (!isTauri()) return
    await invoke('allow_workspace', { path })
}

/** Stops a folder the user removed from Recent opening again without the folder dialog. */
export async function forgetWorkspacePath(path: string): Promise<void> {
    if (!isTauri()) return
    await invoke('forget_workspace', { path })
}
