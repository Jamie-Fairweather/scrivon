import type { Monaco } from '@monaco-editor/react'
import { act, renderHook } from '@testing-library/react'
import type { editor } from 'monaco-editor'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsProvider, useAppSettings } from '@/components/studio/settings/settings-provider'
import { exampleTabId } from '@/lib/examples/example-tab'
import type { LinkCheckConfig } from '@/lib/monaco/link-check'
import type { DocumentTab, FileNode } from '@/lib/workspace/types'

type Attached = { config: LinkCheckConfig | null; setConfig: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }
const attached: Attached[] = []

vi.mock('@/lib/monaco/link-check', () => ({
    attachLinkCheck: (_editor: unknown, _monaco: unknown, _options: unknown, config: LinkCheckConfig | null) => {
        const session: Attached = { config, setConfig: vi.fn((next: LinkCheckConfig | null) => (session.config = next)), dispose: vi.fn() }
        attached.push(session)
        return session
    },
}))
vi.mock('@/lib/markdown/links-reader', () => ({ getLinksReader: () => ({}) }))

const workspace = vi.hoisted(() => ({
    tree: [] as FileNode[],
    tabs: [] as DocumentTab[],
}))
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useWorkspaceSession: () => ({ workspaceRoot: 'C:\\notes', tree: workspace.tree }),
    useDocumentTabs: () => ({ tabs: workspace.tabs }),
}))

const { useEditorLinkCheck } = await import('./use-editor-link-check')

const URI = 'inmemory://scrivon/document-1'

function tab(name: string, extra: Partial<DocumentTab> = {}): DocumentTab {
    return { id: `C:\\notes\\${name}`, path: `C:\\notes\\${name}`, name, content: '', isDirty: false, isSaving: false, ...extra }
}

function wrapper({ children }: { children: ReactNode }) {
    return <SettingsProvider>{children}</SettingsProvider>
}

function setup(initialTab: DocumentTab | null) {
    const view = renderHook(
        ({ activeTab }: { activeTab: DocumentTab | null }) => ({ attach: useEditorLinkCheck(activeTab, activeTab ? URI : undefined), app: useAppSettings() }),
        { wrapper, initialProps: { activeTab: initialTab } }
    )
    view.result.current.attach({} as editor.IStandaloneCodeEditor, {} as Monaco)
    return view
}

describe('useEditorLinkCheck', () => {
    beforeEach(() => {
        attached.length = 0
        workspace.tree = [{ kind: 'file', name: 'a.md', path: 'C:\\notes\\a.md' }]
        workspace.tabs = [tab('other.md', { content: '# Unsaved' })]
        const store = new Map<string, string>()
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: unknown) => store.set(key, String(value)),
        })
    })

    afterEach(() => vi.unstubAllGlobals())

    it('checks an editable Markdown file against the folder’s tree and the open tabs', () => {
        setup(tab('notes.md'))
        const config = attached[0]!.config!
        expect(config).toMatchObject({ modelUri: URI, documentPath: 'C:\\notes\\notes.md', workspaceRoot: 'C:\\notes' })
        expect(config.index!.entries.has('c:\\notes\\a.md')).toBe(true)
        expect(config.openText('c:/NOTES/Other.md')).toBe('# Unsaved')
    })

    it('leaves diagrams, read-only files and examples alone, and starts once a file can be edited', () => {
        const view = setup(tab('flow.mmd'))
        expect(attached[0]!.config).toBeNull()

        view.rerender({ activeTab: tab('large.md', { readOnly: true }) })
        expect(attached[0]!.config).toBeNull()
        // An example that isn't marked read-only still gets no marks.
        view.rerender({ activeTab: { ...tab('example.md'), id: exampleTabId('markdown') } })
        expect(attached[0]!.config).toBeNull()

        view.rerender({ activeTab: tab('large.md') })
        expect(attached[0]!.config).not.toBeNull()
    })

    it('turns off and on at once with the setting', () => {
        const view = setup(tab('notes.md'))
        act(() => view.result.current.app.updateSettings((s) => ({ ...s, editor: { ...s.editor, checkLinks: false } })))
        expect(attached[0]!.config).toBeNull()
        act(() => view.result.current.app.updateSettings((s) => ({ ...s, editor: { ...s.editor, checkLinks: true } })))
        expect(attached[0]!.config).not.toBeNull()
    })

    it('builds the tree lookup once per tree, not on each edit', () => {
        const view = setup(tab('notes.md'))
        const first = attached[0]!.config!.index
        workspace.tabs = [tab('other.md', { content: '# Edited' })]
        view.rerender({ activeTab: { ...tab('notes.md'), content: 'typed' } })
        // Typing changes the tabs, but the check isn't started again for it.
        expect(attached[0]!.config!.index).toBe(first)
        expect(attached[0]!.setConfig).not.toHaveBeenCalled()
        expect(attached[0]!.config!.openText('C:\\notes\\other.md')).toBe('# Edited')

        workspace.tree = [...workspace.tree, { kind: 'file', name: 'b.md', path: 'C:\\notes\\b.md' }]
        view.rerender({ activeTab: tab('notes.md') })
        expect(attached[0]!.config!.index).not.toBe(first)
        expect(attached[0]!.config!.index!.entries.has('c:\\notes\\b.md')).toBe(true)
    })
})
