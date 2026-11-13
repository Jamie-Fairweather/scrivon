// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IRange } from 'monaco-editor'

const assets = vi.hoisted(() => ({
    save: vi.fn<(documentPath: string, name: string, bytes: Uint8Array) => Promise<string>>(),
    add: vi.fn<(sourcePath: string, document: { path: string; workspaceRoot: string }) => Promise<string>>(),
}))
const notify = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }))

vi.mock('@/lib/workspace/image-assets', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/workspace/image-assets')>()),
    saveImageInAssets: assets.save,
    addDroppedImage: assets.add,
}))
vi.mock('@/lib/notify', () => ({ notifyError: notify.error, notifyInfo: notify.info }))

type DropListener = (event: { payload: { type: 'drop'; paths: string[]; position: { x: number; y: number } } }) => void
const webview = vi.hoisted(() => ({ listener: null as DropListener | null }))
vi.mock('@tauri-apps/api/webview', () => ({
    getCurrentWebview: () => ({
        onDragDropEvent: async (listener: DropListener) => {
            webview.listener = listener
            return () => {}
        },
    }),
}))
vi.mock('@/lib/tauri/platform', () => ({ isTauri: () => true }))

const { attachEditorImages, imageDocumentFor } = await import('./editor-images')
const { listenForFileDrops } = await import('@/lib/tauri/file-drop')

const ROOT = 'C:\\notes'
const DOC = 'C:\\notes\\guides\\setup.md'
const ASSETS = 'C:\\notes\\guides\\assets'

type Position = { lineNumber: number; column: number }

/** One buffer of text, with the few model calls the image code makes. */
class FakeModel {
    disposed = false
    private readonly marks = new Map<string, IRange>()
    private nextMark = 0
    constructor(public text: string) {}
    private get lines() {
        return this.text.split('\n')
    }
    getOffsetAt({ lineNumber, column }: Position) {
        return this.lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1
    }
    getPositionAt(offset: number): Position {
        const before = this.text.slice(0, offset).split('\n')
        return { lineNumber: before.length, column: before.at(-1)!.length + 1 }
    }
    deltaDecorations(old: string[], added: Array<{ range: IRange }>) {
        old.forEach((id) => this.marks.delete(id))
        return added.map(({ range }) => {
            const id = `mark${this.nextMark++}`
            this.marks.set(id, range)
            return id
        })
    }
    getDecorationRange(id: string) {
        return this.marks.get(id) ?? null
    }
    isDisposed() {
        return this.disposed
    }
    /** Marks still on the text; the image code takes its own away when done. */
    get markCount() {
        return this.marks.size
    }
}

const at = (lineNumber: number, column: number): IRange => ({
    startLineNumber: lineNumber,
    startColumn: column,
    endLineNumber: lineNumber,
    endColumn: column,
})

class FakeEditor {
    readonly container = document.createElement('div')
    textFocused = true
    selection: IRange = at(1, 1)
    /** Where a point on screen is in the text. */
    pointAt: Position | null = null
    undoStops = 0
    constructor(public model: FakeModel | null) {
        document.body.append(this.container)
    }
    getContainerDomNode() {
        return this.container
    }
    hasTextFocus() {
        return this.textFocused
    }
    getModel() {
        return this.model
    }
    getSelection() {
        return { ...this.selection }
    }
    setSelection(range: IRange) {
        this.selection = { ...range }
    }
    setPosition({ lineNumber, column }: Position) {
        this.selection = at(lineNumber, column)
    }
    getTargetAtClientPoint() {
        return this.pointAt ? { position: this.pointAt } : null
    }
    focus() {}
    pushUndoStop() {
        this.undoStops += 1
        return true
    }
    executeEdits(_source: string, edits: Array<{ range: IRange; text: string }>) {
        const model = this.model!
        for (const { range, text } of edits) {
            const start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn })
            const end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })
            model.text = model.text.slice(0, start) + text + model.text.slice(end)
        }
        return true
    }
}

/** What the system does on Ctrl+V: a paste event at the editor, carrying the clipboard. */
function paste(editor: FakeEditor, clipboard: { text?: string; files?: File[] }) {
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
        value: { getData: (type: string) => (type === 'text/plain' ? (clipboard.text ?? '') : ''), files: clipboard.files ?? [] },
    })
    const target = document.createElement('textarea')
    editor.container.append(target)
    target.dispatchEvent(event)
    return event
}

const screenshot = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' })

let editor: FakeEditor
let document_: { path: string; workspaceRoot: string } | null
let detach: () => void

beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 13, 20, 45, 12) })
    assets.save.mockImplementation(async (_doc, name) => `${ASSETS}\\${name}`)
    assets.add.mockImplementation(async (source) => (source.startsWith(ROOT) ? source : `${ASSETS}\\${source.replace(/^.*\\/, '')}`))
    editor = new FakeEditor(new FakeModel('# Setup\nSee: \nDone.'))
    document_ = { path: DOC, workspaceRoot: ROOT }
    const attached = attachEditorImages(editor as never, () => document_)
    detach = () => attached.dispose()
})

afterEach(() => {
    detach()
    vi.useRealTimers()
    document.body.innerHTML = ''
})

describe('pasting a picture', () => {
    it('saves it in assets under a new name and puts its link where the cursor is', async () => {
        editor.setSelection(at(2, 6))

        const event = paste(editor, { files: [screenshot()] })

        expect(event.defaultPrevented).toBe(true)
        await vi.waitFor(() => expect(editor.model!.text).toBe('# Setup\nSee: ![image-20261113-204512](assets/image-20261113-204512.png)\nDone.'))
        expect(assets.save).toHaveBeenCalledWith(DOC, 'image-20261113-204512.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
        expect(editor.selection).toEqual(at(2, 64))
        expect(editor.model!.markCount).toBe(0)
    })

    it('replaces the selected text, and links several pictures side by side', async () => {
        editor.setSelection({ startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 6 })
        assets.save.mockResolvedValueOnce(`${ASSETS}\\one.png`).mockResolvedValueOnce(`${ASSETS}\\two.png`)

        paste(editor, { files: [screenshot(), screenshot()] })

        await vi.waitFor(() => expect(editor.model!.text).toBe('# Setup\nSee: \n![one](assets/one.png) ![two](assets/two.png)'))
    })

    it('leaves text to the editor, even with a picture of it alongside (as Word and web pages copy)', async () => {
        const event = paste(editor, { text: 'Hello', files: [screenshot()] })

        expect(event.defaultPrevented).toBe(false)
        expect(assets.save).not.toHaveBeenCalled()
    })

    it('leaves the paste alone where pictures can’t go: a diagram, a read-only file, the find box', () => {
        document_ = null
        expect(paste(editor, { files: [screenshot()] }).defaultPrevented).toBe(false)

        document_ = { path: DOC, workspaceRoot: ROOT }
        editor.textFocused = false
        expect(paste(editor, { files: [screenshot()] }).defaultPrevented).toBe(false)

        expect(paste(editor, { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] }).defaultPrevented).toBe(false)
        expect(assets.save).not.toHaveBeenCalled()
    })

    it('says which kinds of picture it takes, rather than save one the preview can’t show', () => {
        const event = paste(editor, { files: [new File(['BM'], 'scan.bmp', { type: 'image/bmp' })] })

        expect(event.defaultPrevented).toBe(true)
        expect(notify.info).toHaveBeenCalledWith("Couldn't add scan.bmp", { description: 'Only PNG, JPEG, GIF, WebP and SVG images can be added.' })
        expect(assets.save).not.toHaveBeenCalled()
    })

    it('says why a picture couldn’t be saved, and adds no link', async () => {
        assets.save.mockRejectedValueOnce(new Error('Access is denied. (os error 5)'))

        paste(editor, { files: [screenshot()] })

        await vi.waitFor(() => expect(notify.error).toHaveBeenCalledWith("Couldn't add the image", expect.any(Error)))
        expect(editor.model!.text).toBe('# Setup\nSee: \nDone.')
        expect(editor.model!.markCount).toBe(0)
    })

    it('adds no link to a file that isn’t showing any more, and says where the picture went', async () => {
        let finish: (path: string) => void = () => {}
        assets.save.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
        const first = editor.model!

        paste(editor, { files: [screenshot()] })
        editor.model = new FakeModel('Other file')
        finish(`${ASSETS}\\image-20261113-204512.png`)

        await vi.waitFor(() =>
            expect(notify.info).toHaveBeenCalledWith('Saved image-20261113-204512.png', {
                description:
                    'Another file was showing by then, so no link was added. Link it with ![image-20261113-204512](assets/image-20261113-204512.png)',
            })
        )
        expect(first.text).toBe('# Setup\nSee: \nDone.')
        expect(editor.model.text).toBe('Other file')
    })
})

describe('dropping files onto the editor', () => {
    /** Files dropped from File Explorer onto the editor's text; returns what the window was left to deal with. */
    async function drop(paths: string[]) {
        const rest = vi.fn()
        const stop = await listenForFileDrops(rest)
        const text = document.createElement('div')
        editor.container.append(text)
        document.elementFromPoint = vi.fn(() => text)
        webview.listener!({ payload: { type: 'drop', paths, position: { x: 120, y: 80 } } })
        stop()
        return rest.mock.calls[0]?.[0]?.paths ?? []
    }

    it('adds the images where they were dropped and leaves other files to the window', async () => {
        editor.setSelection(at(1, 1))
        editor.pointAt = { lineNumber: 2, column: 6 }

        const rest = await drop(['D:\\Pictures\\cat.png', 'D:\\notes\\todo.md', 'C:\\notes\\img\\logo.svg'])

        expect(rest).toEqual(['D:\\notes\\todo.md'])
        expect(assets.add).toHaveBeenCalledWith('D:\\Pictures\\cat.png', { path: DOC, workspaceRoot: ROOT })
        await vi.waitFor(() => expect(editor.model!.text).toBe('# Setup\nSee: ![cat](assets/cat.png) ![logo](../img/logo.svg)\nDone.'))
        expect(editor.selection).toEqual(at(2, 53))
    })

    it('puts them at the cursor when the drop point isn’t on a line of text', async () => {
        editor.setSelection(at(3, 6))

        await drop(['D:\\Pictures\\cat.png'])

        await vi.waitFor(() => expect(editor.model!.text).toBe('# Setup\nSee: \nDone.![cat](assets/cat.png)'))
    })

    it('leaves every file to the window when the file showing can’t take images', async () => {
        document_ = null

        expect(await drop(['D:\\Pictures\\cat.png', 'D:\\notes\\todo.md'])).toEqual(['D:\\Pictures\\cat.png', 'D:\\notes\\todo.md'])
        expect(assets.add).not.toHaveBeenCalled()
    })

    it('stops taking pastes and drops once let go', async () => {
        detach()

        expect(paste(editor, { files: [screenshot()] }).defaultPrevented).toBe(false)
        expect(await drop(['D:\\Pictures\\cat.png'])).toEqual(['D:\\Pictures\\cat.png'])
    })
})

describe('imageDocumentFor', () => {
    const tab = { id: DOC, path: DOC, name: 'setup.md', content: '', isDirty: false, isSaving: false }

    it('takes images into a Markdown file in the open folder', () => {
        expect(imageDocumentFor(tab, ROOT)).toEqual({ path: DOC, workspaceRoot: ROOT })
    })

    it('takes none into a diagram, a read-only file, an example, or with no folder open', () => {
        expect(imageDocumentFor({ ...tab, name: 'flow.mmd', path: 'C:\\notes\\flow.mmd', id: 'C:\\notes\\flow.mmd' }, ROOT)).toBeNull()
        expect(imageDocumentFor({ ...tab, readOnly: true }, ROOT)).toBeNull()
        expect(imageDocumentFor({ ...tab, id: 'example:readme', path: 'readme.md', name: 'readme.md' }, ROOT)).toBeNull()
        expect(imageDocumentFor(tab, null)).toBeNull()
        expect(imageDocumentFor(null, ROOT)).toBeNull()
        expect(imageDocumentFor(tab, 'D:\\other')).toBeNull()
    })
})
