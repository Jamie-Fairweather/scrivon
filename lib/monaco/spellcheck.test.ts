import type { Monaco } from '@monaco-editor/react'
import type { editor, IPosition, IRange, languages } from 'monaco-editor'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpellcheckClient } from '@/lib/spellcheck/spellcheck-client'
import { ADD_TO_DICTIONARY_COMMAND, attachSpellcheck, SPELLCHECK_DELAY_MS, SPELLCHECK_MARKER_OWNER, type SpellcheckConfig } from './spellcheck'

// --- Small stand-ins for a Monaco text model, editor and API: just what the spell check uses. ---

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
    private offsetAt(lineNumber: number, column: number) {
        const lines = this.text.split('\n')
        return lines.slice(0, lineNumber - 1).reduce((sum, line) => sum + line.length + 1, 0) + column - 1
    }
    getValueInRange(range: IRange) {
        return this.text.slice(this.offsetAt(range.startLineNumber, range.startColumn), this.offsetAt(range.endLineNumber, range.endColumn))
    }
}

type Listener = () => void

class FakeEditor {
    readonly contentListeners = new Set<Listener>()
    readonly modelListeners = new Set<Listener>()
    readonly cursorListeners = new Set<Listener>()
    readonly contextKeys = new Map<string, boolean>()
    readonly actions = new Map<string, editor.IActionDescriptor>()
    position: IPosition = { lineNumber: 1, column: 1 }
    readonly quickFix = vi.fn()
    constructor(public model: FakeModel | null) {}
    getModel() {
        return this.model
    }
    getPosition() {
        return this.position
    }
    private listen(set: Set<Listener>, listener: Listener) {
        set.add(listener)
        return { dispose: () => set.delete(listener) }
    }
    onDidChangeModelContent(listener: Listener) {
        return this.listen(this.contentListeners, listener)
    }
    onDidChangeModel(listener: Listener) {
        return this.listen(this.modelListeners, listener)
    }
    onDidChangeCursorPosition(listener: Listener) {
        return this.listen(this.cursorListeners, listener)
    }
    createContextKey(key: string, value: boolean) {
        this.contextKeys.set(key, value)
        return {
            set: (next: boolean) => this.contextKeys.set(key, next),
            reset: () => this.contextKeys.set(key, value),
            get: () => this.contextKeys.get(key),
        }
    }
    addAction(action: editor.IActionDescriptor) {
        this.actions.set(action.id, action)
        return { dispose: () => this.actions.delete(action.id) }
    }
    getAction(id: string) {
        return id === 'editor.action.quickFix' ? { run: this.quickFix } : null
    }
    /** What typing does: change the text and tell listeners. */
    type(text: string) {
        this.model!.setValue(text)
        this.contentListeners.forEach((l) => l())
    }
    switchTo(model: FakeModel) {
        this.model = model
        this.modelListeners.forEach((l) => l())
    }
    moveCursor(position: IPosition) {
        this.position = position
        this.cursorListeners.forEach((l) => l())
    }
    /** The value of the spell check's context key, which shows its right-click menu entries. */
    get onMisspelling() {
        return [...this.contextKeys.values()][0]
    }
}

function fakeMonaco() {
    const markers = new Map<FakeModel, editor.IMarkerData[]>()
    const commands = new Map<string, (accessor: unknown, ...args: unknown[]) => void>()
    const providers = new Set<languages.CodeActionProvider>()
    const monaco = {
        MarkerSeverity: { Info: 2 },
        editor: {
            setModelMarkers: vi.fn((model: FakeModel, owner: string, data: editor.IMarkerData[]) => {
                expect(owner).toBe(SPELLCHECK_MARKER_OWNER)
                markers.set(model, data)
            }),
            registerCommand: (id: string, handler: (accessor: unknown, ...args: unknown[]) => void) => {
                commands.set(id, handler)
                return { dispose: () => commands.delete(id) }
            },
        },
        languages: {
            registerCodeActionProvider: (language: string, provider: languages.CodeActionProvider) => {
                expect(language).toBe('markdown')
                providers.add(provider)
                return { dispose: () => providers.delete(provider) }
            },
        },
    }
    return { monaco: monaco as unknown as Monaco, markers, commands, providers }
}

/** The words underlined in a model, as the text under each mark. */
function underlined(markers: Map<FakeModel, editor.IMarkerData[]>, model: FakeModel) {
    return (markers.get(model) ?? []).map((marker) => model.getValueInRange(marker))
}

/** A client that marks every word in `wrong`, and suggests the word in capitals. */
function fakeClient(wrong: string[]) {
    return {
        check: vi.fn(async (text: string) =>
            [...text.matchAll(/\p{L}+/gu)].filter((m) => wrong.includes(m[0])).map((m) => ({ word: m[0], offset: m.index }))
        ),
        suggest: vi.fn(async (word: string) => [word.toUpperCase(), `${word}s`]),
    } satisfies SpellcheckClient
}

const cancel = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }

async function codeActions(provider: languages.CodeActionProvider, model: FakeModel, at: IPosition) {
    const range = { startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column }
    const list = await provider.provideCodeActions(
        model as unknown as editor.ITextModel,
        range as never,
        { markers: [], trigger: 1 } as never,
        cancel
    )
    return list?.actions ?? []
}

const URI = 'inmemory://scrivon/document-1'
const config: SpellcheckConfig = { modelUri: URI, language: 'en-GB', words: ['Scrivon'] }

describe('attachSpellcheck', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    function setup(text = 'Hello wrold\nsecnod line', wrong = ['wrold', 'secnod']) {
        const model = new FakeModel(text, URI)
        const editorInstance = new FakeEditor(model)
        const { monaco, markers, commands, providers } = fakeMonaco()
        const client = fakeClient(wrong)
        const addWord = vi.fn()
        const session = attachSpellcheck(editorInstance as unknown as editor.IStandaloneCodeEditor, monaco, { client, addWord }, config)
        return { model, editorInstance, monaco, markers, commands, providers, client, addWord, session }
    }

    it('underlines misspelt words once the file opens, with the language and the user’s words', async () => {
        const { model, markers, client } = setup()
        await vi.runAllTimersAsync()
        expect(client.check).toHaveBeenCalledWith('Hello wrold\nsecnod line', 'en-GB', ['Scrivon'], URI)
        expect(underlined(markers, model)).toEqual(['wrold', 'secnod'])
        expect(markers.get(model)![1]).toMatchObject({ startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 7, severity: 2 })
        expect(markers.get(model)![0]!.message).toContain('wrold')
    })

    it('checks again only once typing pauses, not on every key', async () => {
        const { model, editorInstance, markers, client } = setup()
        await vi.runAllTimersAsync()
        client.check.mockClear()

        editorInstance.type('Hello wrold secnod')
        await vi.advanceTimersByTimeAsync(SPELLCHECK_DELAY_MS - 100)
        editorInstance.type('Hello world secnod')
        await vi.advanceTimersByTimeAsync(SPELLCHECK_DELAY_MS - 100)
        expect(client.check).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(100)
        expect(client.check).toHaveBeenCalledTimes(1)
        expect(underlined(markers, model)).toEqual(['secnod'])
    })

    it('drops a result for text that changed while it was being checked', async () => {
        const { model, editorInstance, markers, client } = setup()
        let finish: (value: { word: string; offset: number }[]) => void = () => {}
        client.check.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
        await vi.advanceTimersByTimeAsync(0)
        editorInstance.type('Hello world')
        finish([{ word: 'wrold', offset: 6 }])
        await vi.advanceTimersByTimeAsync(0)
        expect(markers.get(model)).toBeUndefined()

        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual([])
    })

    it('checks the file that is switched to, and clears the marks when spell check is off for it', async () => {
        const { model, editorInstance, markers, session } = setup()
        await vi.runAllTimersAsync()

        const other = new FakeModel('A secnod file', 'inmemory://scrivon/document-2')
        editorInstance.switchTo(other)
        session.setConfig({ ...config, modelUri: 'inmemory://scrivon/document-2' })
        await vi.runAllTimersAsync()
        expect(underlined(markers, other)).toEqual(['secnod'])

        session.setConfig(null)
        await vi.runAllTimersAsync()
        expect(underlined(markers, other)).toEqual([])
        // Another file's marks wait until it shows again.
        expect(underlined(markers, model)).toEqual(['wrold', 'secnod'])
    })

    it('clears the marks of a file switched back to after spell check was turned off', async () => {
        const { model, editorInstance, markers, session } = setup()
        await vi.runAllTimersAsync()
        const other = new FakeModel('A secnod file', 'inmemory://scrivon/document-2')
        editorInstance.switchTo(other)
        session.setConfig(null)
        await vi.runAllTimersAsync()

        // Spell check is off for every file now, so the config doesn't change on the way back.
        editorInstance.switchTo(model)
        editorInstance.moveCursor({ lineNumber: 2, column: 3 })
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual([])
        expect(editorInstance.onMisspelling).toBe(false)
    })

    it('clears marks an earlier editor left on the file when spell check is off', async () => {
        const { model, monaco, markers, client, session } = setup()
        await vi.runAllTimersAsync()
        session.dispose()

        const next = new FakeEditor(model)
        attachSpellcheck(next as unknown as editor.IStandaloneCodeEditor, monaco, { client, addWord: vi.fn() }, null)
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual([])
    })

    it('offers the suggestions and Add to Dictionary as quick fixes on a misspelt word only', async () => {
        const { model, providers, client } = setup()
        await vi.runAllTimersAsync()
        const [provider] = [...providers]

        const actions = await codeActions(provider!, model, { lineNumber: 1, column: 9 })
        expect(client.suggest).toHaveBeenCalledWith('wrold', 'en-GB', ['Scrivon'])
        expect(actions.map((action) => action.title)).toEqual(['Change to “WROLD”', 'Change to “wrolds”', 'Add “wrold” to Dictionary'])
        expect(actions[0]).toMatchObject({ kind: 'quickfix', isPreferred: true })
        expect(actions[0]!.edit!.edits[0]).toMatchObject({
            versionId: model.getVersionId(),
            textEdit: { text: 'WROLD', range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12 } },
        })
        expect(actions[2]!.command).toEqual({ id: ADD_TO_DICTIONARY_COMMAND, title: 'Add “wrold” to Dictionary', arguments: ['wrold'] })

        expect(await codeActions(provider!, model, { lineNumber: 1, column: 2 })).toEqual([])
    })

    it('offers nothing where the text has changed since the last check', async () => {
        const { model, editorInstance, providers } = setup()
        await vi.runAllTimersAsync()
        editorInstance.type('Hi, wrold\nsecnod line')
        // The check hasn't run yet: the old marks are in the wrong place now.
        expect(await codeActions([...providers][0]!, model, { lineNumber: 1, column: 9 })).toEqual([])
    })

    it('adds a word to the dictionary and takes its marks away at once', async () => {
        const { model, markers, commands, addWord } = setup('Scrivon’s wrold, Scrivon’s secnod', ['Scrivon’s', 'wrold', 'secnod'])
        await vi.runAllTimersAsync()
        commands.get(ADD_TO_DICTIONARY_COMMAND)!(undefined, 'Scrivon’s')
        expect(addWord).toHaveBeenCalledWith('Scrivon')
        expect(underlined(markers, model)).toEqual(['wrold', 'secnod'])
    })

    it('shows Spelling Suggestions and Add to Dictionary in the right-click menu on a misspelt word', async () => {
        const { model, editorInstance, markers, addWord } = setup()
        await vi.runAllTimersAsync()
        expect(editorInstance.onMisspelling).toBe(false)

        editorInstance.moveCursor({ lineNumber: 2, column: 3 })
        expect(editorInstance.onMisspelling).toBe(true)
        const suggestions = editorInstance.actions.get('scrivon.spelling.suggestions')!
        const add = editorInstance.actions.get('scrivon.spelling.addToDictionary')!
        expect(suggestions).toMatchObject({ label: 'Spelling Suggestions', contextMenuGroupId: 'navigation' })
        expect(add).toMatchObject({ label: 'Add to Dictionary', contextMenuGroupId: 'navigation' })
        expect(suggestions.precondition).toBe(add.precondition)

        void suggestions.run(editorInstance as unknown as editor.ICodeEditor)
        expect(editorInstance.quickFix).toHaveBeenCalled()
        void add.run(editorInstance as unknown as editor.ICodeEditor)
        expect(addWord).toHaveBeenCalledWith('secnod')
        expect(underlined(markers, model)).toEqual(['wrold'])
        expect(editorInstance.onMisspelling).toBe(false)

        editorInstance.moveCursor({ lineNumber: 1, column: 1 })
        expect(editorInstance.onMisspelling).toBe(false)
    })

    it('lets go of everything when the editor goes', async () => {
        const { editorInstance, commands, providers, client, session } = setup()
        await vi.runAllTimersAsync()
        session.dispose()
        expect(commands.size).toBe(0)
        expect(providers.size).toBe(0)
        expect(editorInstance.actions.size).toBe(0)
        client.check.mockClear()
        editorInstance.type('more text')
        await vi.runAllTimersAsync()
        expect(client.check).not.toHaveBeenCalled()
    })
})
