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
    replaceRange(range: IRange, text: string) {
        const start = this.offsetAt(range.startLineNumber, range.startColumn)
        this.setValue(this.text.slice(0, start) + text + this.text.slice(this.offsetAt(range.endLineNumber, range.endColumn)))
    }
}

type Listener = () => void

class FakeEditor {
    readonly contentListeners = new Set<Listener>()
    readonly modelListeners = new Set<Listener>()
    position: IPosition = { lineNumber: 1, column: 1 }
    /** Edits made through the editor, and the undo stops between them. */
    readonly history: string[] = []
    constructor(public model: FakeModel | null) {}
    getModel() {
        return this.model
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
    pushUndoStop() {
        this.history.push('undo stop')
        return true
    }
    executeEdits(_source: string, edits: { range: IRange; text: string }[]) {
        for (const { range, text } of edits) {
            this.history.push(`edit “${text}”`)
            this.model!.replaceRange(range, text)
        }
        this.contentListeners.forEach((l) => l())
        return true
    }
    setPosition(position: IPosition) {
        this.position = position
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
            registerCodeActionProvider: vi.fn((language: string, provider: languages.CodeActionProvider) => {
                expect(language).toBe('markdown')
                providers.add(provider)
                return { dispose: () => providers.delete(provider) }
            }),
        },
    }
    return {
        monaco: monaco as unknown as Monaco,
        registerCodeActionProvider: monaco.languages.registerCodeActionProvider,
        markers,
        commands,
        providers,
    }
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
        await vi.runAllTimersAsync()
        expect(underlined(markers, model)).toEqual([])
        expect(session.misspeltWordAt({ lineNumber: 2, column: 3 })).toBeNull()
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

    it('registers its quick fixes again each time the check turns on, so Monaco sets up Ctrl+. for a file made editable in place', () => {
        // Monaco sets up Ctrl+. again when the providers change, but not when read-only turns off.
        const editorInstance = new FakeEditor(new FakeModel('Hello wrold', URI))
        const { monaco, registerCodeActionProvider, providers } = fakeMonaco()
        const session = attachSpellcheck(
            editorInstance as unknown as editor.IStandaloneCodeEditor,
            monaco,
            { client: fakeClient([]), addWord: vi.fn() },
            null
        )
        expect(registerCodeActionProvider).toHaveBeenCalledTimes(1)

        session.setConfig(config)
        expect(registerCodeActionProvider).toHaveBeenCalledTimes(2)
        // Other changes, while it stays on or off, leave it be.
        session.setConfig({ ...config, words: ['Scrivon', 'wrold'] })
        session.setConfig(null)
        session.setConfig(null)
        expect(registerCodeActionProvider).toHaveBeenCalledTimes(2)
        session.setConfig(config)
        expect(registerCodeActionProvider).toHaveBeenCalledTimes(3)
        expect(providers.size).toBe(1)

        session.dispose()
        expect(providers.size).toBe(0)
    })

    it('adds a word to the dictionary and takes its marks away at once', async () => {
        const { model, markers, commands, addWord } = setup('Scrivon’s wrold, Scrivon’s secnod', ['Scrivon’s', 'wrold', 'secnod'])
        await vi.runAllTimersAsync()
        commands.get(ADD_TO_DICTIONARY_COMMAND)!(undefined, 'Scrivon’s')
        expect(addWord).toHaveBeenCalledWith('Scrivon')
        expect(underlined(markers, model)).toEqual(['wrold', 'secnod'])
    })

    describe('the misspelt word at a place, for the right-click menu', () => {
        it('is the underlined word there, with the dictionary’s suggestions for it', async () => {
            const { session, client } = setup()
            await vi.runAllTimersAsync()

            const found = session.misspeltWordAt({ lineNumber: 2, column: 3 })
            expect(found?.word).toBe('secnod')
            await expect(found!.suggestions()).resolves.toEqual(['SECNOD', 'secnods'])
            expect(client.suggest).toHaveBeenCalledWith('secnod', 'en-GB', ['Scrivon'])

            expect(session.misspeltWordAt({ lineNumber: 1, column: 2 })).toBeNull()
        })

        it('is nothing once spell check is off for the file, before its underlines have gone', async () => {
            const { session } = setup()
            await vi.runAllTimersAsync()
            session.setConfig(null)
            expect(session.misspeltWordAt({ lineNumber: 2, column: 3 })).toBeNull()
        })

        it('has no suggestions when the spell check can’t answer', async () => {
            const { session, client } = setup()
            await vi.runAllTimersAsync()
            client.suggest.mockRejectedValueOnce(new Error("The spell check couldn't start."))
            await expect(session.misspeltWordAt({ lineNumber: 2, column: 3 })!.suggestions()).resolves.toEqual([])
        })

        it('is replaced by a suggestion as one undo step, with the caret after it, and checked again at once', async () => {
            const { model, editorInstance, markers, session } = setup()
            await vi.runAllTimersAsync()

            session.misspeltWordAt({ lineNumber: 2, column: 3 })!.replaceWith('second')
            expect(model.getValue()).toBe('Hello wrold\nsecond line')
            expect(editorInstance.history).toEqual(['undo stop', 'edit “second”', 'undo stop'])
            expect(editorInstance.position).toEqual({ lineNumber: 2, column: 7 })

            await vi.advanceTimersByTimeAsync(0)
            expect(underlined(markers, model)).toEqual(['wrold'])
        })

        it('is left alone if its text changed after the menu opened', async () => {
            const { model, editorInstance, session } = setup()
            await vi.runAllTimersAsync()
            const found = session.misspeltWordAt({ lineNumber: 2, column: 3 })!

            editorInstance.type('Hello wrold\nsecnd line')
            found.replaceWith('second')
            expect(model.getValue()).toBe('Hello wrold\nsecnd line')
            expect(editorInstance.history).toEqual([])
        })

        it('is added to the dictionary, and its underline goes at once', async () => {
            const { model, markers, session, addWord } = setup()
            await vi.runAllTimersAsync()

            session.misspeltWordAt({ lineNumber: 2, column: 3 })!.addToDictionary()
            expect(addWord).toHaveBeenCalledWith('secnod')
            expect(underlined(markers, model)).toEqual(['wrold'])
        })
    })

    it('lets go of everything when the editor goes', async () => {
        const { editorInstance, commands, providers, client, session } = setup()
        await vi.runAllTimersAsync()
        session.dispose()
        expect(commands.size).toBe(0)
        expect(providers.size).toBe(0)
        client.check.mockClear()
        editorInstance.type('more text')
        await vi.runAllTimersAsync()
        expect(client.check).not.toHaveBeenCalled()
    })
})
