import { act, fireEvent, render, waitFor } from '@testing-library/react'
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

class FakeModel {
    disposed = false
    readonly listeners = new Set<Listener>()
    options: { tabSize?: number; indentSize?: number | 'tabSize'; insertSpaces?: boolean } = {}
    constructor(
        public value: string,
        public readonly uri: FakeUri
    ) {}
    getValue() {
        return this.value
    }
    setValue(value: string) {
        this.value = value
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
}

class FakeEditor {
    options: Record<string, unknown>
    private readonly contentListeners = new Set<Listener>()
    private readonly modelListeners = new Set<Listener>()
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
    selection: unknown = null
    focused = false
    focus() {
        this.focused = true
    }
    revealPositionInCenter() {}
    revealRangeInCenter() {}
    setSelection(selection: unknown) {
        this.selection = selection
    }
    dispose() {
        this.setModel(null)
    }
}

const models = new Map<string, FakeModel>()
const editors: FakeEditor[] = []

const fakeMonaco = {
    Uri: { parse: (value: string) => new FakeUri(value) },
    KeyCode: { F1: 59 },
    KeyMod: { CtrlCmd: 2048 },
    editor: {
        EndOfLinePreference: { TextDefined: 0, LF: 1, CRLF: 2 },
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
    },
}

// The real @monaco-editor/react picks up window.monaco when the loader has no bundled copy.
;(window as unknown as { monaco: unknown }).monaco = fakeMonaco

// --- Module mocks ---

// Skip loading the real bundled Monaco; the fake above stands in for it.
vi.mock('@/lib/monaco/setup-monaco', () => ({}))

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

vi.mock('@/components/studio/workspace/workspace-provider', () => ({
    useDocumentTabs: () => ({
        tabs: tabsState.tabs,
        activeTabId: tabsState.activeTabId,
        activeTab: tabsState.tabs.find((t) => t.id === tabsState.activeTabId) ?? null,
        updateTabContent,
    }),
    useWorkspaceCoordinator: () => ({}),
}))

type RevealInEditor = (path: string, line: number, column: number, length?: number) => void
const coordinatorHandlers: { revealInEditor?: RevealInEditor } = {}
vi.mock('@/components/studio/workspace/register-coordinator-refs', () => ({
    registerCoordinatorRefs: (_refs: unknown, handlers: typeof coordinatorHandlers) => Object.assign(coordinatorHandlers, handlers),
}))
type ThemeState = { isLight: boolean; tokens: Record<string, string> }
const LIGHT_THEME: ThemeState = { isLight: true, tokens: { name: 'light' } }
let theme = LIGHT_THEME
const defineMonacoDiagramTheme = vi.fn()

vi.mock('@/components/theme/app-theme-provider', () => ({ useAppTheme: () => theme }))
vi.mock('@/lib/theme/monaco-theme', () => ({ MONACO_DIAGRAM_THEME_ID: 'test-theme', defineMonacoDiagramTheme }))
const DEFAULT_EDITOR_SETTINGS = { fontSize: 13, tabSize: 2, wordWrap: 'on', lineNumbers: 'on', minimap: false }
let editorSettings = DEFAULT_EDITOR_SETTINGS
vi.mock('@/components/studio/settings/settings-provider', () => ({
    useAppSettings: () => ({ settings: { editor: editorSettings } }),
}))

const { CodeEditorPanel } = await import('@/components/studio/editor/code-editor-panel')
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
    defineMonacoDiagramTheme.mockClear()
    theme = LIGHT_THEME
    editorSettings = DEFAULT_EDITOR_SETTINGS
    tabsState = { tabs: [], activeTabId: null }
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
        expect(panel).toHaveClass('hidden')
        view.rerender(<Panel open />)

        expect(panel).not.toHaveClass('hidden')
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

    it('selects the hit once its file becomes the active tab', async () => {
        const a = '/w/a.md'
        const b = '/w/b.md'
        tabsState = { tabs: [tab(a, 'A')], activeTabId: a }
        const { view, editor } = await mountEditor()

        act(() => coordinatorHandlers.revealInEditor!(b, 3, 2, 6))
        expect(editor.selection).toBeNull()

        setTabs(view, { tabs: [tab(a, 'A'), tab(b, 'x\ny\n find me')], activeTabId: b })
        expect(editor.selection).toEqual({ startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 8 })
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
