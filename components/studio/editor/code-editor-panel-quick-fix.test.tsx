import { act, render, waitFor } from '@testing-library/react'
import { Suspense, lazy, type ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { editor } from 'monaco-editor'
import { APP_EXAMPLES } from '@/lib/examples/app-samples'
import { tabFromExample } from '@/lib/examples/example-tab'
import type { DocumentTab } from '@/lib/workspace/types'

// The real Monaco and @monaco-editor/react this time (code-editor-panel.test.tsx uses a stand-in), because
// whether Ctrl+. works depends on the order in which they change the editor when the tab changes. Only the
// parts these tests need are loaded: the editor, Ctrl+. and its list, and the Markdown and Mermaid languages.
vi.mock('@/lib/monaco/setup-monaco', async () => {
    const monaco = await import('monaco-editor/editor')
    await import('monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js')
    await import('monaco-editor/languages/definitions/markdown/register')
    const { loader } = await import('@monaco-editor/react')
    const { registerMermaidLanguage } = await import('@/lib/monaco/mermaid-language')
    loader.config({ monaco })
    registerMermaidLanguage(monaco)
    return {}
})

vi.mock('next/dynamic', () => ({
    default: (load: () => Promise<ComponentType<Record<string, unknown>> | { default: ComponentType<Record<string, unknown>> }>) => {
        const Lazy = lazy(async () => {
            const loaded = await load()
            return { default: 'default' in loaded ? loaded.default : loaded }
        })
        return function DynamicStandIn(props: Record<string, unknown>) {
            return (
                <Suspense fallback={null}>
                    <Lazy {...props} />
                </Suspense>
            )
        }
    },
}))

const NOTE: DocumentTab = {
    id: '/w/note.md',
    path: '/w/note.md',
    name: 'note.md',
    content: 'This is a helo world.\n',
    isDirty: false,
    isSaving: false,
}
const CHART: DocumentTab = {
    id: '/w/chart.mmd',
    path: '/w/chart.mmd',
    name: 'chart.mmd',
    content: 'flowchart TD\n    A --> B\n',
    isDirty: false,
    isSaving: false,
}
/** Examples open read-only. */
const DIAGRAM_EXAMPLE = tabFromExample(APP_EXAMPLES.find((example) => example.category !== 'markdown')!)
const MISSPELT = 'helo'

let tabs: DocumentTab[] = [NOTE, CHART, DIAGRAM_EXAMPLE]
let activeTabId = NOTE.id
vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({
        tabs,
        activeTabId,
        activeTab: tabs.find((tab) => tab.id === activeTabId) ?? null,
        updateTabContent: () => {},
    }),
    useDocumentTabActions: () => ({ makeTabEditable: () => {} }),
    useWorkspaceCoordinator: () => ({}),
    useWorkspaceSession: () => ({ workspaceRoot: '/w' }),
}))
vi.mock('@/components/studio/workspace/register-coordinator-refs', () => ({ registerCoordinatorRefs: () => {} }))
vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => ({ isLight: true, tokens: {} }) }))
vi.mock('@/lib/theme/monaco-theme', () => ({ MONACO_DIAGRAM_THEME_ID: 'vs', defineMonacoDiagramTheme: () => {} }))
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({
        settings: {
            editor: { fontSize: 13, tabSize: 2, wordWrap: 'on', wordWrapColumn: 80, lineNumbers: 'on', minimap: false, tabMovesFocus: false },
            spellcheck: { enabled: true, language: 'en-GB', words: [] },
        },
        updateSettings: () => {},
    }),
}))
// Pictures and the link to the preview have their own tests, and need more of the page than these do.
vi.mock('@/components/studio/editor/editor-images', () => ({ attachEditorImages: () => ({ dispose: () => {} }), imageDocumentFor: () => null }))
vi.mock('@/components/studio/editor/editor-scroll-sync', () => ({ bindEditorScrollSync: () => ({ dispose: () => {} }) }))

/** A dictionary that only knows "helo" is wrong, and asks to make it "hello". */
const spellcheckClient = {
    check: async (text: string) => {
        const offset = text.indexOf(MISSPELT)
        return offset === -1 ? [] : [{ word: MISSPELT, offset }]
    },
    suggest: async () => ['hello'],
}
vi.mock('@/lib/spellcheck/spellcheck-client', () => ({ getSpellcheckClient: () => spellcheckClient }))

// Points the loader at the Monaco loaded above, so loader.init() below doesn't go to the CDN.
await import('@/lib/monaco/setup-monaco')
const { CodeEditorPanel } = await import('./code-editor-panel')
const { loader } = await import('@monaco-editor/react')

type MonacoApi = typeof import('monaco-editor/editor')

async function mountedEditor(): Promise<{ monaco: MonacoApi; editor: editor.IStandaloneCodeEditor }> {
    const monaco = (await loader.init()) as unknown as MonacoApi
    let found: editor.IStandaloneCodeEditor | undefined
    await waitFor(() => {
        found = monaco.editor.getEditors()[0] as editor.IStandaloneCodeEditor | undefined
        expect(found).toBeDefined()
    })
    return { monaco, editor: found! }
}

/** Shows another tab, and waits for the editor to show its text. */
async function show(view: ReturnType<typeof render>, codeEditor: editor.IStandaloneCodeEditor, tab: DocumentTab) {
    activeTabId = tab.id
    view.rerender(<CodeEditorPanel width={600} onWidthChange={() => {}} />)
    await waitFor(() => expect(codeEditor.getModel()?.getValue()).toBe(tab.content))
}

/** Puts the caret in the misspelt word, presses Ctrl+. and returns what the quick fix list offers. */
async function pressQuickFixOnMisspeltWord(monaco: MonacoApi, codeEditor: editor.IStandaloneCodeEditor, when: string): Promise<string[]> {
    const model = codeEditor.getModel()!
    // The word is underlined once the spell check has run.
    await waitFor(() => expect(monaco.editor.getModelMarkers({ resource: model.uri })).toHaveLength(1))
    const start = model.getPositionAt(model.getValue().indexOf(MISSPELT))
    codeEditor.focus()
    codeEditor.setPosition({ lineNumber: start.lineNumber, column: start.column + 1 })
    const typingArea = codeEditor.getContainerDomNode().querySelector('textarea')!
    act(() => {
        typingArea.dispatchEvent(
            new KeyboardEvent('keydown', { key: '.', code: 'Period', keyCode: 190, ctrlKey: true, bubbles: true, cancelable: true })
        )
    })
    let offered: string[] = []
    await waitFor(() => {
        offered = [...document.querySelectorAll('.action-widget [role="option"] .title')].map((title) => title.textContent ?? '')
        expect(offered, `the quick fix list ${when}`).not.toHaveLength(0)
    })
    act(() => {
        typingArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }))
    })
    return offered
}

describe('CodeEditorPanel quick fixes (Ctrl+.)', () => {
    beforeEach(() => {
        tabs = [NOTE, CHART, DIAGRAM_EXAMPLE]
        activeTabId = NOTE.id
    })

    it('offers the spelling fixes on a Markdown file after a read-only diagram example has been shown, however often the tab changes', async () => {
        const view = render(<CodeEditorPanel width={600} onWidthChange={() => {}} />)
        const { monaco, editor: codeEditor } = await mountedEditor()
        expect(await pressQuickFixOnMisspeltWord(monaco, codeEditor, 'at first')).toContain('Change to “hello”')

        // A diagram file that can be edited, too, and the example more than once.
        for (const other of [DIAGRAM_EXAMPLE, CHART, DIAGRAM_EXAMPLE, DIAGRAM_EXAMPLE]) {
            await show(view, codeEditor, other)
            await show(view, codeEditor, NOTE)
            expect(await pressQuickFixOnMisspeltWord(monaco, codeEditor, `after ${other.name}`)).toContain('Change to “hello”')
        }
        view.unmount()
    })

    it('offers the spelling fixes once a read-only Markdown file is made editable with the file still showing', async () => {
        // Edit as UTF-8, Edit Anyway and a reload all do this: the same tab and file, only read-only goes off.
        tabs = [{ ...NOTE, readOnly: true }, CHART, DIAGRAM_EXAMPLE]
        const view = render(<CodeEditorPanel width={600} onWidthChange={() => {}} />)
        const { monaco, editor: codeEditor } = await mountedEditor()
        const model = codeEditor.getModel()!
        // A read-only file isn't spell checked.
        await waitFor(() => expect(codeEditor.getOption(monaco.editor.EditorOption.readOnly)).toBe(true))
        await waitFor(() => expect(monaco.editor.getModelMarkers({ resource: model.uri })).toHaveLength(0))

        tabs = [NOTE, CHART, DIAGRAM_EXAMPLE]
        view.rerender(<CodeEditorPanel width={600} onWidthChange={() => {}} />)
        await waitFor(() => expect(codeEditor.getOption(monaco.editor.EditorOption.readOnly)).toBe(false))
        expect(codeEditor.getModel()).toBe(model)
        expect(await pressQuickFixOnMisspeltWord(monaco, codeEditor, 'after Edit as UTF-8 in place')).toContain('Change to “hello”')
        view.unmount()
    })
})
