import type { Monaco } from '@monaco-editor/react'
import type { IDisposable, IPosition, IRange, editor, languages } from 'monaco-editor'
import type { SpellcheckLanguage } from '@/lib/spellcheck/languages'
import type { Misspelling, SpellcheckClient } from '@/lib/spellcheck/spellcheck-client'
import { dictionaryForm } from '@/lib/spellcheck/spellcheck-settings'

/** Whose marks these are, so setting them leaves other marks alone. */
export const SPELLCHECK_MARKER_OWNER = 'scrivon-spelling'
export const ADD_TO_DICTIONARY_COMMAND = 'scrivon.spelling.addToDictionary'
/** How long typing must pause before the text is checked again. */
export const SPELLCHECK_DELAY_MS = 400
/** More marks than anyone would fix one by one; a file full of another language would otherwise slow the editor. */
const MAX_MARKS = 2000

/** What to check: the file showing (by its model's URI), in which language, and the user's own words. */
export type SpellcheckConfig = { modelUri: string; language: SpellcheckLanguage; words: readonly string[] }

/** An underlined word, as the editor's right-click menu offers to fix it. */
export type MisspeltWord = {
    /** The word as it is written in the file. */
    word: string
    /** The dictionary's suggestions, best first. None when the spell check can't answer. */
    suggestions(): Promise<string[]>
    /** Puts `suggestion` in place of the word, as one step to undo. Does nothing if the word has changed since. */
    replaceWith(suggestion: string): void
    /** Saves the word to the user's dictionary, and takes its underline away at once. */
    addToDictionary(): void
}

export type SpellcheckSession = IDisposable & {
    /** Null turns the check off for the file showing (a diagram, a read-only file, or spelling switched off). */
    setConfig(config: SpellcheckConfig | null): void
    /** The underlined word at a place in the file showing, or null. */
    misspeltWordAt(position: IPosition): MisspeltWord | null
}

type Options = {
    client: SpellcheckClient
    /** Saves a word to the user's dictionary. */
    addWord: (word: string) => void
}

/** A misspelt word in a model, where it was when the model was last checked. */
type Mark = { word: string; range: IRange }

/**
 * Checks the spelling of the file in the editor, in the worker, once typing pauses, and underlines
 * the words the dictionary doesn't know.
 */
export function attachSpellcheck(
    editorInstance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
    { client, addWord }: Options,
    initial: SpellcheckConfig | null
): SpellcheckSession {
    let config = initial
    let timer: ReturnType<typeof setTimeout> | null = null
    const marks = new WeakMap<editor.ITextModel, Mark[]>()

    const toMarker = ({ word, range }: Mark): editor.IMarkerData => ({
        ...range,
        severity: monaco.MarkerSeverity.Info,
        message: `“${word}” isn't in the dictionary.`,
    })

    /**
     * The misspelt word at a position. Marks stay where the last check put them, so one whose text has
     * changed since (an edit before it on the line, say) counts only once the next check has moved it.
     */
    const markAt = (model: editor.ITextModel, position: IPosition): Mark | undefined =>
        marks
            .get(model)
            ?.find(
                ({ word, range }) =>
                    range.startLineNumber === position.lineNumber &&
                    range.startColumn <= position.column &&
                    position.column <= range.endColumn &&
                    model.getValueInRange(range) === word
            )

    const show = (model: editor.ITextModel, found: Mark[]) => {
        marks.set(model, found)
        monaco.editor.setModelMarkers(model, SPELLCHECK_MARKER_OWNER, found.map(toMarker))
    }

    /** Saves the word, and takes its marks away now rather than after the next check. */
    const addToDictionary = (word: string) => {
        const added = dictionaryForm(word)
        addWord(added)
        const model = editorInstance.getModel()
        const shown = model ? marks.get(model) : undefined
        if (model && shown)
            show(
                model,
                shown.filter((mark) => dictionaryForm(mark.word) !== added)
            )
    }

    /** The dictionary's suggestions for a word, in the language and with the words of the check. */
    const suggest = (word: string, asked: SpellcheckConfig): Promise<string[]> => client.suggest(word, asked.language, asked.words).catch(() => [])

    const noActions: languages.CodeActionList = { actions: [], dispose: () => {} }

    const codeActions: languages.CodeActionProvider = {
        async provideCodeActions(model, range, _context, token) {
            const mark = markAt(model, { lineNumber: range.startLineNumber, column: range.startColumn })
            const asked = config
            if (!mark || !asked) return noActions
            const suggestions = await suggest(mark.word, asked)
            if (token.isCancellationRequested) return noActions
            const diagnostics = [toMarker(mark)]
            const versionId = model.getVersionId()
            const changes = suggestions.map((suggestion, index): languages.CodeAction => ({
                title: `Change to “${suggestion}”`,
                kind: 'quickfix',
                diagnostics,
                isPreferred: index === 0,
                edit: { edits: [{ resource: model.uri, versionId, textEdit: { range: mark.range, text: suggestion } }] },
            }))
            const addTitle = `Add “${dictionaryForm(mark.word)}” to Dictionary`
            const add: languages.CodeAction = {
                title: addTitle,
                kind: 'quickfix',
                diagnostics,
                command: { id: ADD_TO_DICTIONARY_COMMAND, title: addTitle, arguments: [mark.word] },
            }
            return { actions: [...changes, add], dispose: () => {} }
        },
    }

    const toMarks = (model: editor.ITextModel, misspellings: Misspelling[]): Mark[] =>
        misspellings.slice(0, MAX_MARKS).map(({ word, offset }) => {
            const start = model.getPositionAt(offset)
            const end = model.getPositionAt(offset + word.length)
            return {
                word,
                range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
            }
        })

    const check = () => {
        timer = null
        const model = editorInstance.getModel()
        if (!model) return
        const asked = config
        if (!asked || model.uri.toString() !== asked.modelUri) {
            // Not just when this session marked it: another editor, or one before it, may have.
            show(model, [])
            return
        }
        const version = model.getVersionId()
        client.check(model.getValue(), asked.language, asked.words, asked.modelUri).then(
            (misspellings) => {
                // The text or the settings changed while it was checked: a newer check is on its way.
                if (model.isDisposed() || model.getVersionId() !== version || config !== asked) return
                show(model, toMarks(model, misspellings))
            },
            // The worker couldn't check (it says why once): the text just isn't underlined.
            () => {}
        )
    }

    const schedule = (delay: number) => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(check, delay)
    }

    const misspeltWordAt = (position: IPosition): MisspeltWord | null => {
        const model = editorInstance.getModel()
        const asked = config
        // Spell check may have just been turned off for the file, before the next check takes its marks away.
        if (!model || !asked || model.uri.toString() !== asked.modelUri) return null
        const mark = markAt(model, position)
        if (!mark) return null
        const { word, range } = mark
        return {
            word,
            suggestions: () => suggest(word, asked),
            replaceWith(suggestion) {
                if (model.isDisposed() || editorInstance.getModel() !== model || model.getValueInRange(range) !== word) return
                editorInstance.pushUndoStop()
                editorInstance.executeEdits('scrivon-spelling', [{ range, text: suggestion }])
                editorInstance.pushUndoStop()
                editorInstance.setPosition({ lineNumber: range.startLineNumber, column: range.startColumn + suggestion.length })
                // Its underline goes as soon as the check has run, without waiting for typing to pause.
                schedule(0)
            },
            addToDictionary: () => addToDictionary(word),
        }
    }

    const registerCodeActions = () => monaco.languages.registerCodeActionProvider('markdown', codeActions, { providedCodeActionKinds: ['quickfix'] })
    let codeActionsRegistration = registerCodeActions()

    const subscriptions: IDisposable[] = [
        editorInstance.onDidChangeModelContent(() => schedule(SPELLCHECK_DELAY_MS)),
        // Another tab: check it again, or clear its marks when spell check was turned off while it was hidden.
        editorInstance.onDidChangeModel(() => schedule(0)),
        monaco.editor.registerCommand(ADD_TO_DICTIONARY_COMMAND, (_accessor: unknown, word: string) => addToDictionary(word)),
    ]
    schedule(0)

    return {
        setConfig(next) {
            const turnedOn = config === null && next !== null
            config = next
            // Monaco sets up Ctrl+. (the quick fix list) only while the editor can be edited, and does it again
            // only when the file, its language or the quick fix providers change, not when read-only turns off.
            // So a read-only file made editable with the file still showing (Edit as UTF-8, Edit Anyway, a reload)
            // would get no list. Registering again counts as a change of providers. The check is never on for a
            // read-only file, and use-editor-spellcheck.ts turns it on from an effect, after the editor has been
            // told it can be edited, so Monaco sets Ctrl+. up then.
            if (turnedOn) {
                codeActionsRegistration.dispose()
                codeActionsRegistration = registerCodeActions()
            }
            schedule(0)
        },
        misspeltWordAt,
        dispose() {
            if (timer !== null) clearTimeout(timer)
            codeActionsRegistration.dispose()
            subscriptions.forEach((subscription) => subscription.dispose())
        },
    }
}
