import { open, message } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@/lib/tauri/platform'
import { allowWorkspacePath } from '@/lib/tauri/scope'

export async function pickWorkspaceFolder(): Promise<string | null> {
    if (!isTauri()) return null

    const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Folder',
    })

    if (!selected || Array.isArray(selected)) return null

    await allowWorkspacePath(selected)
    return selected
}

export async function showError(title: string, body: string): Promise<void> {
    if (!isTauri()) {
        console.error(title, body)
        return
    }

    await message(body, { title, kind: 'error' })
}
