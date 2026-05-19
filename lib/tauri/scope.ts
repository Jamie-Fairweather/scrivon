import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/lib/tauri/platform'

export async function allowWorkspacePath(path: string): Promise<void> {
    if (!isTauri()) return
    await invoke('allow_workspace', { path })
}
