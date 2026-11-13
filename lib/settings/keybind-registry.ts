import type { KeybindActionId, KeybindWhen } from '@/lib/settings/types'

export type KeybindActionMeta = {
    id: KeybindActionId
    label: string
    category: 'Document' | 'Navigation' | 'View' | 'Workspace' | 'Markdown'
    when: KeybindWhen
    /** When true, shortcut fires even inside native text fields (e.g. F1). */
    allowInNativeTextField?: boolean
    /** When true, shortcut still fires while the command palette is open, to switch what it shows. */
    allowInPalette?: boolean
}

/**
 * Every action, keyed by id, in the order Keyboard settings lists them. The type check fails
 * when an action in KeybindActionId has no entry here (createDefaultKeybinds is checked the same way).
 */
const KEYBIND_ACTION_META = {
    'document.save': { label: 'Save active document', category: 'Document', when: 'global' },
    'workspace.saveAll': { label: 'Save all documents', category: 'Document', when: 'workspace' },
    'settings.open': { label: 'Open settings', category: 'Navigation', when: 'global' },
    'palette.open': { label: 'Open command palette', category: 'Navigation', when: 'global', allowInNativeTextField: true, allowInPalette: true },
    'palette.openText': { label: 'Find in workspace', category: 'Navigation', when: 'global', allowInPalette: true },
    'palette.openFiles': { label: 'Go to file', category: 'Navigation', when: 'global', allowInPalette: true },
    'view.toggleExplorer': { label: 'Toggle explorer', category: 'View', when: 'workspace' },
    'view.toggleEditor': { label: 'Toggle editor', category: 'View', when: 'workspace' },
    'view.previewOnly': { label: 'Preview only layout', category: 'View', when: 'workspace' },
    'view.fitDiagram': { label: 'Fit diagram to screen', category: 'View', when: 'workspace' },
    'format.bold': { label: 'Bold', category: 'Markdown', when: 'editor' },
    'format.italic': { label: 'Italic', category: 'Markdown', when: 'editor' },
    'format.code': { label: 'Inline code', category: 'Markdown', when: 'editor' },
    'format.link': { label: 'Link', category: 'Markdown', when: 'editor' },
} satisfies Record<KeybindActionId, Omit<KeybindActionMeta, 'id'>>

export const KEYBIND_ACTIONS: KeybindActionMeta[] = (Object.keys(KEYBIND_ACTION_META) as KeybindActionId[]).map((id) => ({
    id,
    ...KEYBIND_ACTION_META[id],
}))

const BY_ID = new Map(KEYBIND_ACTIONS.map((action) => [action.id, action]))

/** The action's details, or undefined for an id this build doesn't know. */
export function getKeybindActionMeta(id: KeybindActionId): KeybindActionMeta | undefined {
    return BY_ID.get(id)
}

/** An action that only runs while typing in the editor (Bold, Link…). */
export function isEditorAction(id: KeybindActionId): boolean {
    return BY_ID.get(id)?.when === 'editor'
}

/**
 * Whether two actions may have the same keys. An editor action only runs while typing in the
 * editor, where it comes first, so it can share keys with an app action that runs everywhere else.
 */
export function canShareKeys(a: KeybindActionId, b: KeybindActionId): boolean {
    return isEditorAction(a) !== isEditorAction(b)
}
