import { documentKind } from '@/lib/workspace/file-types'

/**
 * Accessible name for the editor: which file it holds, and how to get out of it. Tab
 * indents inside Monaco, so the only keyboard way out is Monaco's "Tab moves focus"
 * toggle (Ctrl+M, or Ctrl+Shift+M on macOS).
 */
export function editorAriaLabel(tab: { name: string; readOnly?: boolean } | null, isMac: boolean): string {
    if (!tab) return 'Editor'
    const kind = documentKind(tab.name)
    const kindLabel = kind === 'mermaid' ? 'Mermaid' : kind === 'markdown' ? 'Markdown' : 'Text'
    const readOnly = tab.readOnly ? ', read-only' : ''
    const toggleKey = isMac ? 'Control+Shift+M' : 'Control+M'
    return `${tab.name}, ${kindLabel} editor${readOnly}. Press ${toggleKey} to make the Tab key move focus instead of indenting.`
}
