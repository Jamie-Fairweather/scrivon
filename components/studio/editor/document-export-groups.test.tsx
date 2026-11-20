import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistryProvider, useCommands, type ShownCommand } from '@/components/studio/commands/command-registry'
import { createDefaultSettings } from '@/lib/settings/defaults'
import type { EditorGroups } from '@/lib/workspace/editor-groups'
import type { DocumentTab } from '@/lib/workspace/types'
import { BatchExportProvider } from '@/components/studio/batch-export/batch-export-provider'
import { EditorGroupProvider } from '@/components/studio/workspace/editor-group-context'
import { DocumentExportProvider } from './document-export-provider'

function tab(name: string, content: string): DocumentTab {
    return { id: `D:\\docs\\${name}`, path: `D:\\docs\\${name}`, name, content, isDirty: false, isSaving: false }
}

const notes = tab('notes.md', '# Notes')
const plan = tab('plan.md', '# Plan')
const state = vi.hoisted(() => ({ groups: null as EditorGroups | null, tabs: [] as DocumentTab[] }))
/** The export dialog each group rendered, by the file it would export. */
const dialogs = vi.hoisted(() => new Map<string, { open: boolean }>())

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({ tabs: state.tabs, groups: state.groups, activeTab: null, activeTabId: null }),
    useWorkspaceSession: () => ({ workspaceRoot: 'D:\\docs' }),
}))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ themeId: 'nord' }) }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: createDefaultSettings(), updateSettings: () => {} }),
}))
vi.mock('@/components/studio/canvas/use-mermaid-svg', () => ({
    useMermaidSvg: () => ({ currentError: null, isPending: false, isStale: false, isEmpty: false }),
}))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true, isWindowsTauri: () => true }))
vi.mock('@/components/studio/editor/pdf-export-dialog', () => ({
    PdfExportDialog: ({ open, tabPath }: { open: boolean; tabPath?: string }) => {
        dialogs.set(tabPath ?? '', { open })
        return null
    },
}))

let shown: readonly ShownCommand[] = []
function CommandsProbe() {
    const commands = useCommands()
    useEffect(() => {
        shown = commands
    }, [commands])
    return null
}

/** Both groups' exports, as the tab strips hold them: only the focused group's gives the File menu and the palette theirs. */
function TwoGroups() {
    return (
        <CommandRegistryProvider>
            <BatchExportProvider>
                {state.groups!.groups.map((group, index) => (
                    <EditorGroupProvider key={group.id} index={index}>
                        <DocumentExportProvider registerCommands={state.groups!.focused === index}>{null}</DocumentExportProvider>
                    </EditorGroupProvider>
                ))}
            </BatchExportProvider>
            <CommandsProbe />
        </CommandRegistryProvider>
    )
}

function splitWithFocus(focused: number): EditorGroups {
    return {
        groups: [
            { id: 'group-1', tabIds: [notes.id], activeTabId: notes.id },
            { id: 'group-2', tabIds: [plan.id], activeTabId: plan.id },
        ],
        focused,
        ratio: 0.5,
    }
}

beforeEach(() => {
    shown = []
    dialogs.clear()
    state.tabs = [notes, plan]
})

describe('Export with the editor split', () => {
    it('exports the focused group’s document from the File menu and the palette, once', () => {
        state.groups = splitWithFocus(1)
        const view = render(<TwoGroups />)
        expect(shown.filter((c) => c.id === 'export-pdf')).toHaveLength(1)

        act(() => void shown.find((c) => c.id === 'export-pdf')!.run())
        expect(dialogs.get(plan.path)).toEqual({ open: true })
        expect(dialogs.get(notes.path)).toEqual({ open: false })

        state.groups = splitWithFocus(0)
        view.rerender(<TwoGroups />)
        expect(shown.filter((c) => c.id === 'export-pdf')).toHaveLength(1)
        act(() => void shown.find((c) => c.id === 'export-pdf')!.run())
        expect(dialogs.get(notes.path)).toEqual({ open: true })
    })
})
