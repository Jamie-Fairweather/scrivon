import { open, confirm, message } from '@tauri-apps/plugin-dialog'
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

export async function confirmDelete(itemName: string): Promise<boolean> {
    if (!isTauri()) return false

    return confirm(`Delete "${itemName}"? This cannot be undone.`, {
        title: 'Delete',
        kind: 'warning',
        okLabel: 'Delete',
        cancelLabel: 'Cancel',
    })
}

export async function showError(title: string, body: string): Promise<void> {
    if (!isTauri()) {
        console.error(title, body)
        return
    }

    await message(body, { title, kind: 'error' })
}

export async function promptName(title: string, defaultValue = ''): Promise<string | null> {
    if (!isTauri()) return null

    const value = window.prompt(title, defaultValue)
    if (value === null) return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}
