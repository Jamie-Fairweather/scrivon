import { chordsEqual, isComposingKeyEvent } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'
import type { KeybindChord } from '@/lib/settings/types'

/**
 * The keys Replace in Workspace takes while the palette shows its Replace box: Ctrl+Shift+1 replaces the
 * selected match and Ctrl+Alt+Enter runs Replace All (Cmd for Ctrl on macOS), as in VS Code. They are fixed,
 * not in Keyboard settings, so an action that runs inside the palette may not have them (conflicts.ts), and the
 * app's own keys leave them to the palette while the box shows (use-global-keybinds.ts).
 */

export type WorkspaceReplaceKey = 'replaceOne' | 'replaceAll'

/** Marks the palette popup while the Replace box shows, so the app's own keys leave these to it. */
export const REPLACE_KEYS_ATTRIBUTE = 'data-replace-keys'

export function workspaceReplaceChord(action: WorkspaceReplaceKey, isMac: boolean): KeybindChord {
    const mod = isMac ? { meta: true } : { ctrl: true }
    return action === 'replaceOne' ? { key: '1', ...mod, shift: true } : { key: 'Enter', ...mod, alt: true }
}

/** How the key is written in a tooltip: 'Ctrl+Shift+1', or '⇧⌘1' on macOS. */
export function formatWorkspaceReplaceKey(action: WorkspaceReplaceKey, isMac: boolean): string {
    return formatChord(workspaceReplaceChord(action, isMac), isMac)
}

/** The key for aria-keyshortcuts: 'Control+Shift+1', or 'Meta+Shift+1' on macOS. */
export function workspaceReplaceAriaKeys(action: WorkspaceReplaceKey, isMac: boolean): string {
    const mod = isMac ? 'Meta' : 'Control'
    return action === 'replaceOne' ? `${mod}+Shift+1` : `${mod}+Alt+Enter`
}

/** Whether a shortcut someone saved is one of these keys ('!' is what Shift+1 types on many layouts). */
export function isWorkspaceReplaceChord(chord: KeybindChord, isMac: boolean): boolean {
    const one = workspaceReplaceChord('replaceOne', isMac)
    return chordsEqual(chord, one) || chordsEqual(chord, { ...one, key: '!' }) || chordsEqual(chord, workspaceReplaceChord('replaceAll', isMac))
}

type KeyEventLike = {
    key: string
    code?: string
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
    isComposing?: boolean
    keyCode?: number
}

/**
 * Which replace a key press asks for, or null. The 1 is read from the physical key, since Shift+1 types '!'
 * on a US keyboard, '"' on a German one and '1' on a French one. On Windows Ctrl+Alt is also AltGr, but
 * AltGr+Enter types nothing, so it is still Replace All.
 */
export function workspaceReplaceKeyForEvent(event: KeyEventLike, isMac: boolean): WorkspaceReplaceKey | null {
    if (isComposingKeyEvent(event)) return null
    const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
    if (!mod) return null
    if (event.shiftKey && !event.altKey && (event.code === 'Digit1' || event.code === 'Numpad1' || event.key === '1' || event.key === '!')) {
        return 'replaceOne'
    }
    if (event.altKey && !event.shiftKey && event.key === 'Enter') return 'replaceAll'
    return null
}
