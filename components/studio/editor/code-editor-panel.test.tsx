import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react'
import { Suspense, lazy, type ComponentType } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentTab } from '@/lib/workspace/types'

// --- A small stand-in for Monaco: one text buffer per URI, like the real thing. ---

type Listener = () => void

class FakeUri {
    constructor(private readonly value: string) {}
    toString() {
        return this.value
    }
}

/** Monaco's EndOfLinePreference and EndOfLineSequence values. */
const EOL_PREFERENCE = { TextDefined: 0, LF: 1, CRLF: 2 }
const EOL_SEQUENCE = { LF: 0, CRLF: 1 }

class FakeModel {
    disposed = false
    readonly listeners = new Set<Listener>()
    options: { tabSize?: number; indentSize?: number | 'tabSize'; insertSpaces?: boolean } = {}
    private lines: string[] = []
    /** Like Monaco, one line ending for the whole buffer: the one most line breaks use. */
    eol: '\n' | '\r\n' = '\n'
    constructor(
        value: string,
        public readonly uri: FakeUri
    ) {
        this.value = value
    }
    get value() {
        return this.lines.join(this.eol)
    }
    set value(text: string) {
        this.lines = text.split(/\r\n|\r|\n/)
        const crlf = text.split('\r\n').length - 1
        // With no line break at all, Monaco's default.
        this.eol = crlf > (this.lines.length - 1) / 2 ? '\r\n' : '\n'
    }
    getValue(preference = EOL_PREFERENCE.TextDefined) {
        if (preference === EOL_PREFERENCE.LF) return this.lines.join('\n')
        if (preference === EOL_PREFERENCE.CRLF) return this.lines.join('\r\n')
        return this.value
    }
    setValue(value: string) {
        this.value = value
        this.listeners.forEach((l) => l())
    }
    getEOL() {
        return this.eol
    }
    /** The order of undo-stack calls, so a test can check a change is its own undo step. */
    readonly undoCalls: string[] = []
    pushStackElement() {
        this.undoCalls.push('pushStackElement')
    }
    /** Changes only the line ending, as an undo step (Monaco tells listeners). */
    pushEOL(sequence: number) {
        this.undoCalls.push('pushEOL')
        this.eol = sequence === EOL_SEQUENCE.CRLF ? '\r\n' : '\n'
        this.listeners.forEach((l) => l())
    }
    /** Real Monaco skips the undo stack here, so a later undo garbles the text. Never call it. */
    setEOL(sequence: number) {
        this.undoCalls.push('setEOL')
        this.eol = sequence === EOL_SEQUENCE.CRLF ? '\r\n' : '\n'
        this.listeners.forEach((l) => l())
    }
    dispose() {
        this.disposed = true
        models.delete(this.uri.toString())
    }
    /** Like Monaco's guess: tabs if a line is indented with a tab, otherwise the default. */
    detectIndentation(defaultInsertSpaces: boolean, defaultTabSize: number) {
        const usesTabs = /^\t/m.test(this.value)
        this.updateOptions({ insertSpaces: usesTabs ? false : defaultInsertSpaces, tabSize: defaultTabSize, indentSize: defaultTabSize })
    }
    updateOptions(options: FakeModel['options']) {
        Object.assign(this.options, options)
    }
    getOptions() {
        return { tabSize: this.options.tabSize ?? 4 }
    }
    getLineContent(lineNumber: number) {
        return this.lines[lineNumber - 1] ?? ''
    }
    /** Single-line ranges are enough here. */
    getValueInRange(range: FakeRange) {
        const line = this.lines[range.startLineNumber - 1] ?? ''
        return line.slice(range.startColumn - 1, range.endColumn - 1)
    }
}

type FakeRange = { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

class FakeEditor {
    options: Record<string, unknown>
    private readonly contentListeners = new Set<Listener>()
    private readonly modelListeners = new Set<Listener>()
    private readonly disposeListeners = new Set<Listener>()
    private readonly focusTextListeners = new Set<Listener>()
    private readonly blurTextListeners = new Set<Listener>()
    constructor(
        public model: FakeModel | null,
        options: Record<string, unknown>
    ) {
        this.options = { ...options }
        model?.listeners.add(this.fire)
    }
    private fire = () => this.contentListeners.forEach((l) => l())
    /** True once @monaco-editor/react has hooked up onChange, which happens a render after create. */
    get listening() {
        return this.contentListeners.size > 0
    }
    getModel() {
        return this.model && !this.model.disposed ? this.model : null
    }
    setModel(model: FakeModel | null) {
        this.model?.listeners.delete(this.fire)
        this.model = model
        model?.listeners.add(this.fire)
        this.modelListeners.forEach((l) => l())
    }
    onDidChangeModel(listener: Listener) {
        this.modelListeners.add(listener)
        return { dispose: () => this.modelListeners.delete(listener) }
    }
    getValue() {
        return this.model?.getValue() ?? ''
    }
    /** What a keystroke does: change the buffer and tell listeners. */
    type(text: string) {
        this.model!.setValue(this.model!.getValue() + text)
    }
    onDidChangeModelContent(listener: Listener) {
        this.contentListeners.add(listener)
        return { dispose: () => this.contentListeners.delete(listener) }
    }
    updateOptions(options: Record<string, unknown>) {
        Object.assign(this.options, options)
    }
    getOption() {
        return false
    }
    saveViewState() {
        return null
    }
    restoreViewState() {}
    addCommand() {}
    selection: FakeRange | null = null
    focused = false
    focus() {
        this.focused = true
    }
    revealPositionInCenter() {}
    revealRangeInCenter() {}
    private readonly cursorListeners = new Set<Listener>()
    setSelection(selection: FakeRange) {
        this.selection = selection
        this.cursorListeners.forEach((l) => l())
    }
    getSelection() {
        const range = this.selection
        if (!range) return null
        return { ...range, isEmpty: () => range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn }
    }
    getSelections() {
        const selection = this.getSelection()
        return selection ? [selection] : [{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1, isEmpty: () => true }]
    }
    getPosition() {
        return this.selection ? { lineNumber: this.selection.endLineNumber, column: this.selection.endColumn } : { lineNumber: 1, column: 1 }
    }
    onDidChangeCursorSelection(listener: Listener) {
        this.cursorListeners.add(listener)
        return { dispose: () => this.cursorListeners.delete(listener) }
    }
    onDidChangeModelOptions() {
        return { dispose: () => {} }
    }
    onDidDispose(listener: Listener) {
        this.disposeListeners.add(listener)
        return { dispose: () => this.disposeListeners.delete(listener) }
    }
    onDidFocusEditorText(listener: Listener) {
        this.focusTextListeners.add(listener)
        return { dispose: () => this.focusTextListeners.delete(listener) }
    }
    onDidBlurEditorText(listener: Listener) {
        this.blurTextListeners.add(listener)
        return { dispose: () => this.blurTextListeners.delete(listener) }
    }
    /** What clicking into the text, or tabbing to it, does. */
    focusText() {
        this.focusTextListeners.forEach((l) => l())
    }
    blurText() {
        this.blurTextListeners.forEach((l) => l())
    }
    dispose() {
        this.setModel(null)
        this.disposeListeners.forEach((l) => l())
    }
}

const models = new Map<string, FakeModel>()
const editors: FakeEditor[] = []

const fakeMonaco = {
    Uri: { parse: (value: string) => new FakeUri(value) },
    KeyCode: { F1: 59 },
    KeyMod: { CtrlCmd: 2048 },
    editor: {
        EndOfLinePreference: EOL_PREFERENCE,
        EndOfLineSequence: EOL_SEQUENCE,
        EditorOption: { readOnly: 0 },
        create: (_container: HTMLElement, options: { model: FakeModel } & Record<string, unknown>) => {
            const editor = new FakeEditor(options.model, options)
            editors.push(editor)
            return editor
        },
        createModel: (value: string, _language: string, uri: FakeUri) => {
            const model = new FakeModel(value, uri)
            models.set(uri.toString(), model)
            return model
        },
        getModel: (uri: FakeUri) => models.get(uri.toString()) ?? null,
        getModels: () => [...models.values()],
        setTheme: () => {},
        defineTheme: () => {},
        setModelLanguage: () => {},
        onDidChangeMarkers: () => ({ dispose: () => {} }),
        remeasureFonts: vi.fn(),
        /** Monaco's shared command registry; each call returns its own disposable, to check the panel lets go. */
        registerCommand: vi.fn<(id: string, handler: (accessor: unknown) => void) => { dispose: () => void }>(() => ({ dispose: vi.fn() })),
        addKeybindingRule: () => ({ dispose: () => {} }),
    },
}

// The real @monaco-editor/react picks up window.monaco when the loader has no bundled copy.
;(window as unknown as { monaco: unknown }).monaco = fakeMonaco

// --- Module mocks ---

// Skip loading the real bundled Monaco; the fake above stands in for it.
vi.mock('@/lib/monaco/setup-monaco', () => ({}))

/** Monaco's shared "Tab moves focus" switch; Ctrl+M calls setTabFocusMode with the opposite. */
const tabFocus = {
    mode: false,
    listeners: new Set<(mode: boolean) => void>(),
    getTabFocusMode: () => tabFocus.mode,
    setTabFocusMode: vi.fn((mode: boolean) => {
        tabFocus.mode = mode
        tabFocus.listeners.forEach((l) => l(mode))
    }),
    onDidChangeTabFocus: (listener: (mode: boolean) => void) => {
        tabFocus.listeners.add(listener)
        return { dispose: () => tabFocus.listeners.delete(listener) }
    },
}
vi.mock('@/lib/monaco/tab-focus', () => ({ TabFocus: tabFocus }))

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

type TabsState = { tabs: DocumentTab[]; activeTabId: string | null }
let tabsState: TabsState = { tabs: [], activeTabId: null }
const updateTabContent = vi.fn()
const makeTabEditable = vi.fn()

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({
        tabs: tabsState.tabs,
        activeTabId: tabsState.activeTabId,
        activeTab: tabsState.tabs.find((t) => t.id === tabsState.activeTabId) ?? null,
        updateTabContent,
    }),
    useDocumentTabActions: () => ({ makeTabEditable }),
    useWorkspaceCoordinator: () => ({}),
}))

type RevealInEditor = (path: string, line: number, column: number, length?: number) => void
const coordinatorHandlers: {
    revealInEditor?: RevealInEditor
    getEditorSelectedText?: () => string | null
    replaceEditorText?: (tabId: string, text: string) => void
} = {}
vi.mock('@/components/studio/workspace/register-coordinator-refs', () => ({
    registerCoordinatorRefs: (_refs: unknown, handlers: typeof coordinatorHandlers) => Object.assign(coordinatorHandlers, handlers),
}))
type ThemeState = { isLight: boolean; tokens: Record<string, string> }
const LIGHT_THEME: ThemeState = { isLight: true, tokens: { name: 'light' } }
let theme = LIGHT_THEME
const defineMonacoDiagramTheme = vi.fn()

vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => theme }))
vi.mock('@/lib/theme/monaco-theme', () => ({ MONACO_DIAGRAM_THEME_ID: 'test-theme', defineMonacoDiagramTheme }))
const DEFAULT_EDITOR_SETTINGS = {
    fontSize: 13,
    tabSize: 2,
    wordWrap: 'on',
    wordWrapColumn: 80,
    lineNumbers: 'on',
    minimap: false,
    tabMovesFocus: false,
}
let editorSettings = DEFAULT_EDITOR_SETTINGS
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { editor: editorSettings } }),
}))
const palette = { open: vi.fn(), provided: true }
vi.mock('@/components/studio/command-palette/command-palette-provider', () => ({
    useOptionalCommandPalette: () => (palette.provided ? { open: palette.open } : null),
}))

const { CodeEditorPanel } = await import('@/components/studio/editor/code-editor-panel')
const { focusEditorFor } = await import('@/components/studio/editor/editor-focus')
const { useEditorCursor } = await import('@/components/studio/editor/editor-cursor')
const { default: monacoLoader } = await import('@monaco-editor/loader')

function tab(path: string, content: string): DocumentTab {
    return { id: path, path, name: path.split('/').pop()!, content, isDirty: false, isSaving: false }
}

function Panel({ open = true }: { open?: boolean }) {
    return <CodeEditorPanel open={open} width={400} onWidthChange={() => {}} />
}

async function mountEditor() {
    const view = render(<Panel />)
    await waitFor(() => expect(editors[0]?.listening).toBe(true))
    expect(editors).toHaveLength(1)
    return { view, editor: editors[0]! }
}

function setTabs(view: ReturnType<typeof render>, next: TabsState) {
    tabsState = next
    view.rerender(<Panel />)
}

beforeEach(() => {
    models.clear()
    editors.length = 0
    updateTabContent.mockReset()
    makeTabEditable.mockReset()
    defineMonacoDiagramTheme.mockClear()
    theme = LIGHT_THEME
    editorSettings = DEFAULT_EDITOR_SETTINGS
    tabsState = { tabs: [], activeTabId: null }
    tabFocus.mode = false
    tabFocus.setTabFocusMode.mockClear()
    fakeMonaco.editor.registerCommand.mockClear()
    palette.open = vi.fn()
    palette.provided = true
})

describe('CodeEditorPanel models', () => {
    it('shows the file as it is now when a closed tab is reopened, and saves edits on top of it', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, '# A version 1'), tab(b, '# B')], activeTabId: a }
        const { view, editor } = await mountEditor()

        act(() => editor.type(' local'))
        expect(updateTabContent).toHaveBeenLastCalledWith(a, '# A version 1 local')

        // Close a.md while b.md stays open, so the editor stays mounted.
        setTabs(view, { tabs: [tab(b, '# B')], activeTabId: b })
        // a.md changes on disk, then is opened again.
        setTabs(view, { tabs: [tab(b, '# B'), tab(a, '# A version 2 (external edit)')], activeTabId: a })

        expect(editor.getValue()).toBe('# A version 2 (external edit)')
        act(() => editor.type('x'))
        expect(updateTabContent).toHaveBeenLastCalledWith(a, '# A version 2 (external edit)x')
    })

    it('frees the buffer of a closed tab', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A'), tab(b, 'B')], activeTabId: a }
        const { view, editor } = await mountEditor()
        const modelA = editor.getModel()!

        setTabs(view, { tabs: [tab(b, 'B')], activeTabId: b })

        expect(modelA.disposed).toBe(true)
        expect(editor.getValue()).toBe('B')
    })

    it('does not mark the tab dirty when it replaces a buffer that disagrees with the tab', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'on disk')], activeTabId: a }
        const { view, editor } = await mountEditor()
        const b = '/w/b.md'
        setTabs(view, { tabs: [tab(a, 'on disk'), tab(b, 'B')], activeTabId: b })

        // Something left a.md's buffer out of step with its tab (e.g. a file reloaded from disk).
        const modelA = [...models.values()].find((m) => m.getValue() === 'on disk')!
        modelA.value = 'stale buffer'
        setTabs(view, { tabs: [tab(a, 'on disk'), tab(b, 'B')], activeTabId: a })

        expect(editor.getValue()).toBe('on disk')
        expect(updateTabContent).not.toHaveBeenCalled()
    })

    it("shows the tab's new text when it changes under the same buffer, and saves edits on top of it", async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'v1 text')], activeTabId: a }
        const { view, editor } = await mountEditor()
        act(() => editor.type(' typed'))
        setTabs(view, { tabs: [tab(a, 'v1 text typed')], activeTabId: a })
        expect(editor.getValue()).toBe('v1 text typed')

        // The same folder closed and reopened in one render: same path and buffer, newer text.
        setTabs(view, { tabs: [tab(a, 'v2 text from disk')], activeTabId: a })

        expect(editor.getValue()).toBe('v2 text from disk')
        act(() => editor.type('!'))
        expect(updateTabContent).toHaveBeenLastCalledWith(a, 'v2 text from disk!')
    })

    it('follows the new tab when a folder switch looks like a rename and keeps the buffer', async () => {
        const v1 = 'C:\\proj-v1\\notes.md'
        const v2 = 'C:\\proj-v2\\notes.md'
        tabsState = { tabs: [tab(v1, 'notes v1')], activeTabId: v1 }
        const { view, editor } = await mountEditor()
        const model = editor.getModel()

        setTabs(view, { tabs: [tab(v2, 'notes v2')], activeTabId: v2 })

        // Read as a rename, so the buffer is kept, but it now holds proj-v2's text.
        expect(editor.getModel()).toBe(model)
        expect(editor.getValue()).toBe('notes v2')
        act(() => editor.type('!'))
        expect(updateTabContent).toHaveBeenLastCalledWith(v2, 'notes v2!')
    })

    it.each([
        ['CRLF to LF', 'one\r\ntwo\r\n', 'one\ntwo\n'],
        ['LF to CRLF', 'one\ntwo\n', 'one\r\ntwo\r\n'],
    ])('takes on line endings another program changed (%s), so the next edit keeps them', async (_, before, after) => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, before)], activeTabId: a }
        const { view, editor } = await mountEditor()
        const model = editor.getModel()!

        // The file was reloaded from disk: the same text with other line endings, and still clean.
        setTabs(view, { tabs: [tab(a, after)], activeTabId: a })
        expect(updateTabContent).not.toHaveBeenCalled()
        // The buffer (and its undo history) is kept.
        expect(editor.getModel()).toBe(model)
        // The change is its own undo step. setEOL would leave the undo history counting the old line
        // endings, and Ctrl+Z would then put earlier edits in the wrong place.
        expect(model.undoCalls).toEqual(['pushStackElement', 'pushEOL', 'pushStackElement'])

        act(() => editor.type('x'))
        expect(updateTabContent).toHaveBeenLastCalledWith(a, `${after}x`)
    })

    it('takes on changed line endings when switching back to a tab whose file was reloaded', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'one\r\ntwo'), tab(b, 'B')], activeTabId: a }
        const { view, editor } = await mountEditor()
        setTabs(view, { tabs: [tab(a, 'one\r\ntwo'), tab(b, 'B')], activeTabId: b })

        setTabs(view, { tabs: [tab(a, 'one\ntwo'), tab(b, 'B')], activeTabId: b })
        setTabs(view, { tabs: [tab(a, 'one\ntwo'), tab(b, 'B')], activeTabId: a })
        expect(editor.getModel()!.undoCalls).toEqual(['pushStackElement', 'pushEOL', 'pushStackElement'])

        act(() => editor.type('!'))
        expect(updateTabContent).toHaveBeenLastCalledWith(a, 'one\ntwo!')
    })

    it('keeps the buffer of a file with mixed line endings when switching tabs', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        const mixed = 'one\r\ntwo\nthree\r\n'
        tabsState = { tabs: [tab(a, mixed), tab(b, 'B')], activeTabId: a }
        const { view, editor } = await mountEditor()
        const model = editor.getModel()!
        const setValue = vi.spyOn(model, 'setValue')

        setTabs(view, { tabs: [tab(a, mixed), tab(b, 'B')], activeTabId: b })
        setTabs(view, { tabs: [tab(a, mixed), tab(b, 'B')], activeTabId: a })

        // Monaco evened the endings out on purpose; replacing the buffer would wipe its undo history.
        expect(editor.getModel()).toBe(model)
        expect(setValue).not.toHaveBeenCalled()
        expect(model.undoCalls).toEqual([])
        expect(updateTabContent).not.toHaveBeenCalled()
    })

    it('does not undo keystrokes the tab has not shown yet', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        act(() => {
            editor.type('1')
            editor.type('2')
        })
        // A render that has only caught up with the first keystroke.
        setTabs(view, { tabs: [tab(a, 'A1')], activeTabId: a })
        expect(editor.getValue()).toBe('A12')
        setTabs(view, { tabs: [tab(a, 'A12')], activeTabId: a })
        expect(editor.getValue()).toBe('A12')
        expect(updateTabContent).toHaveBeenLastCalledWith(a, 'A12')
    })

    it('puts text reloaded from disk into the editor at once, so a key pressed before the screen draws edits it', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'my text'), tab(b, 'B')], activeTabId: a }
        const { view, editor } = await mountEditor()

        // Another app saved a.md and its tab took the new text, but the screen hasn't drawn again yet.
        act(() => coordinatorHandlers.replaceEditorText!(a, 'their text'))
        expect(editor.getValue()).toBe('their text')
        expect(updateTabContent).not.toHaveBeenCalled()
        act(() => editor.type('!'))
        expect(updateTabContent).toHaveBeenLastCalledWith(a, 'their text!')

        setTabs(view, { tabs: [tab(a, 'their text!'), tab(b, 'B')], activeTabId: a })
        expect(editor.getValue()).toBe('their text!')

        // A tab that isn't on screen catches up when it is shown.
        act(() => coordinatorHandlers.replaceEditorText!(b, 'B from disk'))
        expect(editor.getValue()).toBe('their text!')
    })
})

describe('CodeEditorPanel accessibility', () => {
    it('names the editor after the open file and says how to leave it', async () => {
        const a = '/w/a.md'
        const b = '/w/b.mmd'
        tabsState = { tabs: [tab(a, 'A'), tab(b, 'B')], activeTabId: a }
        const { view, editor } = await mountEditor()
        expect(editor.options.ariaLabel).toMatch(/^a\.md, Markdown editor\. Press Control\+M/)

        setTabs(view, { tabs: [tab(a, 'A'), tab(b, 'B')], activeTabId: b })
        expect(editor.options.ariaLabel).toMatch(/^b\.mmd, Mermaid editor\./)
    })
})

describe('CodeEditorPanel caret for the status bar', () => {
    it('reports where the caret is and what is selected, until the editor goes away', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'hello world')], activeTabId: a }
        const cursor = renderHook(() => useEditorCursor())
        const { view, editor } = await mountEditor()
        expect(cursor.result.current).toEqual({ line: 1, column: 1, selectedText: '' })

        act(() => editor.setSelection({ startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 }))
        expect(cursor.result.current).toEqual({ line: 1, column: 12, selectedText: 'world' })

        // The last tab closed: the editor is thrown away.
        setTabs(view, { tabs: [], activeTabId: null })
        expect(cursor.result.current).toBeNull()
    })
})

describe('CodeEditorPanel read-only reason', () => {
    it('says above the editor why a file is read-only, and lets the user edit it as UTF-8', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [{ ...tab(a, 'café'), readOnly: true, encodingIssue: 'legacy-encoding' }], activeTabId: a }
        // A read-only tab takes no edits, so wait for the editor itself rather than its change listener.
        const view = render(<Panel />)
        await waitFor(() => expect(editors).toHaveLength(1))

        const bar = view.getByRole('status')
        expect(bar).toHaveTextContent('Read-only.')
        expect(bar).toHaveTextContent("It isn't saved as UTF-8")
        expect(view.container.querySelector('[data-slot="code-editor"]')?.firstElementChild).toBe(bar)

        const editor = editors[0]!
        expect(editor.focused).toBe(false)
        fireEvent.click(view.getByRole('button', { name: 'Edit as UTF-8' }))
        expect(makeTabEditable).toHaveBeenCalledWith(a)

        // The tab can now be edited, so the bar and the button that had the keyboard are gone; the
        // keyboard goes to the editor rather than dropping to the page.
        setTabs(view, { tabs: [tab(a, 'café')], activeTabId: a })
        expect(view.queryByRole('status')).not.toBeInTheDocument()
        await waitFor(() => expect(editor.focused).toBe(true))
    })

    it('shows no bar for a file that can be edited', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view } = await mountEditor()
        expect(view.queryByRole('status')).not.toBeInTheDocument()
    })
})

describe('CodeEditorPanel right-click Command Palette', () => {
    /** What the editor's right-click 'Command Palette' runs: the newest command registered under Monaco's id. */
    function quickCommand() {
        const { calls, results } = fakeMonaco.editor.registerCommand.mock
        expect(calls.at(-1)?.[0]).toBe('editor.action.quickCommand')
        return { run: calls.at(-1)![1], registration: results.at(-1)!.value as { dispose: () => void } }
    }

    it("opens the app's palette instead of Monaco's own command list", async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view } = await mountEditor()
        const first = palette.open

        quickCommand().run(undefined)
        expect(first).toHaveBeenCalledTimes(1)

        // A newer open function from the provider is the one used, without setting the editor up again.
        palette.open = vi.fn()
        view.rerender(<Panel />)
        quickCommand().run(undefined)
        expect(palette.open).toHaveBeenCalledTimes(1)
        expect(first).toHaveBeenCalledTimes(1)
        expect(fakeMonaco.editor.registerCommand).toHaveBeenCalledTimes(1)
    })

    it('still shows the editor with no palette above it, and then the entry does nothing', async () => {
        palette.provided = false
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        await mountEditor()

        expect(() => quickCommand().run(undefined)).not.toThrow()
        expect(palette.open).not.toHaveBeenCalled()
    })

    it('gives the command back to Monaco when the editor is thrown away', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()
        const { registration } = quickCommand()
        expect(registration.dispose).not.toHaveBeenCalled()

        act(() => editor.dispose())
        expect(registration.dispose).toHaveBeenCalled()
    })
})

describe('CodeEditorPanel Tab key', () => {
    const hint = (view: ReturnType<typeof render>) => view.container.querySelector('[data-slot="editor-tab-focus-hint"]')

    it("turns on Monaco's Tab moves focus mode from the setting, and follows Ctrl+M after that", async () => {
        editorSettings = { ...DEFAULT_EDITOR_SETTINGS, tabMovesFocus: true }
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view, editor } = await mountEditor()
        await waitFor(() => expect(tabFocus.setTabFocusMode).toHaveBeenLastCalledWith(true))
        await waitFor(() => expect(editor.options.ariaLabel).toMatch(/The Tab key moves focus\. Press Control\+M to make it indent again\.$/))

        // Ctrl+M in the editor: Tab indents again until the next switch, and the setting stays.
        act(() => tabFocus.setTabFocusMode(false))
        expect(editor.options.ariaLabel).toMatch(/Press Control\+M to make the Tab key move focus instead of indenting\.$/)
        expect(tabFocus.setTabFocusMode).toHaveBeenCalledTimes(2)

        // Turning the setting off sets the mode again.
        act(() => tabFocus.setTabFocusMode(true))
        editorSettings = { ...DEFAULT_EDITOR_SETTINGS, tabMovesFocus: false }
        view.rerender(<Panel />)
        await waitFor(() => expect(tabFocus.setTabFocusMode).toHaveBeenLastCalledWith(false))
        expect(tabFocus.mode).toBe(false)
    })

    it('leaves Tab indenting by default', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        await mountEditor()
        await waitFor(() => expect(tabFocus.setTabFocusMode).toHaveBeenLastCalledWith(false))
    })

    it('says on screen how to leave the editor while it has focus', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view, editor } = await mountEditor()
        await waitFor(() => expect(tabFocus.setTabFocusMode).toHaveBeenCalled())
        expect(hint(view)).toBeNull()

        act(() => editor.focusText())
        expect(hint(view)?.textContent).toBe('Ctrl+M: Tab moves focus')
        // Screen readers get this from the editor's name instead.
        expect(hint(view)?.getAttribute('aria-hidden')).toBe('true')

        act(() => tabFocus.setTabFocusMode(true))
        expect(hint(view)?.textContent).toBe('Tab moves focus · Ctrl+M to indent')

        act(() => editor.blurText())
        expect(hint(view)).toBeNull()
    })

    it("hides the hint after a few seconds, so it doesn't sit over the text while typing", async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view, editor } = await mountEditor()
        await waitFor(() => expect(tabFocus.setTabFocusMode).toHaveBeenCalled())
        vi.useFakeTimers()
        try {
            act(() => editor.focusText())
            act(() => vi.advanceTimersByTime(4900))
            expect(hint(view)).not.toBeNull()
            act(() => vi.advanceTimersByTime(100))
            expect(hint(view)).toBeNull()

            // Ctrl+M shows it again with the new mode, for a while.
            act(() => tabFocus.setTabFocusMode(true))
            expect(hint(view)?.textContent).toBe('Tab moves focus · Ctrl+M to indent')
            act(() => vi.advanceTimersByTime(5000))
            expect(hint(view)).toBeNull()

            // So does coming back to the editor.
            act(() => editor.blurText())
            act(() => editor.focusText())
            expect(hint(view)).not.toBeNull()
            act(() => vi.advanceTimersByTime(5000))
            expect(hint(view)).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('CodeEditorPanel unicode highlighting', () => {
    it('does not box ordinary non-Latin text, but shows invisible characters in diagrams', async () => {
        const a = '/w/a.md'
        const b = '/w/b.mmd'
        tabsState = { tabs: [tab(a, 'Я і ти'), tab(b, 'B')], activeTabId: a }
        const { view, editor } = await mountEditor()
        expect(editor.options.unicodeHighlight).toEqual({ ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false })

        setTabs(view, { tabs: [tab(a, 'Я і ти'), tab(b, 'B')], activeTabId: b })
        expect(editor.options.unicodeHighlight).toEqual({ ambiguousCharacters: false, invisibleCharacters: true, nonBasicASCII: false })
    })

    it('leaves Unicode line and paragraph separators in the file instead of removing them', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'from a PDF next end')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()
        expect(editor.options.unusualLineTerminators).toBe('off')
    })

    it('selects the word on double-click, even next to a bracket or quote', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'See [the docs](https://example.com) and "this".')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()
        expect(editor.options.doubleClickSelectsBlock).toBe(false)
    })
})

describe('CodeEditorPanel suggestions', () => {
    it('offers no word suggestions while writing, and Enter never accepts one', async () => {
        tabsState = { tabs: [tab('/w/notes.md', 'then there'), tab('/w/other.md', 'theory')], activeTabId: '/w/notes.md' }
        const { editor } = await mountEditor()
        expect(editor.options).toMatchObject({
            quickSuggestions: false,
            wordBasedSuggestions: 'off',
            suggestOnTriggerCharacters: false,
            acceptSuggestionOnEnter: 'off',
        })
    })
})

describe('CodeEditorPanel keeps editing state', () => {
    it('keeps the buffer (and its undo history) when the open file is renamed', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()
        act(() => editor.type(' edited'))
        const model = editor.getModel()

        const c = '/w/c.md'
        setTabs(view, { tabs: [tab(c, 'A edited')], activeTabId: c })

        expect(editor.getModel()).toBe(model)
        expect(model!.disposed).toBe(false)
        act(() => editor.type('!'))
        expect(updateTabContent).toHaveBeenLastCalledWith(c, 'A edited!')
    })

    it('keeps the editor and its buffer when the editor pane is hidden and shown again', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()
        const model = editor.getModel()
        const panel = view.container.firstElementChild as HTMLElement

        view.rerender(<Panel open={false} />)
        // Out of sight and out of reach, but keeping its size, so Monaco doesn't re-lay it out.
        expect(panel).toHaveClass('invisible', 'absolute')
        expect(panel).not.toHaveClass('hidden')
        expect(panel).toHaveAttribute('inert')
        expect(panel.style.width).toBe('400px')
        view.rerender(<Panel open />)

        expect(panel).not.toHaveClass('invisible')
        expect(panel).not.toHaveAttribute('inert')
        expect(editors).toHaveLength(1)
        expect(editor.getModel()).toBe(model)
        expect(model!.disposed).toBe(false)
    })
})

describe('CodeEditorPanel width', () => {
    it('shows a saved width that no longer fits narrower, leaving room for the preview', () => {
        const callbacks: ResizeObserverCallback[] = []
        const original = globalThis.ResizeObserver
        globalThis.ResizeObserver = class {
            constructor(callback: ResizeObserverCallback) {
                callbacks.push(callback)
            }
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver
        try {
            const view = render(<CodeEditorPanel width={1500} onWidthChange={() => {}} />)
            const panel = view.container.firstElementChild as HTMLElement
            expect(panel.style.width).toBe('1500px')

            act(() => callbacks.forEach((cb) => cb([{ contentRect: { width: 1110 } } as ResizeObserverEntry], {} as ResizeObserver)))
            expect(panel.style.width).toBe('666px')

            act(() => callbacks.forEach((cb) => cb([{ contentRect: { width: 3000 } } as ResizeObserverEntry], {} as ResizeObserver)))
            expect(panel.style.width).toBe('1500px')
        } finally {
            globalThis.ResizeObserver = original
        }
    })
})

describe('CodeEditorPanel scrolling', () => {
    it('shows a horizontal scrollbar when long lines are not wrapped', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()
        expect(editor.options.scrollbar).toMatchObject({ horizontal: 'auto' })
    })

    it('wraps at the Wrap column setting, also when it changes', async () => {
        editorSettings = { ...DEFAULT_EDITOR_SETTINGS, wordWrap: 'wordWrapColumn', wordWrapColumn: 60 }
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view, editor } = await mountEditor()
        expect(editor.options).toMatchObject({ wordWrap: 'wordWrapColumn', wordWrapColumn: 60 })

        editorSettings = { ...editorSettings, wordWrapColumn: 100 }
        view.rerender(<Panel />)
        expect(editor.options.wordWrapColumn).toBe(100)
    })
})

describe('CodeEditorPanel resize handle', () => {
    function renderPanel() {
        const onWidthChange = vi.fn()
        const view = render(<CodeEditorPanel width={400} onWidthChange={onWidthChange} />)
        const handle = view.getByRole('separator', { name: 'Resize editor' })
        const panel = view.container.firstElementChild as HTMLElement
        return { onWidthChange, handle, panel }
    }

    it('resizes only with the main button, and saves the width once when the drag ends', () => {
        const { onWidthChange, handle, panel } = renderPanel()

        fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 400 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 500 })
        expect(panel.style.width).toBe('400px')

        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 480 })
        expect(panel.style.width).toBe('480px')
        expect(onWidthChange).not.toHaveBeenCalled()

        fireEvent.pointerUp(handle, { pointerId: 1, clientX: 480 })
        fireEvent.lostPointerCapture(handle, { pointerId: 1 })
        expect(onWidthChange).toHaveBeenCalledTimes(1)
        expect(onWidthChange).toHaveBeenCalledWith(480)
    })

    it('stops following the pointer when the drag is cancelled', () => {
        const { onWidthChange, handle, panel } = renderPanel()

        fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 400 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 })
        fireEvent.pointerCancel(handle, { pointerId: 1 })
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 600 })

        expect(onWidthChange).toHaveBeenCalledTimes(1)
        expect(onWidthChange).toHaveBeenCalledWith(450)
        // The parent did not apply the new width, so the panel shows the prop again.
        expect(panel.style.width).toBe('400px')
    })
})

describe('CodeEditorPanel resize handle from the keyboard', () => {
    function renderPanel(width = 400) {
        const onWidthChange = vi.fn()
        const onResetWidth = vi.fn()
        const view = render(<CodeEditorPanel width={width} onWidthChange={onWidthChange} onResetWidth={onResetWidth} />)
        const handle = view.getByRole('separator', { name: 'Resize editor' })
        return { onWidthChange, onResetWidth, handle }
    }

    it('can be focused and says how wide the editor is', () => {
        const { handle } = renderPanel()
        // happy-dom's window is 1024px wide: the editor may take 60% of it.
        expect(handle).toHaveAttribute('tabindex', '0')
        expect(handle).toHaveAttribute('aria-valuenow', '400')
        expect(handle).toHaveAttribute('aria-valuemin', '280')
        expect(handle).toHaveAttribute('aria-valuemax', '614')
        expect(handle).toHaveAttribute('aria-valuetext', '400 pixels wide')
    })

    it('resizes with the arrow keys, Home and End', () => {
        const { onWidthChange, handle } = renderPanel()

        fireEvent.keyDown(handle, { key: 'ArrowRight' })
        expect(onWidthChange).toHaveBeenLastCalledWith(416)
        fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })
        expect(onWidthChange).toHaveBeenLastCalledWith(336)
        fireEvent.keyDown(handle, { key: 'Home' })
        expect(onWidthChange).toHaveBeenLastCalledWith(280)
        fireEvent.keyDown(handle, { key: 'End' })
        expect(onWidthChange).toHaveBeenLastCalledWith(614)
    })

    it('does not save a width that would not change anything', () => {
        const { onWidthChange, handle } = renderPanel(280)
        fireEvent.keyDown(handle, { key: 'ArrowLeft' })
        fireEvent.keyDown(handle, { key: 'Home' })
        expect(onWidthChange).not.toHaveBeenCalled()
    })

    it('resets to the default width with Enter or a double-click', () => {
        const { onResetWidth, handle } = renderPanel()
        fireEvent.keyDown(handle, { key: 'Enter' })
        fireEvent.doubleClick(handle)
        expect(onResetWidth).toHaveBeenCalledTimes(2)
    })
})

describe('CodeEditorPanel theme', () => {
    it('starts in the current theme when the theme changes while Monaco is still loading', async () => {
        let finishLoading!: (monaco: unknown) => void
        const loading = new Promise((resolve) => {
            finishLoading = resolve
        })
        const init = vi.spyOn(monacoLoader, 'init').mockReturnValueOnce(Object.assign(loading, { cancel: () => {} }) as never)
        try {
            tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
            const view = render(<Panel />)
            await waitFor(() => expect(init).toHaveBeenCalled())

            const dark: ThemeState = { isLight: false, tokens: { name: 'dark' } }
            theme = dark
            view.rerender(<Panel />)
            await act(async () => finishLoading(fakeMonaco))
            await waitFor(() => expect(editors).toHaveLength(1))

            expect(defineMonacoDiagramTheme).toHaveBeenLastCalledWith(fakeMonaco, dark.tokens, false)
        } finally {
            init.mockRestore()
        }
    })

    it('follows theme changes once the editor is showing', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view } = await mountEditor()

        const dark: ThemeState = { isLight: false, tokens: { name: 'dark' } }
        theme = dark
        view.rerender(<Panel />)

        expect(defineMonacoDiagramTheme).toHaveBeenLastCalledWith(fakeMonaco, dark.tokens, false)
    })
})

describe('CodeEditorPanel search hits', () => {
    it('selects the matched text when jumping to a hit in the open file', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'one\nsee TODO here')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()

        act(() => coordinatorHandlers.revealInEditor!('/w/a.md', 2, 5, 4))

        expect(editor.selection).toEqual({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 9 })
        expect(editor.focused).toBe(true)
    })

    it('selects the hit in the file the palette just opened, before the panel has shown it', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { editor } = await mountEditor()

        // The open has finished but the panel hasn't drawn its tab yet; the jump's render shows both.
        act(() => {
            tabsState = { tabs: [tab(a, 'A'), tab(b, 'x\ny\n find me')], activeTabId: b }
            coordinatorHandlers.revealInEditor!(b, 3, 2, 6)
        })
        expect(editor.getValue()).toBe('x\ny\n find me')
        expect(editor.selection).toEqual({ startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 })
        expect(editor.focused).toBe(true)
    })

    it('selects the hit once its file is the active tab', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        setTabs(view, { tabs: [tab(a, 'A'), tab(b, 'x\ny\n find me')], activeTabId: b })
        act(() => coordinatorHandlers.revealInEditor!(b, 3, 2, 6))
        expect(editor.selection).toEqual({ startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 })
    })

    it("forgets a hit whose file didn't open, so opening it by hand later leaves the cursor and focus alone", async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        // b.md couldn't be read (or the open lost to a newer one), so a.md still shows.
        act(() => coordinatorHandlers.revealInEditor!(b, 3, 2, 6))
        expect(editor.selection).toBeNull()

        // Later b.md is opened from the explorer, where the keyboard is meant to stay.
        setTabs(view, { tabs: [tab(a, 'A'), tab(b, 'x\ny\n find me')], activeTabId: b })
        expect(editor.selection).toBeNull()
        expect(editor.focused).toBe(false)
    })

    it('forgets the hit when another file shows before it, even if the hit was for a file showing later', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        const c = '/w/c.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        act(() => coordinatorHandlers.revealInEditor!(b, 3, 2, 6))
        setTabs(view, { tabs: [tab(a, 'A'), tab(c, 'C')], activeTabId: c })
        setTabs(view, { tabs: [tab(a, 'A'), tab(c, 'C'), tab(b, 'x\ny\n find me')], activeTabId: b })

        expect(editor.selection).toBeNull()
        expect(editor.focused).toBe(false)
    })

    it.each([
        ['letter case', String.raw`C:\w\Notes.md`],
        ['separators', 'C:/w/notes.md'],
    ])('finds the tab when the hit spells its path with different %s', async (_, hitPath) => {
        const path = String.raw`C:\w\notes.md`
        tabsState = { tabs: [tab(path, 'one\nsee TODO here')], activeTabId: path }
        const { editor } = await mountEditor()

        act(() => coordinatorHandlers.revealInEditor!(hitPath, 2, 5, 4))

        expect(editor.selection).toEqual({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 9 })
        expect(editor.focused).toBe(true)
    })

    it('selects the hit in the new editor when no tab was open', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor: first } = await mountEditor()

        // Closing the last tab throws the editor away; the hit's file then opens in a new one.
        setTabs(view, { tabs: [], activeTabId: null })
        setTabs(view, { tabs: [tab(b, 'x\ny\n find me')], activeTabId: b })
        act(() => coordinatorHandlers.revealInEditor!(b, 3, 2, 6))

        await waitFor(() => expect(editors).toHaveLength(2))
        const second = editors[1]!
        expect(second).not.toBe(first)
        expect(second.selection).toEqual({ startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 })
        expect(second.focused).toBe(true)
    })

    it('waits for the hidden editor to be shown before selecting the hit, so it can take focus', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'one\nsee TODO here')], activeTabId: a }
        const { view, editor } = await mountEditor()
        view.rerender(<Panel open={false} />)

        // The palette shows the editor and jumps in one go, before the editor is showing.
        act(() => coordinatorHandlers.revealInEditor!(a, 2, 5, 4))
        expect(editor.selection).toBeNull()
        expect(editor.focused).toBe(false)

        view.rerender(<Panel open />)
        expect(editor.selection).toEqual({ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 9 })
        expect(editor.focused).toBe(true)
    })

    it('gives the palette no selected text while the editor is hidden', async () => {
        const a = '/w/a.md'
        tabsState = { tabs: [tab(a, 'one\nsee TODO here')], activeTabId: a }
        const { view } = await mountEditor()
        act(() => coordinatorHandlers.revealInEditor!(a, 2, 5, 4))
        expect(coordinatorHandlers.getEditorSelectedText!()).toBe('TODO')

        view.rerender(<Panel open={false} />)
        expect(coordinatorHandlers.getEditorSelectedText!()).toBeNull()

        view.rerender(<Panel open />)
        expect(coordinatorHandlers.getEditorSelectedText!()).toBe('TODO')
    })
})

describe('CodeEditorPanel focus after opening a file', () => {
    /** The focus waits a frame, for a closing dialog to let go first. */
    const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

    it('focuses the editor on the file that was just opened', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        // Callers ask once the open has finished.
        setTabs(view, { tabs: [tab(a, 'A'), tab(b, 'B')], activeTabId: b })
        act(() => focusEditorFor(b))
        await waitFor(() => expect(editor.focused).toBe(true))
    })

    it("forgets a request for a file that didn't open, so opening it by hand later leaves focus alone", async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        // The user said no to opening a large b.md (or it couldn't be read or made), so a.md still shows.
        act(() => focusEditorFor(b))
        await nextFrame()
        expect(editor.focused).toBe(false)

        // Later b.md is opened from the explorer, where the keyboard is meant to stay.
        setTabs(view, { tabs: [tab(a, 'A'), tab(b, 'B')], activeTabId: b })
        await nextFrame()
        await nextFrame()
        expect(editor.focused).toBe(false)
    })

    it('finds the tab however its path is written', async () => {
        const path = String.raw`C:\Notes\Plan.md`
        tabsState = { tabs: [tab(path, 'A')], activeTabId: path }
        const { editor } = await mountEditor()

        act(() => focusEditorFor('c:/notes/plan.md'))

        await waitFor(() => expect(editor.focused).toBe(true))
    })

    it('focuses straight away when that file is already showing', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()

        act(() => focusEditorFor('/w/a.md'))

        await waitFor(() => expect(editor.focused).toBe(true))
    })

    it('forgets the request when another file shows instead', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        const c = '/w/c.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        // b.md couldn't be opened; the user then moves to c.md and later to b.md by hand.
        act(() => focusEditorFor(b))
        setTabs(view, { tabs: [tab(a, 'A'), tab(c, 'C')], activeTabId: c })
        setTabs(view, { tabs: [tab(a, 'A'), tab(c, 'C'), tab(b, 'B')], activeTabId: b })
        await nextFrame()

        expect(editor.focused).toBe(false)
    })

    it('leaves a hidden editor alone', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { view, editor } = await mountEditor()
        view.rerender(<Panel open={false} />)

        act(() => focusEditorFor('/w/a.md'))
        await nextFrame()
        view.rerender(<Panel open />)
        await nextFrame()

        expect(editor.focused).toBe(false)
    })

    it('focuses the new editor when the file opens with no tab open before', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view } = await mountEditor()

        // Closing the last tab throws the editor away; the next file opens in a new one.
        setTabs(view, { tabs: [], activeTabId: null })
        setTabs(view, { tabs: [tab(b, 'B')], activeTabId: b })
        act(() => focusEditorFor(b))

        await waitFor(() => expect(editors).toHaveLength(2))
        await waitFor(() => expect(editors[1]!.focused).toBe(true))
    })
})

describe('CodeEditorPanel font', () => {
    it('uses the app monospace font, like the preview, and measures it again once it has loaded', async () => {
        const load = vi.fn(async () => [])
        Object.defineProperty(document, 'fonts', { configurable: true, value: { load } })
        document.documentElement.style.setProperty('--font-mono', "'Geist Mono', 'Geist Mono Fallback'")
        try {
            tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
            const { editor } = await mountEditor()

            // Not next/font's proportional fallback: the system monospace fonts fill in while it loads.
            expect(editor.options.fontFamily).toBe(
                `'Geist Mono', ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`
            )
            expect(load).toHaveBeenCalledWith(expect.stringContaining("'Geist Mono'"))
            await waitFor(() => expect(fakeMonaco.editor.remeasureFonts).toHaveBeenCalled())
        } finally {
            document.documentElement.style.removeProperty('--font-mono')
            Reflect.deleteProperty(document, 'fonts')
        }
    })

    it('falls back to the system monospace fonts when the app font is not set', async () => {
        tabsState = { tabs: [tab('/w/a.md', 'A')], activeTabId: '/w/a.md' }
        const { editor } = await mountEditor()
        expect(editor.options.fontFamily).toBe('ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace')
    })
})

describe('CodeEditorPanel indentation', () => {
    it('uses the Tab size setting instead of guessing the indent size from the file', async () => {
        tabsState = { tabs: [tab('/w/a.mmd', 'flowchart TD\n    A --> B')], activeTabId: '/w/a.mmd' }
        const { editor } = await mountEditor()
        expect(editor.options).toMatchObject({ tabSize: 2, detectIndentation: false })
        expect(editor.options).not.toHaveProperty('insertSpaces')
        expect(editor.getModel()!.options).toEqual({ tabSize: 2, indentSize: 2, insertSpaces: true })
    })

    it('keeps tabs in a file indented with tabs, also after switching tabs and changing Tab size', async () => {
        const spaces = '/w/a.mmd'
        const tabbed = '/w/b.md'
        const open = [tab(spaces, 'flowchart TD\n    A --> B'), tab(tabbed, '- item\n\t- nested')]
        tabsState = { tabs: open, activeTabId: spaces }
        const { view, editor } = await mountEditor()

        setTabs(view, { tabs: open, activeTabId: tabbed })
        expect(editor.getModel()!.options).toEqual({ tabSize: 2, indentSize: 2, insertSpaces: false })

        editorSettings = { ...DEFAULT_EDITOR_SETTINGS, tabSize: 4 }
        view.rerender(<Panel />)
        expect(editor.options.tabSize).toBe(4)
        expect(editor.getModel()!.options).toEqual({ tabSize: 4, indentSize: 4, insertSpaces: false })
    })
})
