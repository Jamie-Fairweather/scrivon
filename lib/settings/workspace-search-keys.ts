import { baseKeyFromCode, chordsEqual, isComposingKeyEvent, typesAltGraphCharacter } from '@/lib/settings/chord-utils'
import { formatChord } from '@/lib/settings/format-keybind'
import type { KeybindChord } from '@/lib/settings/types'

/**
 * The keys that switch Find in Workspace's options: Alt+C, Alt+W and Alt+R, Cmd+Option on macOS (Option
 * alone types there), as the app's other Alt keys. They are fixed, not in Keyboard settings, so an action
 * that runs inside the palette may not have them (conflicts.ts) and the app's keys leave them to the palette
 * while its options show (use-global-keybinds.ts).
 */

export type WorkspaceSearchOption = 'matchCase' | 'wholeWord' | 'useRegex'

export const WORKSPACE_SEARCH_OPTIONS: readonly WorkspaceSearchOption[] = ['matchCase', 'wholeWord', 'useRegex']

const OPTION_LETTERS: Record<WorkspaceSearchOption, string> = { matchCase: 'c', wholeWord: 'w', useRegex: 'r' }

/** What Option with these letters types on a US Mac keyboard, which is what a recorded Cmd+Option chord may say. */
const MAC_OPTION_CHARACTERS: Record<WorkspaceSearchOption, string> = { matchCase: 'ç', wholeWord: '∑', useRegex: '®' }

/** Marks the palette popup while the options row shows, so the app's own keys leave these to it. */
export const SEARCH_OPTION_KEYS_ATTRIBUTE = 'data-search-option-keys'

export function workspaceSearchOptionChord(option: WorkspaceSearchOption, isMac: boolean): KeybindChord {
    const key = OPTION_LETTERS[option]
    return isMac ? { key, meta: true, alt: true } : { key, alt: true }
}

/** How the key is written in a tooltip: 'Alt+C', or '⌥⌘C' on macOS. */
export function formatWorkspaceSearchOptionKey(option: WorkspaceSearchOption, isMac: boolean): string {
    return formatChord(workspaceSearchOptionChord(option, isMac), isMac)
}

/** The key for aria-keyshortcuts: 'Alt+C', or 'Meta+Alt+C' on macOS. */
export function workspaceSearchOptionAriaKeys(option: WorkspaceSearchOption, isMac: boolean): string {
    const letter = OPTION_LETTERS[option].toUpperCase()
    return isMac ? `Meta+Alt+${letter}` : `Alt+${letter}`
}

/** Whether a shortcut someone saved is one of these keys, so an action inside the palette can't have it. */
export function isWorkspaceSearchOptionChord(chord: KeybindChord, isMac: boolean): boolean {
    return WORKSPACE_SEARCH_OPTIONS.some((option) => {
        const own = workspaceSearchOptionChord(option, isMac)
        return chordsEqual(chord, own) || (isMac && chordsEqual(chord, { ...own, key: MAC_OPTION_CHARACTERS[option] }))
    })
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
    getModifierState?: (key: string) => boolean
}

/**
 * Which option a key press switches, or null. Ctrl must be up: Windows reports AltGr as Ctrl+Alt, so a
 * Polish AltGr+C still types 'ć'. A key that AltGr makes type something, or that is part of IME input, is
 * text. The letter comes from the key as typed when it is a plain a–z, otherwise from the physical key, so
 * a Russian layout ('с') and macOS Option ('ç') work too. On macOS Cmd is held, so nothing is typed, and
 * Option (which a browser may report as AltGraph) is the shortcut's own modifier.
 */
export function workspaceSearchOptionForKey(event: KeyEventLike, isMac: boolean): WorkspaceSearchOption | null {
    if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey !== isMac) return null
    if (isComposingKeyEvent(event) || (!isMac && typesAltGraphCharacter(event))) return null
    const letter = /^[a-z]$/i.test(event.key) ? event.key.toLowerCase() : baseKeyFromCode(event.code)
    return WORKSPACE_SEARCH_OPTIONS.find((option) => OPTION_LETTERS[option] === letter) ?? null
}
