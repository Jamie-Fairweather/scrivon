import type { Monaco } from '@monaco-editor/react'
import type { editor, IPosition, IRange, languages } from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readDocumentLinks, type DocumentLinks } from '@/lib/markdown/document-links'
import type { LinksReader } from '@/lib/markdown/links-reader'
import { buildLinkIndex } from '@/lib/workspace/link-index'
import type { DiskAnswer } from '@/lib/workspace/link-target-cache'
import type { FileNode } from '@/lib/workspace/types'
import { closeLinkTargets } from '@/lib/workspace/link-suggestions'
import { attachLinkCheck, LINK_CHECK_DELAY_MS, LINK_CHECK_MARKER_OWNER, type LinkCheckConfig } from './link-check'

vi.mock('@/lib/workspace/link-suggestions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/workspace/link-suggestions')>()
    return { ...actual, closeLinkTargets: vi.fn(actual.closeLinkTargets) }
})

// --- Small stand-ins for a Monaco text model, editor and API: just what the link check uses. ---

class FakeModel {
    private version = 1
    disposed = false
    readonly uri: { toString(): string }
    constructor(
        private text: string,
        uri: string
    ) {
        this.uri = { toString: () => uri }
    }
    getValue() {
        return this.text
    }
    getVersionId() {
        return this.version
    }
    isDisposed() {
        return this.disposed
    }
    setValue(text: string) {
        this.text = text
        this.version++
    }
    getPositionAt(offset: number): IPosition {
        const before = this.text.slice(0, offset).split('\n')
        return { lineNumber: before.length, column: before.at(-1)!.length + 1 }
    }
    offsetAt(lineNumber: number, column: number) {
        const lines = this.text.split('\n')
        return lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1
    }
    getValueInRange(range: IRange) {
        return this.text.slice(this.offsetAt(range.startLineNumber, range.startColumn), this.offsetAt(range.endLineNumber, range.endColumn))
    }
    replaceRange(range: IRange, text: string) {
        const start = this.offsetAt(range.startLineNumber, range.startColumn)
        this.setValue(this.text.slice(0, start) + text + this.text.slice(this.offsetAt(range.endLineNumber, range.endColumn)))
    }
}

type Change = { range: IRange; text: string }
type ContentListener = (event: { changes: Change[] }) => void

class FakeEditor {
    readonly contentListeners = new Set<ContentListener>()
    readonly modelListeners = new Set<() => void>()
    constructor(public model: FakeModel | null) {}
    getModel() {
        return this.model
    }
    onDidChangeModelContent(listener: ContentListener) {
        this.contentListeners.add(listener)
        return { dispose: () => this.contentListeners.delete(listener) }
    }
    onDidChangeModel(listener: () => void) {
        this.modelListeners.add(listener)
        return { dispose: () => this.modelListeners.delete(listener) }
    }
    /** What typing over `range` does: change the text and tell listeners. */
    edit(range: IRange, text: string) {
        this.model!.replaceRange(range, text)
        this.contentListeners.forEach((l) => l({ changes: [{ range, text }] }))
    }
    /** Replaces `find` (first occurrence) with `text`, as typing would. */
    replace(find: string, text: string) {
        const offset = this.model!.getValue().indexOf(find)
        const start = this.model!.getPositionAt(offset)
        const end = this.model!.getPositionAt(offset + find.length)
        this.edit({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text)
    }
    switchTo(model: FakeModel) {
        this.model = model
        this.modelListeners.forEach((l) => l())
    }
}

function fakeMonaco() {
    const markers = new Map<FakeModel, editor.IMarkerData[]>()
    const providers = new Set<languages.CodeActionProvider>()
    const monaco = {
        MarkerSeverity: { Info: 2, Warning: 4 },
        editor: {
            setModelMarkers: vi.fn((model: FakeModel, owner: string, data: editor.IMarkerData[]) => {
                expect(owner).toBe(LINK_CHECK_MARKER_OWNER)
                markers.set(model, data)
            }),
        },
        languages: {
            CodeActionTriggerType: { Invoke: 1, Auto: 2 },
            registerCodeActionProvider: vi.fn((language: string, provider: languages.CodeActionProvider) => {
                expect(language).toBe('markdown')
                providers.add(provider)
                return { dispose: () => providers.delete(provider) }
            }),
        },
    }
    return { monaco: monaco as unknown as Monaco, markers, providers }
}

/** The text under each mark in a model. */
function underlined(markers: Map<FakeModel, editor.IMarkerData[]>, model: FakeModel) {
    return (markers.get(model) ?? []).map((marker) => model.getValueInRange(marker))
}

const cancel = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }

/** Asks for code actions as Ctrl+. does (Invoke, 1), or as Monaco's light bulb does by itself (Auto, 2). */
async function codeActions(provider: languages.CodeActionProvider, model: FakeModel, at: IPosition, trigger: 1 | 2 = 1) {
    const range = { startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column }
    const list = await provider.provideCodeActions(model as unknown as editor.ITextModel, range as never, { markers: [], trigger } as never, cancel)
    return list?.actions ?? []
}

/** Where `find` is in the model, one character in. */
function positionOf(model: FakeModel, find: string): IPosition {
    const at = model.getPositionAt(model.getValue().indexOf(find))
    return { lineNumber: at.lineNumber, column: at.column + 1 }
}

/** Applies a quick fix's edit to the model, as Monaco would. */
function apply(model: FakeModel, action: languages.CodeAction) {
    const [edit] = action.edit!.edits as languages.IWorkspaceTextEdit[]
    expect(edit!.versionId).toBe(model.getVersionId())
    model.replaceRange(edit!.textEdit.range, edit!.textEdit.text)
}

const ROOT = 'C:\\notes'
const DOC = 'C:\\notes\\guide.md'
const URI = 'inmemory://scrivon/document-1'
const file = (path: string): FileNode => ({ kind: 'file', name: path.slice(path.lastIndexOf('\\') + 1), path })
const folder = (path: string, children: FileNode[]): FileNode => ({ kind: 'directory', name: path.slice(path.lastIndexOf('\\') + 1), path, children })
const TREE: FileNode[] = [
    // A `.cache` folder is there on disk, but the tree leaves it out.
    folder('C:\\notes\\docs', [file('C:\\notes\\docs\\set-up.md'), file('C:\\notes\\docs\\my notes.md')]),
    file(DOC),
]

function configFor(tree: FileNode[] = TREE, overrides: Partial<LinkCheckConfig> = {}): LinkCheckConfig {
    return { modelUri: URI, documentPath: DOC, workspaceRoot: ROOT, index: buildLinkIndex(ROOT, tree), openText: () => undefined, ...overrides }
}

describe('attachLinkCheck', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    function setup(text: string, { config = configFor(), disk = {} as Record<string, DiskAnswer> } = {}) {
        const model = new FakeModel(text, URI)
        const editorInstance = new FakeEditor(model)
        const { monaco, markers, providers } = fakeMonaco()
        const read = vi.fn(async (source: string): Promise<DocumentLinks> => readDocumentLinks(source))
        const reader: LinksReader = { read, dispose: () => {} }
        const checkOnDisk = vi.fn(async (path: string) => disk[path] ?? ('missing' as DiskAnswer))
        let notify: () => void = () => {}
        const subscribe = vi.fn((listener: () => void) => {
            notify = listener
            return () => {}
        })
        const forget = vi.fn()
        const session = attachLinkCheck(
            editorInstance as unknown as editor.IStandaloneCodeEditor,
            monaco,
            { reader, checkOnDisk, subscribe, forget },
            config
        )
        return { model, editorInstance, markers, providers, read, checkOnDisk, forget, session, notify: () => notify() }
    }

    it('underlines only the address of a link that leads nowhere, as a warning with a plain message', async () => {
        const { model, markers } = setup('# Guide\n\nSee [setup](docs/setup.md "Title") and [ok](docs/set-up.md) and [here](#guide).')
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual(['docs/setup.md'])
        expect(markers.get(model)![0]).toMatchObject({ startLineNumber: 3, severity: 4, message: 'No file called docs/setup.md in this folder.' })
    })

    it('checks again only once typing pauses for its own delay, not on every key', async () => {
        const { model, editorInstance, markers, read } = setup('[a](docs/set-up.md)')
        await vi.runAllTimersAsync()
        expect(LINK_CHECK_DELAY_MS).toBe(400)
        read.mockClear()

        editorInstance.replace('set-up', 'setu')
        await vi.advanceTimersByTimeAsync(LINK_CHECK_DELAY_MS - 100)
        editorInstance.replace('setu', 'setp')
        await vi.advanceTimersByTimeAsync(LINK_CHECK_DELAY_MS - 100)
        expect(read).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(100)
        expect(read).toHaveBeenCalledTimes(1)
        expect(underlined(markers, model)).toEqual(['docs/setp.md'])
    })

    it('drops a result for text that changed while it was being checked', async () => {
        const { model, editorInstance, markers, read } = setup('[a](gone.md)')
        let finish: (links: DocumentLinks) => void = () => {}
        read.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
        await vi.advanceTimersByTimeAsync(0)
        editorInstance.replace('gone.md', 'docs/set-up.md')
        finish(readDocumentLinks('[a](gone.md)'))
        await vi.advanceTimersByTimeAsync(0)
        expect(markers.get(model)).toBeUndefined()

        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual([])
    })

    it('takes the underline away when the tree gains the missing file, without reopening the tab', async () => {
        const { model, markers, session } = setup('[a](docs/new.md)')
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual(['docs/new.md'])

        session.setConfig(configFor([...TREE, folder('C:\\notes\\docs', [file('C:\\notes\\docs\\new.md')])]))
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual([])
    })

    it('asks the disk about a hidden folder’s path, and again when told the answers were forgotten (focus) or the link is edited', async () => {
        const disk: Record<string, DiskAnswer> = {}
        const { model, editorInstance, markers, checkOnDisk, notify } = setup('[a](.cache/new.md)\n\n[b](.cache/other.md)', { disk })
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual(['.cache/new.md', '.cache/other.md'])
        expect(checkOnDisk.mock.calls).toEqual([
            ['C:\\notes\\.cache\\new.md', false],
            ['C:\\notes\\.cache\\other.md', false],
        ])

        disk['C:\\notes\\.cache\\new.md'] = 'file'
        notify()
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual(['.cache/other.md'])

        // Editing a link asks afresh about it only.
        checkOnDisk.mockClear()
        editorInstance.replace('other.md', 'other2.md')
        await vi.runAllTimersAsync()
        expect(checkOnDisk.mock.calls).toEqual([
            ['C:\\notes\\.cache\\new.md', false],
            ['C:\\notes\\.cache\\other2.md', true],
        ])
    })

    it('forgets what the disk said when another tab shows, and clears the marks when the check is off for it', async () => {
        const { model, editorInstance, markers, forget, session } = setup('[a](gone.md)')
        await vi.runAllTimersAsync()
        const other = new FakeModel('[b](also-gone.md)', 'inmemory://scrivon/document-2')
        editorInstance.switchTo(other)
        expect(forget).toHaveBeenCalledTimes(1)
        session.setConfig(configFor(TREE, { modelUri: 'inmemory://scrivon/document-2' }))
        await vi.runAllTimersAsync()
        expect(underlined(markers, other)).toEqual(['also-gone.md'])

        session.setConfig(null)
        await vi.runAllTimersAsync()
        expect(underlined(markers, other)).toEqual([])
        expect(underlined(markers, model)).toEqual(['gone.md'])
    })

    it('offers the closest files on Ctrl+., replacing only the path and keeping the title and angle brackets', async () => {
        const { model, providers } = setup('[a](<docs/my note.md#part> "Title")')
        await vi.runAllTimersAsync()
        const [provider] = [...providers]
        const actions = await codeActions(provider!, model, positionOf(model, 'docs/my'))
        expect(actions[0]!.title).toBe('Change to docs/my notes.md')
        expect(actions.length).toBeLessThanOrEqual(5)
        expect(actions[0]!.isPreferred).toBe(true)
        apply(model, actions[0]!)
        expect(model.getValue()).toBe('[a](<docs/my%20notes.md#part> "Title")')
    })

    it('offers the closest headings for an anchor, replacing only the fragment', async () => {
        const { model, providers } = setup('# Installation\n\n## Usage\n\n[a](#instal) [b](guide.md#usge)')
        await vi.runAllTimersAsync()
        const [provider] = [...providers]
        const other = await codeActions(provider!, model, positionOf(model, 'guide.md#usge'))
        expect(other.map((action) => action.title)).toEqual(['Change to #usage'])

        const actions = await codeActions(provider!, model, positionOf(model, '#instal'))
        expect(actions[0]!.title).toBe('Change to #installation')
        apply(model, actions[0]!)
        expect(model.getValue()).toBe('# Installation\n\n## Usage\n\n[a](#installation) [b](guide.md#usge)')
        // The mark after it has moved, so it waits for the next check rather than fixing the wrong text.
        expect(await codeActions(provider!, model, positionOf(model, 'guide.md#usge'))).toEqual([])
    })

    it('ranks files only when asked (Ctrl+. or the hover), once per mark, and not for the light bulb as the cursor moves', async () => {
        const { model, providers } = setup('[a](docs/setp.md) [b](#nowhere)')
        await vi.runAllTimersAsync()
        const [provider] = [...providers]
        const ranking = vi.mocked(closeLinkTargets)
        ranking.mockClear()

        // Monaco asks by itself as the cursor moves inside the mark and as marks change: no ranking.
        expect(await codeActions(provider!, model, positionOf(model, 'docs/setp'), 2)).toEqual([])
        expect(await codeActions(provider!, model, positionOf(model, 'setp.md'), 2)).toEqual([])
        expect(ranking).not.toHaveBeenCalled()

        const asked = await codeActions(provider!, model, positionOf(model, 'docs/setp'), 1)
        expect(asked[0]!.title).toBe('Change to docs/set-up.md')
        expect((await codeActions(provider!, model, positionOf(model, 'setp.md'), 1)).map((action) => action.title)).toEqual(
            asked.map((action) => action.title)
        )
        // What was ranked is kept for the light bulb too.
        expect((await codeActions(provider!, model, positionOf(model, 'docs/setp'), 2)).map((action) => action.title)).toEqual(
            asked.map((action) => action.title)
        )
        expect(ranking).toHaveBeenCalledTimes(1)
    })

    it('answers only for its own marks, and offers no fix once the text under the mark has changed', async () => {
        const { model, editorInstance, providers } = setup('Some words. [a](docs/setp.md)')
        await vi.runAllTimersAsync()
        const [provider] = [...providers]
        expect(await codeActions(provider!, model, positionOf(model, 'words'))).toEqual([])
        expect(await codeActions(provider!, model, positionOf(model, 'docs/setp'))).not.toEqual([])

        editorInstance.replace('setp', 'setpp')
        expect(await codeActions(provider!, model, positionOf(model, 'docs/setpp'))).toEqual([])
    })

    it('registers its quick fixes again when it turns on, so Ctrl+. works after a read-only tab', async () => {
        const { monaco } = fakeMonaco()
        const model = new FakeModel('[a](gone.md)', URI)
        const editorInstance = new FakeEditor(model)
        const reader: LinksReader = { read: async (source) => readDocumentLinks(source), dispose: () => {} }
        const session = attachLinkCheck(
            editorInstance as unknown as editor.IStandaloneCodeEditor,
            monaco,
            { reader, subscribe: () => () => {}, forget: () => {} },
            null
        )
        expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(1)
        session.setConfig(configFor())
        expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(2)
        session.setConfig(configFor())
        expect(monaco.languages.registerCodeActionProvider).toHaveBeenCalledTimes(2)
        session.dispose()
    })
})
