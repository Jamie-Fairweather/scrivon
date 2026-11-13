import type { KeybindActionId, KeybindWhen } from '@/lib/settings/types'
import { OWN_ZOOM_SELECTOR } from '@/lib/zoom/app-zoom'

export type KeybindActionMeta = {
    id: KeybindActionId
    label: string
    category: 'Document' | 'Navigation' | 'View' | 'Workspace'
    when: KeybindWhen
    /** When true, shortcut fires even inside native text fields (e.g. F1). */
    allowInNativeTextField?: boolean
    /** When true, shortcut still fires while the command palette is open, to switch what it shows. */
    allowInPalette?: boolean
    /** When true, shortcut still fires behind an open dialog (but not Settings, which turns all shortcuts off). */
    allowInModal?: boolean
    /** A CSS selector: inside a focused element that matches it, the keys are left to that element. */
    leaveInside?: string
}

/** App zoom works everywhere, dialogs too, but the diagram canvas, whose own zoom wins while it has focus. */
const APP_ZOOM_META = {
    category: 'View',
    when: 'global',
    allowInNativeTextField: true,
    allowInPalette: true,
    allowInModal: true,
    leaveInside: OWN_ZOOM_SELECTOR,
} as const

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
    'view.appZoomIn': { label: 'Zoom in', ...APP_ZOOM_META },
    'view.appZoomOut': { label: 'Zoom out', ...APP_ZOOM_META },
    'view.appZoomReset': { label: 'Reset zoom', ...APP_ZOOM_META },
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
