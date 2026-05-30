import type { KeybindActionId, KeybindWhen } from '@/lib/settings/types'

export type KeybindActionMeta = {
    id: KeybindActionId
    label: string
    category: 'Document' | 'Navigation' | 'View' | 'Workspace'
    when: KeybindWhen
    /** When true, shortcut fires even inside native text fields (e.g. F1). */
    allowInNativeTextField?: boolean
}

export const KEYBIND_ACTIONS: KeybindActionMeta[] = [
    { id: 'document.save', label: 'Save active document', category: 'Document', when: 'global' },
    { id: 'workspace.saveAll', label: 'Save all documents', category: 'Document', when: 'workspace' },
    { id: 'settings.open', label: 'Open settings', category: 'Navigation', when: 'global' },
    { id: 'palette.open', label: 'Open command palette', category: 'Navigation', when: 'global', allowInNativeTextField: true },
    { id: 'palette.openText', label: 'Find in workspace', category: 'Navigation', when: 'global' },
    { id: 'palette.openFiles', label: 'Go to file', category: 'Navigation', when: 'global' },
    { id: 'view.toggleExplorer', label: 'Toggle explorer', category: 'View', when: 'workspace' },
    { id: 'view.toggleEditor', label: 'Toggle editor', category: 'View', when: 'workspace' },
    { id: 'view.previewOnly', label: 'Preview only layout', category: 'View', when: 'workspace' },
    { id: 'view.fitDiagram', label: 'Fit diagram to screen', category: 'View', when: 'workspace' },
]

export function getKeybindActionMeta(id: KeybindActionId): KeybindActionMeta {
    const meta = KEYBIND_ACTIONS.find((action) => action.id === id)
    if (!meta) throw new Error(`Unknown keybind action: ${id}`)
    return meta
}
