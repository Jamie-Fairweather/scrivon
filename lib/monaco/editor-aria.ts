import { formatChord } from '@/lib/settings/format-keybind'
import { documentKind } from '@/lib/workspace/file-types'

/** Monaco's "Tab moves focus" toggle, as shown on screen: Ctrl+M, or ⌃⇧M on macOS. */
export function tabFocusToggleKeyLabel(isMac: boolean): string {
    return formatChord({ key: 'm', ctrl: true, shift: isMac }, isMac)
}

/**
 * Accessible name for the editor: which file it holds, and how to get out of it. Tab
 * indents inside Monaco, so the only keyboard way out is Monaco's "Tab moves focus"
 * toggle (Ctrl+M, or Ctrl+Shift+M on macOS).
 */
export function editorAriaLabel(tab: { name: string; readOnly?: boolean } | null, isMac: boolean, tabMovesFocus = false): string {
    if (!tab) return 'Editor'
    const kind = documentKind(tab.name)
    const kindLabel = kind === 'mermaid' ? 'Mermaid' : kind === 'markdown' ? 'Markdown' : 'Text'
    const readOnly = tab.readOnly ? ', read-only' : ''
    const toggleKey = isMac ? 'Control+Shift+M' : 'Control+M'
    const tabHelp = tabMovesFocus
        ? `The Tab key moves focus. Press ${toggleKey} to make it indent again.`
        : `Press ${toggleKey} to make the Tab key move focus instead of indenting.`
    return `${tab.name}, ${kindLabel} editor${readOnly}. ${tabHelp}`
}
